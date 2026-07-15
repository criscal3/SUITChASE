package com.tasf.b2b.service;

import com.tasf.b2b.domain.PedidoRealEntity;
import com.tasf.b2b.domain.PedidoRealEntity.EstadoPedido;
import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.domain.AerolineaEntity;
import com.tasf.b2b.domain.VueloEntity;
import com.tasf.b2b.repository.PedidoRealRepository;
import com.tasf.b2b.repository.AsignacionRealRepository;
import com.tasf.b2b.repository.AerolineaRepository;
import com.tasf.b2b.repository.UsuarioRepository;
import com.tasf.b2b.domain.UsuarioEntity;
import com.tasf.b2b.api.dto.PedidoRealDTO;
import com.tasf.b2b.api.dto.TramoDTO;
import com.tasf.b2b.api.dto.ResumenOperacionesDTO;
import com.tasf.b2b.api.dto.RegistroPedidoRequest;
import com.tasf.b2b.api.dto.RegistroPedidoLoteItem;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import com.tasf.b2b.repository.VueloRepository;
import com.tasf.b2b.repository.CancelacionVueloRepository;
import com.tasf.b2b.domain.CancelacionVueloEntity;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

@Service
@RequiredArgsConstructor
@Slf4j
public class RealTimeOperationsService {

    private final PedidoRealRepository pedidoRepo;
    private final AsignacionRealRepository asignacionRepo;
    private final AerolineaRepository aerolineaRepo;
    private final UsuarioRepository usuarioRepo;
    private final SimpMessagingTemplate messagingTemplate;
    private final CancelacionVueloRepository cancelacionVueloRepo;
    private final com.tasf.b2b.repository.AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;

    // === CACHÉ EN MEMORIA ===
    private final ConcurrentHashMap<String, PedidoRealDTO> cache = new ConcurrentHashMap<>();
    private final AtomicReference<ResumenOperacionesDTO> resumenCache = new AtomicReference<>(
            new ResumenOperacionesDTO(0, 0, 0, 0, LocalDateTime.now(), 0.0, 0.0, Map.of())
    );

    private static final List<EstadoPedido> ESTADOS_ACTIVOS = List.of(
            EstadoPedido.PENDIENTE, EstadoPedido.PLANIFICADO, EstadoPedido.EN_RUTA,
            EstadoPedido.ENTREGADO, EstadoPedido.SIN_RUTA, EstadoPedido.COLAPSO
    );

    @PostConstruct
    public void cargarCacheInicial() {
        var activos = pedidoRepo.findByEstadoInOrderByFechaHoraRegistroDesc(ESTADOS_ACTIVOS);
        activos.forEach(p -> cache.put(p.getId(), toDTO(p, cargarTramos(p.getId()))));
        recalcularResumen();
        log.info("[RT] Caché inicializado: {} operaciones activas", cache.size());
    }

    /** Registrar nuevo pedido — llamado por el controller del operario */
    public PedidoRealDTO registrarPedido(RegistroPedidoRequest req, Long operarioId) {
        // Verificar capacidad del almacén origen
        int capacidad = aeropuertoRepository.findById(req.origenOaci())
                .map(com.tasf.b2b.domain.AeropuertoEntity::getCapacidadAlmacen)
                .orElse(0);
        int stockActual = getStockActualAlmacen(req.origenOaci());
        if (stockActual + req.cantidadMaletas() > capacidad) {
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST,
                "El almacén de origen " + req.origenOaci() + " no tiene suficiente capacidad. Capacidad máxima: " + capacidad + ", Stock actual: " + stockActual + ", Maletas a registrar: " + req.cantidadMaletas()
            );
        }

        PedidoRealEntity p = new PedidoRealEntity();
        p.setId("PED-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        p.setOrigenOaci(req.origenOaci());
        p.setDestinoOaci(req.destinoOaci());
        p.setCantidadMaletas(req.cantidadMaletas());
        p.setAerolineaId(req.aerolineaId());
        p.setOperarioId(operarioId);
        p.setFechaHoraRegistro(LocalDateTime.now());
        p.setEstado(EstadoPedido.PENDIENTE);
        p.setUbicacionActual(req.origenOaci());
        
        pedidoRepo.save(p);

        PedidoRealDTO dto = toDTO(p, List.of());
        cache.put(p.getId(), dto);
        recalcularResumen();

        // Push al admin
        messagingTemplate.convertAndSend("/topic/tiempo-real/nuevo-pedido", dto);
        messagingTemplate.convertAndSend("/topic/tiempo-real/actualizacion", resumenCache.get());
        
        // Push a la aerolínea
        messagingTemplate.convertAndSend("/topic/mis-pedidos/" + req.aerolineaId(),
                getPedidosActivosAerolinea(req.aerolineaId()));

        return dto;
    }

    /** Registrar pedidos en lote (tiempo real) */
    public List<PedidoRealDTO> registrarPedidosEnLote(List<RegistroPedidoLoteItem> items, String origenOaci, Long operarioId) {
        // Verificar capacidad del almacén origen para el lote completo
        int capacidad = aeropuertoRepository.findById(origenOaci)
                .map(com.tasf.b2b.domain.AeropuertoEntity::getCapacidadAlmacen)
                .orElse(0);
        int stockActual = getStockActualAlmacen(origenOaci);
        int totalMaletasLote = items.stream().mapToInt(RegistroPedidoLoteItem::cantidadMaletas).sum();
        if (stockActual + totalMaletasLote > capacidad) {
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST,
                "El almacén de origen " + origenOaci + " no tiene suficiente capacidad para registrar este lote. Capacidad máxima: " + capacidad + ", Stock actual: " + stockActual + ", Maletas en lote: " + totalMaletasLote
            );
        }

        List<PedidoRealDTO> creados = new ArrayList<>();
        Set<Long> aerolineasAfectadas = new HashSet<>();

        for (var item : items) {
            AerolineaEntity al = aerolineaRepo.findByCodigo(item.codigoAerolinea()).orElse(null);
            if (al == null) {
                log.warn("[RT] Aerolínea con código {} no encontrada. Omitiendo.", item.codigoAerolinea());
                continue;
            }

            PedidoRealEntity p = new PedidoRealEntity();
            p.setId("PED-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
            p.setOrigenOaci(origenOaci);
            p.setDestinoOaci(item.destinoOaci());
            p.setCantidadMaletas(item.cantidadMaletas());
            p.setAerolineaId(al.getId());
            p.setOperarioId(operarioId);
            p.setFechaHoraRegistro(LocalDateTime.now());
            p.setEstado(EstadoPedido.PENDIENTE);
            p.setUbicacionActual(origenOaci);

            pedidoRepo.save(p);

            PedidoRealDTO dto = toDTO(p, List.of());
            cache.put(p.getId(), dto);
            creados.add(dto);
            aerolineasAfectadas.add(al.getId());

            // Push al admin para cada nuevo pedido
            messagingTemplate.convertAndSend("/topic/tiempo-real/nuevo-pedido", dto);
        }

        if (!creados.isEmpty()) {
            recalcularResumen();
            messagingTemplate.convertAndSend("/topic/tiempo-real/actualizacion", resumenCache.get());

            for (Long aId : aerolineasAfectadas) {
                messagingTemplate.convertAndSend("/topic/mis-pedidos/" + aId,
                        getPedidosActivosAerolinea(aId));
            }
        }

        return creados;
    }

    /**
     * Preview de cancelación: devuelve los pedidos que serían afectados si se cancela
     * la ocurrencia de hoy del vuelo dado. No modifica ningún dato.
     * <p>
     * Usa origenOaci + destinoOaci para la búsqueda en lugar del vueloId, porque
     * los registros existentes pueden tener vueloId = 0 por el bug de conversión GMT.
     */
    public List<PedidoRealDTO> getPedidosAfectadosPorVueloHoy(VueloEntity vuelo) {
        LocalDateTime ahora = LocalDateTime.now();

        List<AsignacionRealEntity> todosTramos = asignacionRepo
                .findByOrigenOaciAndDestinoOaciAndEstado(
                        vuelo.getOrigenOaci(), vuelo.getDestinoOaci(),
                        AsignacionRealEntity.EstadoTramo.PROGRAMADO);

        // Encontrar la fecha de salida más próxima (el siguiente vuelo)
        LocalDateTime proximaSalida = todosTramos.stream()
                .map(AsignacionRealEntity::getFechaSalida)
                .filter(fecha -> !fecha.isBefore(ahora.minusMinutes(30))) // Dar un margen para vuelos que están a punto de salir
                .min(LocalDateTime::compareTo)
                .orElse(null);

        if (proximaSalida == null) return List.of();

        return todosTramos.stream()
                .filter(t -> t.getFechaSalida().equals(proximaSalida))
                .map(AsignacionRealEntity::getPedidoId)
                .distinct()
                .map(id -> pedidoRepo.findById(id).orElse(null))
                .filter(p -> p != null
                        && (p.getEstado() == EstadoPedido.PLANIFICADO || p.getEstado() == EstadoPedido.EN_RUTA))
                .map(p -> toDTO(p, List.of()))
                .toList();
    }

    /**
     * Cancela la ocurrencia del día de un vuelo específico.
     * Busca todos los tramos PROGRAMADO de ese vuelo con fechaSalida en el día de hoy
     * usando origenOaci + destinoOaci (robusto ante vueloId = 0),
     * regresa los pedidos afectados a PENDIENTE y limpia sus asignaciones PROGRAMADO
     * para que el scheduler los replanifique en el siguiente ciclo.
     *
     * @return número de pedidos afectados
     */
    public int cancelarVueloDelDia(VueloEntity vuelo) {
        LocalDateTime ahora = LocalDateTime.now();

        List<AsignacionRealEntity> todosTramos = asignacionRepo
                .findByOrigenOaciAndDestinoOaciAndEstado(
                        vuelo.getOrigenOaci(), vuelo.getDestinoOaci(),
                        AsignacionRealEntity.EstadoTramo.PROGRAMADO);

        // Encontrar la fecha de salida más próxima (el siguiente vuelo)
        LocalDateTime proximaSalida = todosTramos.stream()
                .map(AsignacionRealEntity::getFechaSalida)
                .filter(fecha -> !fecha.isBefore(ahora.minusMinutes(30)))
                .min(LocalDateTime::compareTo)
                .orElse(null);

        if (proximaSalida == null) {
            // Si no hay tramos programados, no podemos saber la hora exacta de salida de este vuelo hoy.
            // Para ser robustos, podríamos usar la hora actual combinada con la hora de salida del VueloEntity,
            // pero asumiremos que el frontend proveerá la fecha y hora si es estrictamente necesario.
            // Por ahora solo usamos el primer tramo encontrado si proximaSalida es null.
            return 0;
        }

        // Registrar la cancelación de esta ocurrencia exacta para que el algoritmo ACS la ignore.
        CancelacionVueloEntity cancelacion = new CancelacionVueloEntity();
        cancelacion.setVueloId(vuelo.getId());
        cancelacion.setOrigenOaci(vuelo.getOrigenOaci());
        cancelacion.setDestinoOaci(vuelo.getDestinoOaci());
        cancelacion.setFechaSalida(proximaSalida);
        cancelacionVueloRepo.save(cancelacion);

        List<AsignacionRealEntity> tramosAfectados = todosTramos.stream()
                .filter(t -> t.getFechaSalida().equals(proximaSalida))
                .toList();

        if (tramosAfectados.isEmpty()) return 0;

        // Agrupar por pedido (un pedido puede tener varios tramos, pero solo uno es el vuelo cancelado)
        Set<String> pedidosIds = tramosAfectados.stream()
                .map(AsignacionRealEntity::getPedidoId)
                .collect(java.util.stream.Collectors.toSet());

        Set<Long> aerolineasAfectadas = new HashSet<>();

        for (String pedidoId : pedidosIds) {
            pedidoRepo.findById(pedidoId).ifPresent(pedido -> {
                EstadoPedido estadoActual = pedido.getEstado();

                // Solo replanificar pedidos que aún no han llegado al destino
                if (estadoActual == EstadoPedido.PLANIFICADO || estadoActual == EstadoPedido.EN_RUTA) {

                    // Marcar todos los tramos PROGRAMADO de este pedido como CANCELADO
                    List<AsignacionRealEntity> tramosRestantes = asignacionRepo
                            .findByPedidoIdAndEstado(pedidoId, AsignacionRealEntity.EstadoTramo.PROGRAMADO);
                    for (AsignacionRealEntity t : tramosRestantes) {
                        t.setEstado(AsignacionRealEntity.EstadoTramo.CANCELADO);
                        asignacionRepo.save(t);
                    }

                    // Regresar el pedido a PENDIENTE para replanificación
                    pedido.setEstado(EstadoPedido.PENDIENTE);
                    pedido.setTotalTramos(null);
                    pedidoRepo.save(pedido);

                    // Actualizar caché
                    PedidoRealDTO dto = toDTO(pedido, cargarTramos(pedidoId));
                    cache.put(pedidoId, dto);
                    aerolineasAfectadas.add(pedido.getAerolineaId());

                    log.info("[CancelarVueloHoy] Pedido {} regresado a PENDIENTE (vuelo {}->{} cancelado hoy)",
                            pedidoId, vuelo.getOrigenOaci(), vuelo.getDestinoOaci());
                }
            });
        }

        recalcularResumen();

        // Notificar admin vía WebSocket
        messagingTemplate.convertAndSend("/topic/tiempo-real/actualizacion", resumenCache.get());
        List<PedidoRealDTO> modificados = pedidosIds.stream()
                .map(id -> cache.get(id))
                .filter(Objects::nonNull)
                .toList();
        if (!modificados.isEmpty()) {
            messagingTemplate.convertAndSend("/topic/tiempo-real/pedidos-actualizados", modificados);
        }

        // Notificar aerolíneas afectadas
        for (Long aId : aerolineasAfectadas) {
            messagingTemplate.convertAndSend("/topic/mis-pedidos/" + aId,
                    getPedidosActivosAerolinea(aId));
        }

        return pedidosIds.size();
    }

    /** Admin: lista filtrada (desde caché) */
    public List<PedidoRealDTO> getOperacionesActivas(String filtroEstado, Long filtroAerolinea) {
        return cache.values().stream()
                .filter(p -> filtroEstado == null || p.estado().equalsIgnoreCase(filtroEstado))
                .filter(p -> filtroAerolinea == null || p.aerolineaId().equals(filtroAerolinea))
                .sorted(Comparator.comparing(PedidoRealDTO::fechaHoraRegistro).reversed())
                .toList();
    }

    /** Aerolínea: sus pedidos activos (desde caché) */
    public List<PedidoRealDTO> getPedidosActivosAerolinea(Long aerolineaId) {
        return cache.values().stream()
                .filter(p -> aerolineaId.equals(p.aerolineaId()))
                .sorted(Comparator.comparing(PedidoRealDTO::fechaHoraRegistro).reversed())
                .toList();
    }

    /** Detalle de un pedido con tramos */
    public PedidoRealDTO getDetallePedido(String id) {
        PedidoRealDTO cached = cache.get(id);
        if (cached != null) return cached;
        // Si no está en caché (histórico), buscar en DB
        return pedidoRepo.findById(id).map(p -> toDTO(p, cargarTramos(id))).orElse(null);
    }

    /** Eliminar pedido de caché al ser dividido */
    public void eliminarPedidoDeCache(String id) {
        cache.remove(id);
    }

    /** Obtener la ocupación actual (stock) del almacén de un aeropuerto específico */
    public int getStockActualAlmacen(String oaci) {
        return (int) cache.values().stream()
            .filter(p -> {
                if ("PENDIENTE".equalsIgnoreCase(p.estado()) || "PLANIFICADO".equalsIgnoreCase(p.estado())) {
                    return p.origenOaci().equals(oaci);
                } else if ("EN_RUTA".equalsIgnoreCase(p.estado())) {
                    return p.ubicacionActual().equals(oaci);
                } else if ("ENTREGADO".equalsIgnoreCase(p.estado())) {
                    if (p.ubicacionActual().equals(oaci)) {
                        var tramos = p.tramos();
                        if (tramos != null && !tramos.isEmpty()) {
                            var lastTramo = tramos.get(tramos.size() - 1);
                            return lastTramo.fechaLlegada() != null && 
                                   LocalDateTime.now().isBefore(lastTramo.fechaLlegada().plusMinutes(15));
                        }
                    }
                }
                return false;
            })
            .mapToLong(PedidoRealDTO::cantidadMaletas)
            .sum();
    }

    /** Llamado por el scheduler tras planificar un lote */
    public void actualizarPedidosPlanificados(List<PedidoRealEntity> planificados) {
        Set<Long> aerolineasAfectadas = new HashSet<>();
        for (var p : planificados) {
            List<AsignacionRealEntity> tramos = cargarTramos(p.getId());
            PedidoRealDTO dto = toDTO(p, tramos);
            cache.put(p.getId(), dto);
            aerolineasAfectadas.add(p.getAerolineaId());
        }
        recalcularResumen();

        // Push resumen al admin
        messagingTemplate.convertAndSend("/topic/tiempo-real/actualizacion", resumenCache.get());
        
        // Push lista actualizada al admin (delta de los pedidos que cambiaron)
        messagingTemplate.convertAndSend("/topic/tiempo-real/pedidos-actualizados",
                planificados.stream().map(p -> cache.getOrDefault(p.getId(), toDTO(p, List.of()))).toList());

        // Push a cada aerolínea afectada
        for (Long aId : aerolineasAfectadas) {
            messagingTemplate.convertAndSend("/topic/mis-pedidos/" + aId,
                    getPedidosActivosAerolinea(aId));
        }
    }

    /** Llamado por TramoStatusUpdaterService cuando cambian estados de tramos */
    public void refrescarCachePedidos(List<String> pedidoIds) {
        for (String id : pedidoIds) {
            pedidoRepo.findById(id).ifPresent(p -> {
                List<AsignacionRealEntity> tramos = cargarTramos(id);
                PedidoRealDTO dto = toDTO(p, tramos);
                cache.put(id, dto);
                // Push a la aerolínea
                messagingTemplate.convertAndSend("/topic/mis-pedidos/" + p.getAerolineaId(),
                        getPedidosActivosAerolinea(p.getAerolineaId()));
            });
        }
        recalcularResumen();
        messagingTemplate.convertAndSend("/topic/tiempo-real/actualizacion", resumenCache.get());
        
        // También notificar la lista de modificados al admin
        List<PedidoRealDTO> modificados = pedidoIds.stream()
                .map(id -> cache.get(id))
                .filter(Objects::nonNull)
                .toList();
        if (!modificados.isEmpty()) {
            messagingTemplate.convertAndSend("/topic/tiempo-real/pedidos-actualizados", modificados);
        }
    }

    public ResumenOperacionesDTO getResumen() { return resumenCache.get(); }

    private void recalcularResumen() {
        long pendientes  = cache.values().stream().filter(p -> "PENDIENTE".equalsIgnoreCase(p.estado())).count();
        long planificados = cache.values().stream().filter(p -> "PLANIFICADO".equalsIgnoreCase(p.estado())).count();
        long enRuta      = cache.values().stream().filter(p -> "EN_RUTA".equalsIgnoreCase(p.estado())).count();
        
        // Calcular ocupación de almacenes
        Map<String, Integer> stockActualAlmacenes = new HashMap<>();
        long totalStock = 0;
        long totalCapacity = 0;
        
        var aeropuertos = aeropuertoRepository.findAll();
        for (var aero : aeropuertos) {
            // Calcular stock actual: pedidos PENDIENTE/PLANIFICADO en origen + EN_RUTA en escalas + ENTREGADO recientemente
            long stockEnAlmacen = cache.values().stream()
                .filter(p -> {
                    if ("PENDIENTE".equalsIgnoreCase(p.estado()) || "PLANIFICADO".equalsIgnoreCase(p.estado())) {
                        return p.origenOaci().equals(aero.getOaci());
                    } else if ("EN_RUTA".equalsIgnoreCase(p.estado())) {
                        return p.ubicacionActual().equals(aero.getOaci());
                    } else if ("ENTREGADO".equalsIgnoreCase(p.estado())) {
                        if (p.ubicacionActual().equals(aero.getOaci())) {
                            var tramos = p.tramos();
                            if (tramos != null && !tramos.isEmpty()) {
                                var lastTramo = tramos.get(tramos.size() - 1);
                                return lastTramo.fechaLlegada() != null && 
                                       LocalDateTime.now().isBefore(lastTramo.fechaLlegada().plusMinutes(15));
                            }
                        }
                    }
                    return false;
                })
                .mapToLong(PedidoRealDTO::cantidadMaletas)
                .sum();
            
            stockActualAlmacenes.put(aero.getOaci(), (int) stockEnAlmacen);
            totalStock += stockEnAlmacen;
            totalCapacity += aero.getCapacidadAlmacen() != null ? aero.getCapacidadAlmacen() : 0;
        }
        
        double ocupacionGlobalAlmacenes = totalCapacity > 0 ? (double) totalStock / totalCapacity * 100 : 0.0;
        
        // Calcular ocupación de vuelos
        long totalFlightLoad = 0;
        long totalFlightCapacity = 0;
        
        var vuelosTodos = vueloRepository.findAll();
        
        for (var vuelo : vuelosTodos) {
            // Calcular carga: pedidos con tramos EN_VUELO o PROGRAMADO en este vuelo
            long cargaVuelo = cache.values().stream()
                .filter(p -> "EN_RUTA".equalsIgnoreCase(p.estado()) || "PLANIFICADO".equalsIgnoreCase(p.estado()))
                .filter(p -> {
                    return p.tramos().stream().anyMatch(t -> 
                        t.origenOaci().equals(vuelo.getOrigenOaci()) &&
                        t.destinoOaci().equals(vuelo.getDestinoOaci()) &&
                        (t.estado().equals("EN_VUELO") || t.estado().equals("PROGRAMADO"))
                    );
                })
                .mapToLong(PedidoRealDTO::cantidadMaletas)
                .sum();
            
            totalFlightLoad += cargaVuelo;
            Integer capacidad = vuelo.getCapacidad();
            totalFlightCapacity += capacidad != null ? capacidad : 200;
        }
        
        double ocupacionGlobalVuelos = totalFlightCapacity > 0 ? (double) totalFlightLoad / totalFlightCapacity * 100 : 0.0;
        
        resumenCache.set(new ResumenOperacionesDTO(
            cache.size(), 
            pendientes, 
            planificados, 
            enRuta, 
            LocalDateTime.now(),
            ocupacionGlobalAlmacenes,
            ocupacionGlobalVuelos,
            stockActualAlmacenes
        ));
    }

    private List<AsignacionRealEntity> cargarTramos(String pedidoId) {
        return asignacionRepo.findByPedidoIdOrderByOrdenVueloAsc(pedidoId);
    }

    private PedidoRealDTO toDTO(PedidoRealEntity p, List<AsignacionRealEntity> tramos) {
        String nombreAerolinea = aerolineaRepo.findById(p.getAerolineaId())
                .map(AerolineaEntity::getNombre).orElse("—");
        List<TramoDTO> tramosDTO = tramos.stream().map(t -> new TramoDTO(
                t.getOrdenVuelo(), t.getOrigenOaci(), t.getDestinoOaci(),
                t.getFechaSalida(), t.getFechaLlegada(), t.getEstado().name()
        )).toList();
        String operarioOaci = null;
        if (p.getOperarioId() != null) {
            operarioOaci = usuarioRepo.findById(p.getOperarioId())
                    .map(UsuarioEntity::getAeropuertoOaci).orElse(null);
        }
        return new PedidoRealDTO(
                p.getId(), p.getOrigenOaci(), p.getDestinoOaci(),
                p.getFechaHoraRegistro(), p.getCantidadMaletas(),
                p.getAerolineaId(), nombreAerolinea,
                p.getEstado().name(), tramos.size(),
                p.getUbicacionActual(), tramosDTO,
                operarioOaci,
                p.getOperarioId()
        );
    }
}
