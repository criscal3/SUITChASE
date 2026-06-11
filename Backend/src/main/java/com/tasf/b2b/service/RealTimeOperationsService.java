package com.tasf.b2b.service;

import com.tasf.b2b.domain.PedidoRealEntity;
import com.tasf.b2b.domain.PedidoRealEntity.EstadoPedido;
import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.domain.AerolineaEntity;
import com.tasf.b2b.repository.PedidoRealRepository;
import com.tasf.b2b.repository.AsignacionRealRepository;
import com.tasf.b2b.repository.AerolineaRepository;
import com.tasf.b2b.api.dto.PedidoRealDTO;
import com.tasf.b2b.api.dto.TramoDTO;
import com.tasf.b2b.api.dto.ResumenOperacionesDTO;
import com.tasf.b2b.api.dto.RegistroPedidoRequest;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
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
    private final SimpMessagingTemplate messagingTemplate;

    // === CACHÉ EN MEMORIA ===
    private final ConcurrentHashMap<String, PedidoRealDTO> cache = new ConcurrentHashMap<>();
    private final AtomicReference<ResumenOperacionesDTO> resumenCache = new AtomicReference<>(
            new ResumenOperacionesDTO(0, 0, 0, 0, LocalDateTime.now())
    );

    private static final List<EstadoPedido> ESTADOS_ACTIVOS = List.of(
            EstadoPedido.PENDIENTE, EstadoPedido.PLANIFICADO, EstadoPedido.EN_RUTA
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

    /** Llamado por el scheduler tras planificar un lote */
    public void actualizarPedidosPlanificados(List<PedidoRealEntity> planificados) {
        Set<Long> aerolineasAfectadas = new HashSet<>();
        for (var p : planificados) {
            List<AsignacionRealEntity> tramos = cargarTramos(p.getId());
            PedidoRealDTO dto = toDTO(p, tramos);
            if (p.getEstado() == EstadoPedido.ENTREGADO || p.getEstado() == EstadoPedido.SIN_RUTA || p.getEstado() == EstadoPedido.COLAPSO) {
                cache.remove(p.getId());  // Sale de la vista "activos"
            } else {
                cache.put(p.getId(), dto);
            }
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
                if (p.getEstado() == EstadoPedido.ENTREGADO || p.getEstado() == EstadoPedido.SIN_RUTA || p.getEstado() == EstadoPedido.COLAPSO) {
                    cache.remove(id);
                } else {
                    cache.put(id, dto);
                }
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
        resumenCache.set(new ResumenOperacionesDTO(cache.size(), pendientes, planificados, enRuta, LocalDateTime.now()));
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
        return new PedidoRealDTO(
                p.getId(), p.getOrigenOaci(), p.getDestinoOaci(),
                p.getFechaHoraRegistro(), p.getCantidadMaletas(),
                p.getAerolineaId(), nombreAerolinea,
                p.getEstado().name(), tramos.size(),
                p.getUbicacionActual(), tramosDTO
        );
    }
}
