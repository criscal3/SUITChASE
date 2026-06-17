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
                                              int sa, int k, int ta) {
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

        simulacionRepository.save(sim);
        pauseFlags.put(sim.getId(), false);

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
    // CANCELAR
    // ========================================================
    public void cancelarSimulacion(Long simulacionId) {
        pauseFlags.remove(simulacionId); // Remover para marcar como cancelada
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
            log.info("InputMaestro reutilizado para simulación {} (continuando desde bloque {})", simulacionId, bloqueActual);
        }

        Map<String, AeropuertoAlgoritmo> mapaAeropuertos = aeropuertos.stream()
                .collect(Collectors.toMap(AeropuertoAlgoritmo::getOaci, a -> a, (a, b) -> a));

        // Cursor: posición actual en el tiempo simulado
        LocalDateTime cursor = sim.getCursorTemporal();

        log.info("Simulación {} iniciada/reanudada. Cursor: {}, Bloque: {}/{}",
                simulacionId, cursor, bloqueActual, sim.getTotalBloquesEstimados());

        // Ancla de reloj real: bloque n inicia en (n-1)*Sa y termina su ventana en n*Sa (segundos)
        final long saPeriodoMs = (long) sa * 60_000L;
        final long wallClockAnchorMs = bloqueActual > 0
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
                log.info("Simulación {} reanudada. Continuando desde bloque {}", simulacionId, bloqueActual);
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
            boolean bloqueVacio = enviosBloque.isEmpty();

            bloqueActual++;

            long slotStartMs = wallClockAnchorMs + (long) (bloqueActual - 1) * saPeriodoMs;
            if (!esperarHastaInterruptible(simulacionId, slotStartMs)) {
                return;
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
                // 2. Crear sub-input con los envíos del bloque
                PlanificationProblemInput subInput = inputMaestro.crearSubInput(enviosBloque);

                // 3. Ejecutar ACS
                long tiempoMs = (long) ta * 1000L;
                solucion = ACSAdapter.planificar(subInput, tiempoMs);

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
            long sleepSeg = Math.max(0, (slotEndMs - System.currentTimeMillis() + 999) / 1000);
            if (sleepSeg > 0) {
                log.info("Simulación {} — Bloque {} enviado ({}s de cómputo), durmiendo hasta t={}s",
                        simulacionId, bloqueActual, duracionAlgoritmoSeg,
                        (bloqueActual * sa * 60L));
            }
            if (!esperarHastaInterruptible(simulacionId, slotEndMs)) {
                return;
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
                asig.setOrdenVuelo(i + 1);
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
}
