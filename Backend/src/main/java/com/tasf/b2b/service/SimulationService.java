package com.tasf.b2b.service;

import com.tasf.b2b.core.*;
import com.tasf.b2b.domain.*;
import com.tasf.b2b.domain.SimulacionEntity.EstadoSimulacion;
import com.tasf.b2b.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentHashMap.KeySetView;
import java.util.stream.Collectors;
import org.springframework.scheduling.annotation.Scheduled;

@Service
@RequiredArgsConstructor
@Slf4j
public class SimulationService {

    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final EnvioRepository envioRepository;
    private final SimulacionRepository simulacionRepository;
    private final BloqueResultadoRepository bloqueResultadoRepository;
    private final AsignacionEnvioRepository asignacionEnvioRepository;
    private final DataMapperService dataMapper;
    private final SimpMessagingTemplate messagingTemplate;
    private final EnvioSinteticoFileReader envioFileReader;

    // Estado de simulaciones activas: simulacionId -> flag de pausa
    private final Map<Long, Boolean> pauseFlags = new ConcurrentHashMap<>();

    // Almacena los vuelos cancelados por simulación. Clave: simulacionId, Valor: Set de claves de vuelo (ORIGEN-DESTINO-YYYY-MM-DDTHH:mm:ss)
    private final Map<Long, Set<String>> vuelosCanceladosPorSimulacion = new ConcurrentHashMap<>();
    
    // Almacena los envíos que fueron afectados por una cancelación y deben ser replanificados
    private final Map<Long, List<EnvioAlgoritmo>> enviosAReplanificarPorSimulacion = new ConcurrentHashMap<>();

    // Timestamp del último latido por simulación activa
    private final Map<Long, Long> lastHeartbeatMap = new ConcurrentHashMap<>();

    /** Evita dos hilos @Async procesando la misma simulación (p. ej. al reanudar). */
    private final KeySetView<Long, Boolean> simulacionesEnEjecucion = ConcurrentHashMap.newKeySet();

    /** Almacena el inputMaestro para cada simulación activa (mantiene estado entre pausas/reanudaciones). */
    private final Map<Long, PlanificationProblemInput> inputMaestroMap = new ConcurrentHashMap<>();
    
    /** Almacena los aeropuertos para cada simulación (para reutilizar entre pausas). */
    private final Map<Long, List<AeropuertoAlgoritmo>> aeropuertosMap = new ConcurrentHashMap<>();
    
    /** Almacena los vuelos para cada simulación (para reutilizar entre pausas). */
    private final Map<Long, List<VueloAlgoritmo>> vuelosMap = new ConcurrentHashMap<>();
    
    /** Almacena los índices de vuelos para cada simulación (para reutilizar entre pausas). */
    private final Map<Long, Map<String, VueloAlgoritmo>> indiceVuelosMap = new ConcurrentHashMap<>();

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy
    private SimulationService self;

    // ========================================================
    // INICIAR SIMULACIÓN (llamado desde controller, retorna rápido)
    // ========================================================
    public SimulacionEntity iniciarSimulacion(Long userId, String nombre,
                                              LocalDateTime fechaInicio, LocalDateTime fechaFin,
                                              int sa, int k, int ta, int skipSleepUntilBlock) {
        int sc = k * sa;
        long totalMinutos = ChronoUnit.MINUTES.between(fechaInicio, fechaFin);
        int totalBloques = sc > 0 ? (int) Math.ceil((double) totalMinutos / sc) : 0;

        SimulacionEntity sim = new SimulacionEntity();
        sim.setNombre(nombre);
        sim.setEstado(EstadoSimulacion.EJECUTANDO);
        sim.setFechaInicioSim(fechaInicio);
        sim.setFechaFinSim(fechaFin);
        sim.setSaltoAlgoritmoSa(sa);
        sim.setConstanteK(k);
        sim.setTiempoAlgoritmoTa(ta);
        sim.setBloqueActual(0);
        sim.setTotalBloquesEstimados(totalBloques);
        sim.setCursorTemporal(fechaInicio);
        sim.setCreadoPor(userId);
        sim.setSkipSleepUntilBlock(skipSleepUntilBlock);

        simulacionRepository.save(sim);
        pauseFlags.put(sim.getId(), false);
        registrarHeartbeat(sim.getId());

        // Lanzar ejecución asíncrona vía proxy Spring para habilitar @Async
        self.ejecutarSimulacionAsync(sim.getId());

        return sim;
    }

    // ========================================================
    // PAUSAR
    // ========================================================
    public void pausarSimulacion(Long simulacionId) {
        pauseFlags.put(simulacionId, true);
        SimulacionEntity sim = simulacionRepository.findById(simulacionId)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));
        sim.setEstado(EstadoSimulacion.PAUSADA);
        simulacionRepository.save(sim);
        log.info("Simulación {} pausada (inputMaestro preservado en memoria)", simulacionId);
    }

    // ========================================================
    // REANUDAR
    // ========================================================
    public void reanudarSimulacion(Long simulacionId) {
        SimulacionEntity sim = simulacionRepository.findById(simulacionId)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));

        if (sim.getEstado() == EstadoSimulacion.EJECUTANDO) {
            // Verificar inconsistencia: estado=EJECUTANDO pero pauseFlag=true
            // Esto ocurre cuando el request de pausa llega justo antes del reanudar,
            // causando que el hilo ejecutor nunca vea la pausa y el flag quede colgado.
            if (Boolean.TRUE.equals(pauseFlags.get(simulacionId))) {
                log.warn("Simulación {} — inconsistencia detectada: estado=EJECUTANDO pero pauseFlag=true. Corrigiendo...", simulacionId);
                pauseFlags.put(simulacionId, false);
                return;
            }
            log.info("La simulación {} ya está ejecutándose", simulacionId);
            return;
        }

        if (sim.getEstado() != EstadoSimulacion.PAUSADA) {
            throw new RuntimeException("Solo se puede reanudar una simulación PAUSADA");
        }

        // Verificar que el inputMaestro está en memoria
        if (!inputMaestroMap.containsKey(simulacionId)) {
            throw new RuntimeException("No se encontró el estado del inputMaestro para la simulación " + simulacionId + ". Se requiere reiniciar la simulación.");
        }

        sim.setEstado(EstadoSimulacion.EJECUTANDO);
        simulacionRepository.save(sim);
        pauseFlags.put(simulacionId, false);

        // NO relanzar el loop asíncrono; solo desestablecemos el flag de pausa
        // El loop que estaba pausado continuará desde donde se quedó
        log.info("Simulación {} reanudada desde bloque {} (inputMaestro reutilizado)", simulacionId, sim.getBloqueActual());
    }

    // ========================================================
    // REFRESCAR AEROPUERTOS (llamado desde AeropuertoController)
    // ========================================================

    /**
     * Actualiza la capacidad de aeropuertos en todas las simulaciones activas.
     * Se invoca de forma inmediata cuando se edita un aeropuerto en la pantalla de gestión,
     * sin necesidad de esperar a que el bloque de simulación termine.
     */
    public void refrescarAeropuertosEnSimulacionesActivas() {
        if (inputMaestroMap.isEmpty()) return;

        List<com.tasf.b2b.core.AeropuertoAlgoritmo> aeropuertosActualizados =
                aeropuertoRepository.findAll().stream()
                        .map(dataMapper::toAeropuertoAlgoritmo)
                        .collect(Collectors.toList());

        for (Map.Entry<Long, PlanificationProblemInput> entry : inputMaestroMap.entrySet()) {
            Long simId = entry.getKey();
            PlanificationProblemInput im = entry.getValue();
            for (com.tasf.b2b.core.AeropuertoAlgoritmo aero : aeropuertosActualizados) {
                com.tasf.b2b.core.AeropuertoAlgoritmo existing = im.getAeropuerto(aero.getOaci());
                if (existing == null || existing.getCapacidadAlmacen() != aero.getCapacidadAlmacen()) {
                    im.agregarAeropuerto(aero);
                    if (existing != null) {
                        log.info("[Sim {}] Capacidad inmediata de {} actualizada: {} -> {}",
                                simId, aero.getOaci(), existing.getCapacidadAlmacen(), aero.getCapacidadAlmacen());
                    }
                }
            }
        }
        log.info("[Sim] Aeropuertos refrescados en {} simulaciones activas.", inputMaestroMap.size());
    }

    // ========================================================
    // REFRESCAR VUELOS (llamado desde VueloController)
    // ========================================================

    /**
     * Actualiza los vuelos en todas las simulaciones activas cargando la lista
     * completa desde la BD. Se invoca cuando se importan, crean o eliminan vuelos
     * en la pantalla de gestión, para que la planificación en curso los tome en cuenta.
     * Preserva el estado de ocupación global acumulado entre bloques.
     */
    public void refrescarVuelosEnSimulacionesActivas() {
        if (inputMaestroMap.isEmpty()) return;

        List<com.tasf.b2b.core.VueloAlgoritmo> vuelosActualizados =
                vueloRepository.findAll().stream()
                        .map(dataMapper::toVueloAlgoritmo)
                        .collect(Collectors.toList());

        for (Map.Entry<Long, PlanificationProblemInput> entry : inputMaestroMap.entrySet()) {
            Long simId = entry.getKey();
            entry.getValue().resetearVuelos(vuelosActualizados);
            log.info("[Sim {}] Vuelos refrescados: {} vuelos activos.", simId, vuelosActualizados.size());
        }
    }

    // ========================================================
    // CANCELAR
    // ========================================================
    public void cancelarSimulacion(Long simulacionId) {
        pauseFlags.remove(simulacionId); // Remover para marcar como cancelada
        lastHeartbeatMap.remove(simulacionId);
        SimulacionEntity sim = simulacionRepository.findById(simulacionId)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));
        sim.setEstado(EstadoSimulacion.CANCELADA);
        simulacionRepository.save(sim);
        
        // Limpiar mapas de estado (se limpiarán en el finally de ejecutarSimulacionAsync)
        log.info("Simulación {} cancelada", simulacionId);
    }

    // ========================================================
    // ACTUALIZAR K EN CALIENTE
    // ========================================================
    public void actualizarK(Long simulacionId, int nuevoK) {
        SimulacionEntity sim = simulacionRepository.findById(simulacionId)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));
        sim.setConstanteK(nuevoK);
        // Recalcular total de bloques estimados con el nuevo K
        long totalMinutos = ChronoUnit.MINUTES.between(sim.getCursorTemporal(), sim.getFechaFinSim());
        int nuevoSc = nuevoK * sim.getSaltoAlgoritmoSa();
        int bloquesRestantes = nuevoSc > 0 ? (int) Math.ceil((double) totalMinutos / nuevoSc) : 0;
        sim.setTotalBloquesEstimados(sim.getBloqueActual() + bloquesRestantes);
        simulacionRepository.save(sim);
        log.info("Simulación {} — K actualizado a {}. Nuevo Sc = {} min",
                simulacionId, nuevoK, nuevoK * sim.getSaltoAlgoritmoSa());
    }

    // ========================================================
    public Set<String> getVuelosCancelados(Long simulacionId) {
        return vuelosCanceladosPorSimulacion.getOrDefault(simulacionId, java.util.Collections.emptySet());
    }

    public void cancelarVueloSimulacion(Long simulacionId, String origen, String destino, LocalDateTime fechaSalida) {
        AeropuertoEntity origAero = aeropuertoRepository.findById(origen).orElse(null);
        int gmt = origAero != null ? origAero.getGmt() : 0;
        LocalDateTime fechaSalidaUtc = fechaSalida.minusHours(gmt);

        // Normalize the key to UTC format without seconds to avoid formatting mismatches
        String clave = origen + "-" + destino + "-" + fechaSalidaUtc.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"));
        vuelosCanceladosPorSimulacion.computeIfAbsent(simulacionId, k -> ConcurrentHashMap.newKeySet()).add(clave);
        
        log.info("Vuelo cancelado en simulación {} (UTC normalizado): {}", simulacionId, clave);

        // Obtener pedidos afectados (usando la hora que nos manda el frontend tal cual)
        List<Map<String, Object>> afectadosInfo = obtenerPedidosAfectadosSimulacion(simulacionId, origen, destino, fechaSalida);
        if (afectadosInfo.isEmpty()) return;

        // Extraer los IDs de los envíos
        List<String> envioIdsStr = afectadosInfo.stream()
                .map(m -> m.get("id").toString())
                .toList();

        SimulacionEntity sim = simulacionRepository.findById(simulacionId)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));
        LocalDateTime cursor = sim.getCursorTemporal();

        PlanificationProblemInput inputMaestro = inputMaestroMap.get(simulacionId);
        List<EnvioAlgoritmo> aReplanificar = new ArrayList<>();

        for (String envioId : envioIdsStr) {
            EnvioEntity envio = envioRepository.findById(envioId).orElse(null);
            if (envio == null) continue;

            // No procesar envíos con origen igual a destino (caso inválido)
            if (envio.getOrigenOaci().equals(envio.getDestinoOaci())) {
                log.warn("Envío {} tiene origen {} igual a destino {}, saltando",
                        envio.getId(), envio.getOrigenOaci(), envio.getDestinoOaci());
                continue;
            }

            // Obtener todas las asignaciones de este envío, ordenadas por ordenVuelo
            List<AsignacionEnvioEntity> todasAsig = asignacionEnvioRepository.findAll().stream()
                    .filter(a -> a.getEnvioId().equals(envioId))
                    .sorted(Comparator.comparing(AsignacionEnvioEntity::getOrdenVuelo))
                    .toList();

            List<AsignacionEnvioEntity> completadas = todasAsig.stream()
                    .filter(a -> a.getFechaLlegada().isBefore(cursor))
                    .toList();

            // Separar las asignaciones futuras en dos categorías:
            // - enTransito: vuelos que ya despegaron pero no han llegado (el envío está en el aire)
            // - porDespegar: vuelos que aún no han despegado (incluyendo el vuelo cancelado)
            List<AsignacionEnvioEntity> enTransito = todasAsig.stream()
                    .filter(a -> a.getFechaSalida().isBefore(cursor) && !a.getFechaLlegada().isBefore(cursor))
                    .toList();

            List<AsignacionEnvioEntity> porDespegar = todasAsig.stream()
                    .filter(a -> !a.getFechaSalida().isBefore(cursor))
                    .toList();

            // Filtrar los vuelos en tránsito para excluir el vuelo cancelado
            List<AsignacionEnvioEntity> enTransitoSinCancelado = new ArrayList<>();
            for (AsignacionEnvioEntity asig : enTransito) {
                VueloEntity vuelo = vueloRepository.findById(asig.getVueloId()).orElse(null);
                if (vuelo != null) {
                    boolean esVueloCancelado = vuelo.getOrigenOaci().equals(origen) &&
                                              vuelo.getDestinoOaci().equals(destino) &&
                                              asig.getFechaSalida().toLocalDate().equals(fechaSalida.toLocalDate());
                    if (!esVueloCancelado) {
                        enTransitoSinCancelado.add(asig);
                    }
                }
            }

            // Restar capacidades de las asignaciones por despegar (incluyendo el vuelo cancelado)
            restarCapacidadAsignaciones(simulacionId, porDespegar, inputMaestro, envio);

            // Eliminar solo las asignaciones por despegar de la base de datos
            // Las asignaciones en tránsito se mantienen hasta que el vuelo llegue
            asignacionEnvioRepository.deleteAll(porDespegar);

            // Determinar ubicación actual y preparar EnvioAlgoritmo para replanificación
            String currentLocation = envio.getOrigenOaci();
            LocalDateTime tiempoInicioAlmacen = envio.getFechaHoraRegistro(); // Por defecto, desde que se registró el envío

            log.info("Envío {}: origen={}, destino={}, enTransito={}, enTransitoSinCancelado={}, completadas={}",
                    envio.getId(), envio.getOrigenOaci(), envio.getDestinoOaci(),
                    enTransito.size(), enTransitoSinCancelado.size(), completadas.size());

            if (!enTransitoSinCancelado.isEmpty()) {
                // El envío está en tránsito en un vuelo diferente al cancelado: su ubicación actual es el destino del primer vuelo en tránsito
                AsignacionEnvioEntity firstInTransit = enTransitoSinCancelado.get(0);
                VueloEntity vuelo = vueloRepository.findById(firstInTransit.getVueloId()).orElse(null);
                if (vuelo != null && !vuelo.getDestinoOaci().equals(envio.getDestinoOaci())) {
                    currentLocation = vuelo.getDestinoOaci();
                    tiempoInicioAlmacen = firstInTransit.getFechaLlegada(); // Empezará a contar en almacén desde que llegue
                    log.info("Envío {} en tránsito hacia {}", envio.getId(), currentLocation);
                }
            } else if (!completadas.isEmpty()) {
                // El envío ya llegó a su último destino: su ubicación actual es el destino del último vuelo completado
                AsignacionEnvioEntity lastCompleted = completadas.get(completadas.size() - 1);
                VueloEntity vuelo = vueloRepository.findById(lastCompleted.getVueloId()).orElse(null);
                if (vuelo != null && !vuelo.getDestinoOaci().equals(envio.getDestinoOaci())) {
                    currentLocation = vuelo.getDestinoOaci();
                    tiempoInicioAlmacen = lastCompleted.getFechaLlegada(); // Ya está en almacén desde que llegó
                    log.info("Envío {} completado en {}", envio.getId(), currentLocation);
                }
            }
            // Si no hay vuelos en tránsito ni completados, currentLocation sigue siendo el origen
            log.info("Envío {} currentLocation={}, tiempoInicioAlmacen={}",
                    envio.getId(), currentLocation, tiempoInicioAlmacen);

            // No replanificar si el envío ya está en su destino final
            if (currentLocation.equals(envio.getDestinoOaci())) {
                log.warn("Envío {} ya está en destino final {}, saltando replanificación",
                        envio.getId(), currentLocation);
                continue;
            }

            EnvioAlgoritmo ea = new EnvioAlgoritmo();
            ea.setId(envio.getId());
            ea.setOrigenOaci(currentLocation);
            ea.setDestinoOaci(envio.getDestinoOaci());
            ea.setFechaHoraRegistro(cursor); // Se replanifica desde el momento actual
            ea.setCantidadMaletas(envio.getCantidadMaletas());
            aReplanificar.add(ea);

            log.info("Envío {} replanificado: {} -> {}", envio.getId(), currentLocation, envio.getDestinoOaci());

            // Mantener ocupación del almacén desde tiempoInicioAlmacen hasta el fin del día de simulación
            // para asegurar que el envío siga contándose mientras espera replanificación
            if (tiempoInicioAlmacen.isBefore(cursor.plusDays(1))) {
                Map<String, int[]> ocupacionGlobalAlmacenes = inputMaestro.getOcupacionGlobalAlmacenes();
                int[] almacen = ocupacionGlobalAlmacenes.get(currentLocation);
                if (almacen != null) {
                    int idxInicio = TimeUtils.getIndiceMinuto(tiempoInicioAlmacen);
                    int idxFin = TimeUtils.getIndiceMinuto(cursor.plusDays(1)); // Hasta fin del día
                    if (TimeUtils.intervaloAlmacenValido(idxInicio, idxFin)) {
                        for (int i = idxInicio; i < idxFin; i++) {
                            almacen[i] = Math.min(almacen[i] + envio.getCantidadMaletas(), 10000); // Agregar ocupación temporal
                        }
                    }
                }
            }

            // Actualizar estado del envío a PENDIENTE para que la UI y el scheduler lo consideren
            envio.setEstado(EnvioEntity.EstadoEnvio.PENDIENTE);
            envioRepository.save(envio);
        }

        // Agregar envíos a la cola de replanificación de la simulación
        enviosAReplanificarPorSimulacion.computeIfAbsent(simulacionId, k -> new ArrayList<>()).addAll(aReplanificar);

        // Notificar al frontend que deben recargar
        messagingTemplate.convertAndSend("/topic/simulacion/" + simulacionId, Map.of(
            "tipo", "VUELO_CANCELADO",
            "origen", origen,
            "destino", destino,
            "claveVuelo", clave,
            "afectadosIds", envioIdsStr
        ));
    }

    private void restarCapacidadAsignaciones(Long simulacionId, List<AsignacionEnvioEntity> aBorrar, PlanificationProblemInput inputMaestro, EnvioEntity envio) {
        if (inputMaestro == null || aBorrar.isEmpty() || envio == null) return;

        Map<String, Integer> ocupacionGlobalVuelos = inputMaestro.getOcupacionGlobalVuelos();
        Map<String, int[]> ocupacionGlobalAlmacenes = inputMaestro.getOcupacionGlobalAlmacenes();

        // Buscar todas las asignaciones del envío para determinar si es un vuelo directo único
        List<AsignacionEnvioEntity> todasAsignaciones = asignacionEnvioRepository.findByEnvioIdOrderByOrdenVueloAsc(envio.getId());

        boolean esVueloDirectoUnico = todasAsignaciones.size() == 1;

        for (AsignacionEnvioEntity asig : aBorrar) {
            VueloEntity vuelo = vueloRepository.findById(asig.getVueloId()).orElse(null);
            if (vuelo == null) continue;

            // Restar capacidad del vuelo utilizando el formato de clave de vuelo correcto (Origen-Destino-HoraSalida(UTC)-Fecha)
            VueloAlgoritmo va = dataMapper.toVueloAlgoritmo(vuelo);
            String claveVuelo = va.getOrigenOaci() + "-" + va.getDestinoOaci() + "-" + va.getHoraSalida() + "-" + asig.getFechaSalida().toLocalDate();
            int usoActual = ocupacionGlobalVuelos.getOrDefault(claveVuelo, 0);
            ocupacionGlobalVuelos.put(claveVuelo, Math.max(0, usoActual - envio.getCantidadMaletas()));

            // Si es un vuelo directo único, NO restar capacidad del almacén de origen
            // porque el envío sigue en el almacén esperando replanificación
            if (esVueloDirectoUnico) {
                continue;
            }

            // Restar capacidad del almacén de origen solo para rutas con escalas
            String oaci = vuelo.getOrigenOaci();

            // Determinar el inicio de la estadía en el almacén de origen
            LocalDateTime llegadaAlOrigen = envio.getFechaHoraRegistro();

            int indexAsig = -1;
            for (int idx = 0; idx < todasAsignaciones.size(); idx++) {
                if (todasAsignaciones.get(idx).getId().equals(asig.getId())) {
                    indexAsig = idx;
                    break;
                }
            }

            if (indexAsig > 0) {
                llegadaAlOrigen = todasAsignaciones.get(indexAsig - 1).getFechaLlegada();
            }

            int idxInicio = TimeUtils.getIndiceMinuto(llegadaAlOrigen);
            int idxFin = TimeUtils.getIndiceMinuto(asig.getFechaSalida());

            int[] almacen = ocupacionGlobalAlmacenes.get(oaci);
            if (almacen != null && TimeUtils.intervaloAlmacenValido(idxInicio, idxFin)) {
                for (int i = idxInicio; i < idxFin; i++) {
                    almacen[i] = Math.max(0, almacen[i] - envio.getCantidadMaletas());
                }
            }
            
            // Si es la última asignación de la ruta original, restar también la estadía de 15 min en el destino final
            if (indexAsig == todasAsignaciones.size() - 1) {
                String oaciDest = vuelo.getDestinoOaci();
                LocalDateTime llegadaDest = asig.getFechaLlegada();
                LocalDateTime recogidaCliente = llegadaDest.plusMinutes(VueloSelector.DESTINO_FINAL_MINUTES); // 15 min de handling
                
                int idxInicioDest = TimeUtils.getIndiceMinuto(llegadaDest);
                int idxFinDest = TimeUtils.getIndiceMinuto(recogidaCliente);
                
                int[] almacenDest = ocupacionGlobalAlmacenes.get(oaciDest);
if (almacenDest != null && TimeUtils.intervaloAlmacenValido(idxInicioDest, idxFinDest)) {
                    for (int i = idxInicioDest; i < idxFinDest; i++) {
                        almacenDest[i] = Math.max(0, almacenDest[i] - envio.getCantidadMaletas());
                    }
                }
            }
        }
    }

    // ========================================================
    // HEARTBEAT
    // ========================================================
    public void registrarHeartbeat(Long simulacionId) {
        lastHeartbeatMap.put(simulacionId, System.currentTimeMillis());
    }

    @Scheduled(fixedRate = 60000)
    public void revisarSimulacionesInactivas() {
        long now = System.currentTimeMillis();
        long limiteInactividad = 300_000L; // 5 minutos

        for (Map.Entry<Long, Long> entry : lastHeartbeatMap.entrySet()) {
            Long simulacionId = entry.getKey();
            Long ultimoLatido = entry.getValue();

            if (now - ultimoLatido > limiteInactividad) {
                log.warn("La simulación {} ha superado el tiempo límite de inactividad (5 min). Cancelando automáticamente...", simulacionId);
                try {
                    cancelarSimulacion(simulacionId);
                } catch (Exception e) {
                    log.error("Error al auto-cancelar simulación huérfana {}", simulacionId, e);
                    // Asegurar limpieza de memoria si falló la DB
                    lastHeartbeatMap.remove(simulacionId);
                    pauseFlags.remove(simulacionId);
                }
            }
        }
    }

    public List<Map<String, Object>> obtenerPedidosAfectadosSimulacion(Long simulacionId, String origen, String destino, LocalDateTime fechaSalida) {
        // Encontrar el ID del vuelo
        java.time.LocalTime horaSalida = fechaSalida.toLocalTime();
        
        List<VueloEntity> vuelos = vueloRepository.findAll().stream()
                .filter(v -> v.getOrigenOaci().equals(origen) && v.getDestinoOaci().equals(destino))
                .filter(v -> v.getHoraSalida().equals(horaSalida))
                .toList();
                
        if (vuelos.isEmpty()) return Collections.emptyList();
        Long vueloId = vuelos.get(0).getId();

        // Encontrar los últimos bloques procesados de la simulación
        List<Long> bloquesSimulacion = bloqueResultadoRepository.findBySimulacionIdOrderByNumeroBloqueAsc(simulacionId)
                .stream().map(BloqueResultadoEntity::getId).toList();
                
        if (bloquesSimulacion.isEmpty()) return Collections.emptyList();

        // Calcular la hora en UTC para buscar en las asignaciones de la base de datos
        AeropuertoEntity origAero = aeropuertoRepository.findById(origen).orElse(null);
        int gmt = origAero != null ? origAero.getGmt() : 0;
        LocalDateTime fechaSalidaDb = fechaSalida.minusHours(gmt);

        // Buscar en las asignaciones
        List<AsignacionEnvioEntity> asignaciones = asignacionEnvioRepository.findAll().stream()
                .filter(a -> bloquesSimulacion.contains(a.getBloqueResultadoId()))
                .filter(a -> a.getVueloId().equals(vueloId))
                .filter(a -> Math.abs(java.time.temporal.ChronoUnit.SECONDS.between(a.getFechaSalida(), fechaSalidaDb)) < 60)
                .toList();

        List<Map<String, Object>> afectados = new ArrayList<>();
        Set<String> enviosProcesados = new HashSet<>();
        
        for (AsignacionEnvioEntity asig : asignaciones) {
            if (enviosProcesados.contains(asig.getEnvioId())) continue;
            enviosProcesados.add(asig.getEnvioId());
            
            envioRepository.findById(asig.getEnvioId()).ifPresent(envio -> {
                Map<String, Object> dto = new LinkedHashMap<>();
                dto.put("id", envio.getId());
                dto.put("cantidadMaletas", envio.getCantidadMaletas());
                dto.put("nombreAerolinea", "SUITChASE Airlines"); 
                afectados.add(dto);
            });
        }
        
        return afectados;
    }

    // ========================================================
    // LOOP ASÍNCRONO DE BLOQUES — el corazón del sistema
    // ========================================================
    @Async
    public void ejecutarSimulacionAsync(Long simulacionId) {
        if (!simulacionesEnEjecucion.add(simulacionId)) {
            log.warn("Simulación {} ya tiene un proceso en ejecución; se ignora la invocación duplicada.", simulacionId);
            return;
        }
        try {
            ejecutarSimulacionAsyncInterno(simulacionId);
        } finally {
            // Limpiar solo cuando se cancela o finaliza; NO limpiar en pausa
            SimulacionEntity sim = simulacionRepository.findById(simulacionId).orElse(null);
            if (sim == null || (sim.getEstado() != EstadoSimulacion.PAUSADA && sim.getEstado() != EstadoSimulacion.EJECUTANDO)) {
                envioFileReader.finalizarLecturaSimulacion(simulacionId);
                inputMaestroMap.remove(simulacionId); // Limpiar inputMaestro solo en cancelación/finalización
                aeropuertosMap.remove(simulacionId);
                vuelosMap.remove(simulacionId);
                indiceVuelosMap.remove(simulacionId);
                lastHeartbeatMap.remove(simulacionId);
            }
            simulacionesEnEjecucion.remove(simulacionId);
        }
    }

    private void ejecutarSimulacionAsyncInterno(Long simulacionId) {
        SimulacionEntity sim = simulacionRepository.findById(simulacionId)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));

        int sa = sim.getSaltoAlgoritmoSa();
        int ta = sim.getTiempoAlgoritmoTa();
        int bloqueActual = sim.getBloqueActual();

        TimeUtils.configurarRangoSimulacion(sim.getFechaInicioSim(), sim.getFechaFinSim());
        if(bloqueActual == 0) {
            envioFileReader.iniciarLecturaSimulacion(simulacionId, sim.getFechaInicioSim(), sim.getFechaFinSim());
        }

        // --- Obtener o crear inputMaestro (reutilizar si se está reanudando) ---
        PlanificationProblemInput inputMaestro = inputMaestroMap.get(simulacionId);
        List<AeropuertoAlgoritmo> aeropuertos = aeropuertosMap.get(simulacionId);
        List<VueloAlgoritmo> vuelos = vuelosMap.get(simulacionId);
        Map<String, VueloAlgoritmo> indiceVuelos = indiceVuelosMap.get(simulacionId);
        // vuelosCancelados se re-lee en cada iteración del loop (no cachear aquí)
        
        if (inputMaestro == null) {
            // Primera ejecución: cargar aeropuertos y vuelos
            aeropuertos = aeropuertoRepository.findAll().stream()
                    .map(dataMapper::toAeropuertoAlgoritmo)
                    .collect(Collectors.toList());

            vuelos = vueloRepository.findAll().stream()
                    .map(dataMapper::toVueloAlgoritmo)
                    .collect(Collectors.toList());

            // Construir input maestro (aeropuertos + vuelos + estado global compartido)
            inputMaestro = new PlanificationProblemInput();
            aeropuertos.forEach(inputMaestro::agregarAeropuerto);
            vuelos.forEach(inputMaestro::agregarVuelo);
            
            // Preparar índice de vuelos
            indiceVuelos = new HashMap<>();
            prepararIndiceVuelos(indiceVuelos, vuelos, sim.getFechaInicioSim(), sim.getFechaFinSim());
            
            // Guardar en los mapas para reutilizar en pausas/reanudaciones
            inputMaestroMap.put(simulacionId, inputMaestro);
            aeropuertosMap.put(simulacionId, aeropuertos);
            vuelosMap.put(simulacionId, vuelos);
            indiceVuelosMap.put(simulacionId, indiceVuelos);
            log.info("InputMaestro creado para simulación {}", simulacionId);
        } else {
            // Reanudación: refrescar capacidades de aeropuertos desde la BD para que
            // los cambios hechos (ej. editar capacidad en pantalla de gestión) se reflejen.
            List<AeropuertoAlgoritmo> aeropuertosActualizados = aeropuertoRepository.findAll().stream()
                    .map(dataMapper::toAeropuertoAlgoritmo)
                    .collect(Collectors.toList());
            for (AeropuertoAlgoritmo aero : aeropuertosActualizados) {
                AeropuertoAlgoritmo existing = inputMaestro.getAeropuerto(aero.getOaci());
                if (existing == null || existing.getCapacidadAlmacen() != aero.getCapacidadAlmacen()) {
                    inputMaestro.agregarAeropuerto(aero);
                    if (existing != null) {
                        log.info("[Sim {}] Capacidad de {} actualizada: {} -> {}",
                                simulacionId, aero.getOaci(), existing.getCapacidadAlmacen(), aero.getCapacidadAlmacen());
                    }
                }
            }
            log.info("InputMaestro reutilizado para simulación {} (continuando desde bloque {})", simulacionId, bloqueActual);
        }

        Map<String, AeropuertoAlgoritmo> mapaAeropuertos = aeropuertos.stream()
                .collect(Collectors.toMap(AeropuertoAlgoritmo::getOaci, a -> a, (a, b) -> a));

        // Cursor: posición actual en el tiempo simulado
        LocalDateTime cursor = sim.getCursorTemporal();

        log.info("Simulación {} iniciada/reanudada. Cursor: {}, Bloque: {}/{}",
                simulacionId, cursor, bloqueActual, sim.getTotalBloquesEstimados());

        // Ancla de reloj real: bloque n inicia en (n-1)*Sa y termina su ventana en n*Sa (segundos)
        // NOTA: no es final — se recalcula tras cada pausa para que el timing no quede obsoleto
        final long saPeriodoMs = (long) sa * 60_000L;
        long wallClockAnchorMs = bloqueActual > 0
                ? System.currentTimeMillis() - (long) bloqueActual * saPeriodoMs
                : System.currentTimeMillis();

        // ═══════════════════════════════════════════════════
        // LOOP DE BLOQUES
        // ═══════════════════════════════════════════════════
        while (cursor.isBefore(sim.getFechaFinSim())) {
            sim = simulacionRepository.findById(simulacionId).orElse(sim);

            // ¿Se pidió pausa o cancelación?
            Boolean paused = pauseFlags.get(simulacionId);
            if (paused == null) {
                // Simulación fue cancelada/finalizada; salir del loop
                log.info("Simulación {} - bandera de pausa removida, finalizando", simulacionId);
                break;
            }
            
            if (paused) {
                // PAUSA: esperar aquí sin romper el loop, preservando inputMaestro
                log.info("Simulación {} pausada en bloque {}. Esperando...", simulacionId, bloqueActual);
                if (!esperarHastaDespausa(simulacionId)) {
                    // La simulación fue cancelada durante la pausa
                    break;
                }
                // Recalcular el ancla de reloj real tras la pausa.
                // Sin esto, todos los slotStartMs y slotEndMs quedarían en el pasado
                // y la simulación correría todos los bloques restantes sin respetar el timing.
                wallClockAnchorMs = System.currentTimeMillis() - (long) bloqueActual * saPeriodoMs;
                log.info("Simulación {} reanudada. Ancla de timing recalculada. Continuando desde bloque {}", simulacionId, bloqueActual);
                continue; // Volver al inicio del loop
            }

            // --- Recargar K desde DB (por si cambió en caliente) ---
            SimulacionEntity simActual = simulacionRepository.findById(simulacionId).orElse(null);
            if (simActual == null) return;

            TimeUtils.configurarRangoSimulacion(simActual.getFechaInicioSim(), simActual.getFechaFinSim());
            normalizarArreglosOcupacionAlmacen(inputMaestro.getOcupacionGlobalAlmacenes());

            int k = simActual.getConstanteK();
            int sc = k * sa;

            LocalDateTime finVentana = cursor.plusMinutes(sc);
            if (finVentana.isAfter(sim.getFechaFinSim())) {
                finVentana = sim.getFechaFinSim();
            }

            // 1. LEER ENVÍOS del índice en memoria (cargado una vez al inicio, como Planificador)
            List<EnvioAlgoritmo> enviosBloque = envioFileReader.leerEnviosPorRango(simulacionId, cursor, finVentana);
            
            // Inyectar envíos que fueron afectados por cancelaciones para ser replanificados
            List<EnvioAlgoritmo> aReplanificar = enviosAReplanificarPorSimulacion.remove(simulacionId);
            if (aReplanificar != null && !aReplanificar.isEmpty()) {
                // Actualizar fechaHoraRegistro al cursor actual para que el algoritmo
                // pueda encontrar vuelos futuros (si no, la fecha original está en el pasado
                // y VueloSelector no encuentra ningún vuelo disponible)
                for (EnvioAlgoritmo ea : aReplanificar) {
                    if (ea.getFechaHoraRegistro().isBefore(cursor)) {
                        ea.setFechaHoraRegistro(cursor);
                    }
                }
                enviosBloque.addAll(aReplanificar);
                log.info("Inyectando {} envíos a replanificar en el bloque {}", aReplanificar.size(), bloqueActual + 1);
            }
            
            boolean bloqueVacio = enviosBloque.isEmpty();

            bloqueActual++;

            long slotStartMs = wallClockAnchorMs + (long) (bloqueActual - 1) * saPeriodoMs;
            if (bloqueActual > simActual.getSkipSleepUntilBlock()) {
                if (!esperarHastaInterruptible(simulacionId, slotStartMs)) {
                    return;
                }
            }

            long t0 = System.currentTimeMillis();

            BloqueResultadoEntity bloqueRes = new BloqueResultadoEntity();
            bloqueRes.setSimulacionId(simulacionId);
            bloqueRes.setNumeroBloque(bloqueActual);
            bloqueRes.setInicioVentana(cursor);
            bloqueRes.setFinVentana(finVentana);
            bloqueRes.setTotalEnvios(enviosBloque.size());

            // Datos para el mensaje WebSocket enriquecido
            List<Map<String, Object>> rutasResumen = new ArrayList<>();
            PlanificationSolutionOutput solucion = null;

            if (!enviosBloque.isEmpty()) {
                // Re-leer vuelos cancelados del mapa concurrente (puede haber nuevas cancelaciones desde el último bloque)
                Set<String> vuelosCancelados = vuelosCanceladosPorSimulacion.getOrDefault(simulacionId, Collections.emptySet());
                // Actualizar inputMaestro para que crearSubInput propague las cancelaciones
                inputMaestro.setVuelosCancelados(vuelosCancelados);
                
                // 2. Crear sub-input con los envíos del bloque
                PlanificationProblemInput subInput = inputMaestro.crearSubInput(enviosBloque);

                // 3. Ejecutar ACS
                long tiempoMs = (long) ta * 1000L;
                solucion = ACSAdapter.planificar(subInput, tiempoMs);

                // --- PROGRESSIVE SPLITTING LOGIC FOR SIMULATION ---
                List<EnvioAlgoritmo> enviosParaDividir = new ArrayList<>();
                for (EnvioAlgoritmo env : enviosBloque) {
                    ResultadoRuta ruta = solucion.getRuta(env);
                    boolean exitoso = false;
                    if (ruta != null && !ruta.vuelosUsados.isEmpty()) {
                        String destinoAlcanzado = ruta.vuelosUsados.get(ruta.vuelosUsados.size() - 1).getDestinoOaci();
                        if (destinoAlcanzado.equals(env.getDestinoOaci())) {
                            exitoso = true;
                        }
                    }
                    if (!exitoso && env.getCantidadMaletas() > 1) {
                        enviosParaDividir.add(env);
                    }
                }

                if (!enviosParaDividir.isEmpty()) {
                    log.info("Simulación {} - Se detectaron {} envíos que no pudieron planificarse completos y se intentarán dividir.", simulacionId, enviosParaDividir.size());
                    enviosBloque.removeAll(enviosParaDividir);

                    for (EnvioAlgoritmo env : enviosParaDividir) {
                        String originalId = env.getId();
                        int totalMaletas = env.getCantidadMaletas();
                        boolean divisionExitosa = false;
                        List<EnvioAlgoritmo> subEnviosAceptados = new ArrayList<>();
                        PlanificationSolutionOutput solucionSubAceptada = null;

                        // Intentar dividir en P partes, de P=2 hasta P=totalMaletas
                        for (int p = 2; p <= totalMaletas; p++) {
                            // Backup capacities
                            Map<String, Integer> backupVuelos = new HashMap<>(inputMaestro.getOcupacionGlobalVuelos());
                            Map<String, int[]> backupAlmacenes = new HashMap<>();
                            for (Map.Entry<String, int[]> entry : inputMaestro.getOcupacionGlobalAlmacenes().entrySet()) {
                                backupAlmacenes.put(entry.getKey(), entry.getValue().clone());
                            }

                            List<Integer> tamaños = partition(totalMaletas, p);
                            List<EnvioAlgoritmo> subEnviosIntentar = new ArrayList<>();
                            for (int i = 0; i < tamaños.size(); i++) {
                                EnvioAlgoritmo subEnv = new EnvioAlgoritmo();
                                subEnv.setId(originalId + "-" + (i + 1));
                                subEnv.setOrigenOaci(env.getOrigenOaci());
                                subEnv.setDestinoOaci(env.getDestinoOaci());
                                subEnv.setFechaHoraRegistro(env.getFechaHoraRegistro());
                                subEnv.setCantidadMaletas(tamaños.get(i));
                                subEnv.setClienteId(env.getClienteId());
                                subEnviosIntentar.add(subEnv);
                            }

                            PlanificationProblemInput subInputIntentar = inputMaestro.crearSubInput(subEnviosIntentar);
                            PlanificationSolutionOutput solucionSubIntentar = ACSAdapter.planificar(subInputIntentar, tiempoMs);

                            // Verificar si todos los sub-envíos se pudieron planificar
                            boolean todosPlanificados = true;
                            for (EnvioAlgoritmo subEnv : subEnviosIntentar) {
                                ResultadoRuta rutaSub = solucionSubIntentar.getRuta(subEnv);
                                boolean subExitoso = false;
                                if (rutaSub != null && !rutaSub.vuelosUsados.isEmpty()) {
                                    String destinoAlcanzado = rutaSub.vuelosUsados.get(rutaSub.vuelosUsados.size() - 1).getDestinoOaci();
                                    if (destinoAlcanzado.equals(subEnv.getDestinoOaci())) {
                                        subExitoso = true;
                                    }
                                }
                                if (!subExitoso) {
                                    todosPlanificados = false;
                                    break;
                                }
                            }

                            if (todosPlanificados) {
                                // ¡Éxito! Encontramos la división óptima con menor número de subenvíos
                                divisionExitosa = true;
                                subEnviosAceptados = subEnviosIntentar;
                                solucionSubAceptada = solucionSubIntentar;
                                log.info("Simulación {} - Envio {} dividido exitosamente en {} partes.", simulacionId, originalId, p);
                                break;
                            } else {
                                // Falló la planificación de esta partición
                                // Restaurar capacities
                                inputMaestro.getOcupacionGlobalVuelos().clear();
                                inputMaestro.getOcupacionGlobalVuelos().putAll(backupVuelos);
                                inputMaestro.getOcupacionGlobalAlmacenes().clear();
                                inputMaestro.getOcupacionGlobalAlmacenes().putAll(backupAlmacenes);

                                if (p == totalMaletas) {
                                    // Llegamos al límite (1 maleta por subenvío). Debemos aceptar este resultado
                                    subEnviosAceptados = subEnviosIntentar;
                                    solucionSubAceptada = solucionSubIntentar;
                                    log.info("Simulación {} - Envio {} no se pudo dividir exitosamente por completo. Se acepta división máxima de {} partes.", simulacionId, originalId, p);
                                }
                            }
                        }

                        // Persistir la división en DB si el envío original ya existía
                        envioRepository.findById(originalId).ifPresent(envioOriginal -> {
                            envioRepository.delete(envioOriginal);
                        });

                        // Agregar los sub-envíos a enviosBloque y a la solución principal
                        for (EnvioAlgoritmo subEnv : subEnviosAceptados) {
                            enviosBloque.add(subEnv);
                            ResultadoRuta rutaSub = solucionSubAceptada.getRuta(subEnv);
                            solucion.agregarRuta(subEnv, rutaSub);
                        }

                        // Remover el envío original de la solución principal
                        solucion.getEnviosPlanificados().remove(env);
                        solucion.getMapaRutas().remove(env.getOrigenOaci() + "-" + env.getId());
                    }

                    // Recalcular SLA promedio y ocupación del bloque con los nuevos envíos
                    solucion.calcularPromedioConsumoSLA(inputMaestro.getMapaAeropuertos());
                    int minutosVentana = (int) ChronoUnit.MINUTES.between(
                            bloqueRes.getInicioVentana(), bloqueRes.getFinVentana());
                    solucion.calcularEstadisticasOcupacion(
                            indiceVuelos, mapaAeropuertos, bloqueRes.getInicioVentana(), minutosVentana);
                }

                // ¿Se pidió pausa o cancelación durante la ejecución del algoritmo?
                paused = pauseFlags.get(simulacionId);
                if (paused != null && paused) {
                    log.info("Simulación {} pausada/cancelada tras la planificación en el bloque {}. Descartando guardado.", simulacionId, bloqueActual);
                    // NO hacer return; dejar que continúe el loop y entre a la pausa
                    continue;
                }
                if (paused == null) {
                    log.info("Simulación {} cancelada durante la planificación en bloque {}", simulacionId, bloqueActual);
                    break;
                }

                long duracion = System.currentTimeMillis() - t0;

                int minutosVentana = (int) ChronoUnit.MINUTES.between(
                        bloqueRes.getInicioVentana(), bloqueRes.getFinVentana());
                solucion.calcularEstadisticasOcupacion(
                        indiceVuelos, mapaAeropuertos, bloqueRes.getInicioVentana(), minutosVentana);

                // 4. Guardar métricas del bloque
                bloqueRes.setTotalEnvios(enviosBloque.size());
                bloqueRes.setEnviosConRuta(solucion.enviosConRuta());
                bloqueRes.setEnviosSinRuta(enviosBloque.size() - solucion.enviosConRuta());
                bloqueRes.setPromedioSla(solucion.getPromedioConsumoSLA());
                bloqueRes.setOcupacionVuelos(solucion.getOcupacionVuelosPonderada());
                bloqueRes.setOcupacionAlmacenes(solucion.getOcupacionAlmacenesPonderada());
                bloqueRes.setDuracionMs(duracion);

                bloqueResultadoRepository.save(bloqueRes);

                // 5. Persistir rutas asignadas
                persistirAsignaciones(solucion, bloqueRes.getId());

                // 6. Construir resumen de rutas para WebSocket
                rutasResumen = construirResumenRutas(solucion, enviosBloque);

                log.info("Bloque {}/{} | K={} Sc={}min | Envíos: {} | ConRuta: {} | SLA: {}% | {}ms",
                        bloqueActual, simActual.getTotalBloquesEstimados(),
                        k, sc, enviosBloque.size(), solucion.enviosConRuta(),
                        String.format("%.2f", solucion.getPromedioConsumoSLA()), duracion);
            } else {
                paused = pauseFlags.get(simulacionId);
                if (paused != null && paused) {
                    log.info("Simulación {} pausada en el bloque {} (vacío).", simulacionId, bloqueActual);
                    // NO hacer return; dejar que continúe el loop y entre a la pausa
                    continue;
                }
                if (paused == null) {
                    log.info("Simulación {} cancelada en bloque {} (vacío).", simulacionId, bloqueActual);
                    break;
                }
                bloqueRes.setDuracionMs(System.currentTimeMillis() - t0);
                log.debug("Bloque {}/{} — sin envíos (K={}, Sc={}min), cursor {}",
                        bloqueActual, simActual.getTotalBloquesEstimados(), k, sc, cursor);
            }

            // 7. Avanzar cursor
            cursor = cursor.plusMinutes(sc);

            // 8. Actualizar estado en DB
            simActual.setCursorTemporal(cursor);
            simActual.setBloqueActual(bloqueActual);
            simulacionRepository.save(simActual);

            // 9. Notificar frontend (bloques vacíos: mensaje ligero; con envíos: mensaje completo)
            Map<String, Object> wsMessage = new LinkedHashMap<>();
            wsMessage.put("simulacionId", simulacionId);
            wsMessage.put("bloqueActual", bloqueActual);
            wsMessage.put("totalBloques", simActual.getTotalBloquesEstimados());
            wsMessage.put("cursor", cursor.toString());
            wsMessage.put("estado", simActual.getEstado().name());
            wsMessage.put("k", k);
            wsMessage.put("inicioVentana", bloqueRes.getInicioVentana().toString());

            Map<String, Object> metricas = new LinkedHashMap<>();
            metricas.put("totalEnvios", bloqueRes.getTotalEnvios());
            metricas.put("enviosConRuta", bloqueRes.getEnviosConRuta());
            metricas.put("enviosSinRuta", bloqueRes.getEnviosSinRuta());
            metricas.put("sla", bloqueRes.getPromedioSla());
            metricas.put("ocupacionVuelos", bloqueRes.getOcupacionVuelos());
            metricas.put("ocupacionAlmacenes", bloqueRes.getOcupacionAlmacenes());
            metricas.put("duracionMs", bloqueRes.getDuracionMs());
            wsMessage.put("metricas", metricas);

            if (bloqueVacio) {
                wsMessage.put("bloqueVacio", true);
                wsMessage.put("rutasResumen", List.of());
            } else {
                wsMessage.put("rutasResumen", rutasResumen);
                wsMessage.put("bloqueId", bloqueRes.getId());
                if (solucion != null) {
                    wsMessage.put("estadoOcupacionAlmacenes", solucion.getEstadoOcupacionAlmacenes());
                    wsMessage.put("estadoCapacidadesVuelos", solucion.getEstadoCapacidadesVuelos());
                }
            }
            messagingTemplate.convertAndSend("/topic/simulacion/" + simulacionId, wsMessage);

            long slotEndMs = wallClockAnchorMs + (long) bloqueActual * saPeriodoMs;
            long duracionAlgoritmoSeg = (System.currentTimeMillis() - t0) / 1000;
            
            if (bloqueActual > simActual.getSkipSleepUntilBlock()) {
                long sleepSeg = Math.max(0, (slotEndMs - System.currentTimeMillis() + 999) / 1000);
                if (sleepSeg > 0) {
                    log.info("Simulación {} — Bloque {} enviado ({}s de cómputo), durmiendo hasta t={}s",
                            simulacionId, bloqueActual, duracionAlgoritmoSeg,
                            (bloqueActual * sa * 60L));
                }
                if (!esperarHastaInterruptible(simulacionId, slotEndMs)) {
                    return;
                }
            } else {
                log.info("Simulación {} — Bloque {} enviado ({}s de cómputo), skip sleep activado",
                        simulacionId, bloqueActual, duracionAlgoritmoSeg);
            }
        }

        // ═══════════════════════════════════════════════════
        // SIMULACIÓN FINALIZADA
        // ═══════════════════════════════════════════════════
        sim = simulacionRepository.findById(simulacionId).orElse(sim);
        sim.setEstado(EstadoSimulacion.FINALIZADA);
        sim.setBloqueActual(bloqueActual);
        simulacionRepository.save(sim);
        pauseFlags.remove(simulacionId);
        lastHeartbeatMap.remove(simulacionId);

        messagingTemplate.convertAndSend("/topic/simulacion/" + simulacionId, Map.of(
                "simulacionId", simulacionId,
                "estado", "FINALIZADA",
                "bloqueActual", bloqueActual,
                "totalBloques", sim.getTotalBloquesEstimados()
        ));

        log.info("Simulación {} FINALIZADA. Total bloques: {}", simulacionId, bloqueActual);
    }

    // ========================================================
    // Construir resumen de rutas para WebSocket (limitado)
    // ========================================================
    private List<Map<String, Object>> construirResumenRutas(
            PlanificationSolutionOutput solucion, List<EnvioAlgoritmo> enviosBloque) {

        List<Map<String, Object>> resumen = new ArrayList<>();

        for (EnvioAlgoritmo envio : enviosBloque) {
            ResultadoRuta ruta = solucion.getRuta(envio);
            Map<String, Object> envioResumen = new LinkedHashMap<>();
            envioResumen.put("envioId", envio.getId());
            envioResumen.put("origen", envio.getOrigenOaci());
            envioResumen.put("destino", envio.getDestinoOaci());
            envioResumen.put("maletas", envio.getCantidadMaletas());
            envioResumen.put("fechaHoraRegistro", envio.getFechaHoraRegistro() != null ? envio.getFechaHoraRegistro().toString() : null);

            if (ruta != null && ruta.vuelosUsados != null && !ruta.vuelosUsados.isEmpty()) {
                envioResumen.put("estado", "CON_RUTA");
                envioResumen.put("numTramos", ruta.vuelosUsados.size());

                // Build full list of legs with exact times
                List<Map<String, Object>> tramos = new ArrayList<>();
                for (int i = 0; i < ruta.vuelosUsados.size(); i++) {
                    VueloAlgoritmo vuelo = ruta.vuelosUsados.get(i);
                    LocalDateTime salida = ruta.fechasVuelo.get(i);
                    LocalDateTime llegada = salida.with(vuelo.getHoraLlegada());
                    if (llegada.isBefore(salida)) {
                        llegada = llegada.plusDays(1);
                    }
                    String claveVuelo = vuelo.getOrigenOaci() + "-" + vuelo.getDestinoOaci()
                            + "-" + vuelo.getHoraSalida() + "-" + salida.toLocalDate();

                    Map<String, Object> tramo = new LinkedHashMap<>();
                    tramo.put("origen", vuelo.getOrigenOaci());
                    tramo.put("destino", vuelo.getDestinoOaci());
                    tramo.put("salida", salida.toString());
                    tramo.put("llegada", llegada.toString());
                    tramo.put("claveVuelo", claveVuelo);
                    tramo.put("capacidad", vuelo.getCapacidad());
                    tramos.add(tramo);
                }
                envioResumen.put("tramos", tramos);

                // Keep legacy fields for backward compatibility
                VueloAlgoritmo primerVuelo = ruta.vuelosUsados.get(0);
                VueloAlgoritmo ultimoVuelo = ruta.vuelosUsados.get(ruta.vuelosUsados.size() - 1);
                envioResumen.put("primerTramo", primerVuelo.getOrigenOaci() + "→" + primerVuelo.getDestinoOaci());
                envioResumen.put("ultimoTramo", ultimoVuelo.getOrigenOaci() + "→" + ultimoVuelo.getDestinoOaci());
                if (!ruta.fechasVuelo.isEmpty()) {
                    envioResumen.put("salidaPrimer", ruta.fechasVuelo.get(0).toString());
                    envioResumen.put("llegadaFinal", ruta.tiempoLlegadaFinal.toString());
                }
            } else {
                envioResumen.put("estado", "SIN_RUTA");
            }

            resumen.add(envioResumen);
        }

        return resumen;
    }

    // ========================================================
    // Persistir asignaciones de ruta en DB
    // ========================================================
    private void persistirAsignaciones(PlanificationSolutionOutput solucion, Long bloqueId) {
        List<AsignacionEnvioEntity> asignaciones = new ArrayList<>();

        for (EnvioAlgoritmo envio : solucion.getEnviosPlanificados()) {
            ResultadoRuta ruta = solucion.getRuta(envio);
            if (ruta == null || ruta.vuelosUsados.isEmpty()) continue;

            // --- SOLUCIÓN DE FK CONSTRAINT ---
            // Si el envío no existe en la DB (porque se leyó de archivo sintético), lo persistimos primero
            if (!envioRepository.existsById(envio.getId())) {
                EnvioEntity nuevoEnvio = new EnvioEntity();
                nuevoEnvio.setId(envio.getId());
                nuevoEnvio.setOrigenOaci(envio.getOrigenOaci());
                nuevoEnvio.setDestinoOaci(envio.getDestinoOaci());
                nuevoEnvio.setFechaHoraRegistro(envio.getFechaHoraRegistro());
                nuevoEnvio.setCantidadMaletas(envio.getCantidadMaletas());
                nuevoEnvio.setEsSintetico(true);
                nuevoEnvio.setSimulacionId(bloqueResultadoRepository.findById(bloqueId)
                        .map(BloqueResultadoEntity::getSimulacionId).orElse(null));
                nuevoEnvio.setAerolineaId(1L); // Aerolínea por defecto para datos sintéticos
                nuevoEnvio.setEstado(EnvioEntity.EstadoEnvio.PENDIENTE);
                envioRepository.save(nuevoEnvio);
            }

            int baseOrden = asignacionEnvioRepository.findByEnvioIdOrderByOrdenVueloAsc(envio.getId()).stream()
                    .mapToInt(AsignacionEnvioEntity::getOrdenVuelo)
                    .max()
                    .orElse(0);

            for (int i = 0; i < ruta.vuelosUsados.size(); i++) {
                VueloAlgoritmo vuelo = ruta.vuelosUsados.get(i);
                LocalDateTime fechaSalida = ruta.fechasVuelo.get(i);
                LocalDateTime fechaLlegada = fechaSalida.with(vuelo.getHoraLlegada());
                if (fechaLlegada.isBefore(fechaSalida)) {
                    fechaLlegada = fechaLlegada.plusDays(1);
                }

                AsignacionEnvioEntity asig = new AsignacionEnvioEntity();
                asig.setBloqueResultadoId(bloqueId);
                asig.setEnvioId(envio.getId());
                asig.setOrdenVuelo(baseOrden + i + 1);
                asig.setVueloId(buscarVueloId(vuelo));
                asig.setFechaSalida(fechaSalida);
                asig.setFechaLlegada(fechaLlegada);
                asig.setEstado(AsignacionEnvioEntity.EstadoAsignacion.A_TIEMPO);

                asignaciones.add(asig);
            }
        }

        if (!asignaciones.isEmpty()) {
            asignacionEnvioRepository.saveAll(asignaciones);
        }
    }

    // ========================================================
    // Helper: buscar vuelo ID en DB
    // ========================================================
    private Long buscarVueloId(VueloAlgoritmo vuelo) {
        int gmtOrigen = aeropuertoRepository.findById(vuelo.getOrigenOaci())
                .map(AeropuertoEntity::getGmt).orElse(0);
        int gmtDestino = aeropuertoRepository.findById(vuelo.getDestinoOaci())
                .map(AeropuertoEntity::getGmt).orElse(0);

        java.time.LocalTime horaSalidaLocal = vuelo.getHoraSalida().plusHours(gmtOrigen);
        java.time.LocalTime horaLlegadaLocal = vuelo.getHoraLlegada().plusHours(gmtDestino);

        return vueloRepository.findByOrigenOaciAndDestinoOaciAndHoraSalidaAndHoraLlegada(
                vuelo.getOrigenOaci(), vuelo.getDestinoOaci(),
                horaSalidaLocal, horaLlegadaLocal
        ).map(v -> v.getId()).orElse(0L);
    }

    // ========================================================
    // CONSULTAS
    // ========================================================
    public SimulacionEntity obtenerSimulacion(Long id) {
        return simulacionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Simulación no encontrada"));
    }

    public List<BloqueResultadoEntity> obtenerBloques(Long simulacionId) {
        return bloqueResultadoRepository.findBySimulacionIdOrderByNumeroBloqueAsc(simulacionId);
    }

    public List<SimulacionEntity> listarSimulaciones() {
        return simulacionRepository.findAllByOrderByCreatedAtDesc();
    }

    /**
     * Obtiene las rutas detalladas de un bloque específico.
     * Usado por el endpoint GET /api/simulacion/{id}/bloques/{n}/rutas
     */
    public List<AsignacionEnvioEntity> obtenerRutasDeBloque(Long bloqueId) {
        return asignacionEnvioRepository.findByBloqueResultadoIdOrderByEnvioIdAscOrdenVueloAsc(bloqueId);
    }

    // ========================================================
    // PRUEBA (mantener compatibilidad con endpoint existente)
    // ========================================================
    public PlanificationSolutionOutput procesarBloquePrueba(LocalDateTime inicioBloque, int ventanaScMinutos, int tiempoAlgoritmoTaSegundos) {
        log.info("Iniciando prueba de bloque desde {} por {} minutos", inicioBloque, ventanaScMinutos);

        List<AeropuertoAlgoritmo> aeropuertos = aeropuertoRepository.findAll().stream()
                .map(dataMapper::toAeropuertoAlgoritmo)
                .collect(Collectors.toList());

        List<VueloAlgoritmo> vuelos = vueloRepository.findAll().stream()
                .map(dataMapper::toVueloAlgoritmo)
                .collect(Collectors.toList());

        LocalDateTime finBloque = inicioBloque.plusMinutes(ventanaScMinutos);
        List<EnvioAlgoritmo> envios = envioRepository.findByFechaHoraRegistroBetweenOrderByFechaHoraRegistroAsc(inicioBloque, finBloque).stream()
                .map(dataMapper::toEnvioAlgoritmo)
                .collect(Collectors.toList());

        log.info("Datos cargados: {} aeropuertos, {} vuelos, {} envíos", aeropuertos.size(), vuelos.size(), envios.size());

        if (envios.isEmpty()) {
            log.warn("No hay envíos en este bloque de prueba.");
            return new PlanificationSolutionOutput("ACS");
        }

        PlanificationProblemInput input = new PlanificationProblemInput();
        aeropuertos.forEach(input::agregarAeropuerto);
        vuelos.forEach(input::agregarVuelo);
        envios.forEach(input::agregarEnvio);

        PlanificationProblemInput subInput = input.crearSubInput(envios);

        long tiempoMs = (long) tiempoAlgoritmoTaSegundos * 1000L;
        PlanificationSolutionOutput solucion = ACSAdapter.planificar(subInput, tiempoMs);

        log.info("Bloque planificado con éxito. SLA Promedio: {}", solucion.getPromedioConsumoSLA());

        return solucion;
    }

    /**
     * Espera hasta un instante de reloj real (interruptible por pausa/cancelación).
     * @return false si la simulación fue cancelada durante la espera (no pausa)
     */
    private boolean esperarHastaInterruptible(Long simulacionId, long targetEpochMs) {
        while (true) {
            Boolean paused = pauseFlags.get(simulacionId);
            if (paused == null) {
                // Fue cancelada
                return false;
            }
            if (paused) {
                // Fue pausada; retornar true para que el loop continúe y entre a esperarHastaDespausa
                return true;
            }
            long remaining = targetEpochMs - System.currentTimeMillis();
            if (remaining <= 0) {
                return true;
            }
            try {
                Thread.sleep(Math.min(remaining, 1000L));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                log.warn("Simulación {} — espera interrumpida", simulacionId);
                return false;
            }
        }
    }

    /**
     * Espera a que la simulación sea reanudada (pausa activa).
     * @return false si la simulación fue cancelada durante la pausa
     */
    private boolean esperarHastaDespausa(Long simulacionId) {
        while (true) {
            Boolean paused = pauseFlags.get(simulacionId);
            if (paused == null) {
                // Fue cancelada
                return false;
            }
            if (!paused) {
                // Fue reanudada
                return true;
            }
            try {
                Thread.sleep(500L); // Chequear cada 500ms si se reanudó
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                log.warn("Simulación {} — espera de despausa interrumpida", simulacionId);
                return false;
            }
        }
    }

    /** Índice clave vuelo → VueloAlgoritmo (misma clave que usa PlanificationSolutionOutput). */
    private void normalizarArreglosOcupacionAlmacen(Map<String, int[]> ocupacionGlobalAlmacenes) {
        for (Map.Entry<String, int[]> entry : ocupacionGlobalAlmacenes.entrySet()) {
            entry.setValue(TimeUtils.ajustarArregloOcupacion(entry.getValue()));
        }
    }

    private void prepararIndiceVuelos(Map<String, VueloAlgoritmo> indice,
                                      List<VueloAlgoritmo> vuelos,
                                      LocalDateTime inicio,
                                      LocalDateTime fin) {
        for (LocalDateTime date = inicio; !date.isAfter(fin); date = date.plusDays(1)) {
            for (VueloAlgoritmo v : vuelos) {
                String clave = v.getOrigenOaci() + "-" + v.getDestinoOaci() + "-"
                        + v.getHoraSalida() + "-" + date.toLocalDate();
                indice.put(clave, v);
            }
        }
    }

    private List<Integer> partition(int M, int P) {
        List<Integer> parts = new ArrayList<>();
        int base = M / P;
        int remainder = M % P;
        for (int i = 0; i < P; i++) {
            parts.add(base + (i < remainder ? 1 : 0));
        }
        return parts;
    }
}
