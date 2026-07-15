package com.tasf.b2b.service;

import com.tasf.b2b.core.*;
import com.tasf.b2b.domain.AeropuertoEntity;
import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.domain.AsignacionRealEntity.EstadoTramo;
import com.tasf.b2b.domain.PedidoRealEntity;
import com.tasf.b2b.domain.PedidoRealEntity.EstadoPedido;
import com.tasf.b2b.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Servicio que se ejecuta periódicamente (cada Sa segundos) para consumir
 * pedidos registrados por operarios en tiempo real.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RealTimeSchedulerService {

    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final PedidoRealRepository pedidoRealRepository;
    private final AsignacionRealRepository asignacionRealRepository;
    private final CancelacionVueloRepository cancelacionVueloRepo;
    private final DataMapperService dataMapper;
    private final RealTimeOperationsService rtService;

    @Value("${planificador.sa-segundos:120}")
    private int saSegundos;  // Sa: cada cuánto se ejecuta (intervalo)

    @Value("${planificador.ta-segundos:10}")
    private int taSegundos;  // Ta: tiempo de ejecución del algoritmo ACS

    @Value("${planificador.enabled:false}")
    private boolean enabled;

    // Estado global de ocupación (se mantiene en memoria entre ciclos)
    private PlanificationProblemInput inputMaestro;
    private boolean initialized = false;

    @Scheduled(fixedDelayString = "${planificador.sa-ms:120000}")
    public void planificarEnTiempoReal() {
        if (!enabled) return;

        if (!initialized) {
            inicializarInputMaestro();
        }

        // Actualizar cancelaciones activas
        Set<String> cancelados = cancelacionVueloRepo.findAll().stream()
                .map(c -> c.getOrigenOaci() + "-" + c.getDestinoOaci() + "-" + c.getFechaSalida())
                .collect(Collectors.toSet());
        inputMaestro.setVuelosCancelados(cancelados);

        // 1. Obtener pedidos PENDIENTES y SIN_RUTA (se reintentará planificarlos)
        LocalDateTime ahora = LocalDateTime.now();
        List<PedidoRealEntity> pedidosPendientes = pedidoRealRepository
                .findByEstadoInOrderByFechaHoraRegistroDesc(
                        List.of(EstadoPedido.PENDIENTE, EstadoPedido.SIN_RUTA));

        if (pedidosPendientes.isEmpty()) {
            return; // Nada que planificar
        }

        log.info("[TiempoReal] Planificando {} pedidos (PENDIENTE + SIN_RUTA)", pedidosPendientes.size());

        // 2. Convertir a formato algoritmo
        List<EnvioAlgoritmo> enviosAlg = pedidosPendientes.stream()
                .map(dataMapper::toEnvioAlgoritmo)
                .collect(Collectors.toList());

        // Asegurar que no se planifiquen vuelos en el pasado relativo a la disponibilidad real del pedido
        for (EnvioAlgoritmo env : enviosAlg) {
            // Obtener tramos existentes (COMPLETADO o EN_VUELO)
            List<AsignacionRealEntity> tramosExistentes = asignacionRealRepository
                    .findByPedidoIdOrderByOrdenVueloAsc(env.getId()).stream()
                    .filter(t -> t.getEstado() == AsignacionRealEntity.EstadoTramo.COMPLETADO 
                            || t.getEstado() == AsignacionRealEntity.EstadoTramo.EN_VUELO)
                    .collect(Collectors.toList());

            if (!tramosExistentes.isEmpty()) {
                // Si el pedido está en tránsito o ya llegó a algún punto intermedio, 
                // estará disponible a partir de la llegada del último tramo activo
                AsignacionRealEntity ultimoTramo = tramosExistentes.get(tramosExistentes.size() - 1);
                LocalDateTime disponible = ultimoTramo.getFechaLlegada().plusMinutes(15); // 15 min de handling
                env.setFechaHoraRegistro(disponible.isAfter(ahora) ? disponible : ahora);
            } else {
                if (env.getFechaHoraRegistro().isBefore(ahora)) {
                    env.setFechaHoraRegistro(ahora);
                }
            }
        }

        // 3. Configurar ventana temporal para el algoritmo (basada en "ahora")
        // Esto es CRÍTICO: el algoritmo usa TimeUtils.getIndiceMinuto() que calcula
        // diferencias desde FECHA_INICIO_SIM. Si FECHA_INICIO_SIM es 2027 y los pedidos
        // son de 2026, todos los índices son negativos y el ACS no encuentra ninguna ruta.
        LocalDateTime inicioVentana = ahora.withHour(0).withMinute(0).withSecond(0).withNano(0);
        LocalDateTime finVentana = inicioVentana.plusDays(12); // ventana de 12 días hacia el futuro
        com.tasf.b2b.core.TimeUtils.configurarRangoSimulacion(inicioVentana, finVentana);

        // 4. Crear sub-input y ejecutar ACS
        PlanificationProblemInput subInput = inputMaestro.crearSubInput(enviosAlg);
        long tiempoMs = (long) taSegundos * 1000L;
        PlanificationSolutionOutput solucion = ACSAdapter.planificar(subInput, tiempoMs);

        // --- PROGRESSIVE SPLITTING LOGIC FOR REAL-TIME ---
        List<EnvioAlgoritmo> enviosParaDividir = new ArrayList<>();
        for (EnvioAlgoritmo env : enviosAlg) {
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
            log.info("[TiempoReal] Se detectaron {} pedidos que no pudieron planificarse completos y se intentarán dividir.", enviosParaDividir.size());
            enviosAlg.removeAll(enviosParaDividir);
            
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
                        log.info("[TiempoReal] Pedido {} dividido exitosamente en {} partes.", originalId, p);
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
                            // aunque algunos subenvíos no hayan encontrado ruta.
                            subEnviosAceptados = subEnviosIntentar;
                            solucionSubAceptada = solucionSubIntentar;
                            log.info("[TiempoReal] Pedido {} no se pudo dividir exitosamente por completo. Se acepta división máxima de {} partes.", originalId, p);
                        }
                    }
                }

                // Persistir la división aceptada en la Base de Datos
                PedidoRealEntity pedidoOriginal = pedidoRealRepository.findById(originalId).orElse(null);
                if (pedidoOriginal != null) {
                    // Eliminar el pedido original y limpiar sus asignaciones
                    pedidoRealRepository.delete(pedidoOriginal);
                    asignacionRealRepository.deleteByPedidoId(originalId);
                    rtService.eliminarPedidoDeCache(originalId);

                    // Insertar los sub-pedidos en la base de datos
                    for (EnvioAlgoritmo subEnv : subEnviosAceptados) {
                        PedidoRealEntity subPedido = new PedidoRealEntity();
                        subPedido.setId(subEnv.getId());
                        subPedido.setOrigenOaci(pedidoOriginal.getOrigenOaci());
                        subPedido.setDestinoOaci(pedidoOriginal.getDestinoOaci());
                        subPedido.setFechaHoraRegistro(pedidoOriginal.getFechaHoraRegistro());
                        subPedido.setCantidadMaletas(subEnv.getCantidadMaletas());
                        subPedido.setAerolineaId(pedidoOriginal.getAerolineaId());
                        subPedido.setOperarioId(pedidoOriginal.getOperarioId());
                        subPedido.setEstado(EstadoPedido.PENDIENTE);
                        subPedido.setUbicacionActual(pedidoOriginal.getOrigenOaci());

                        pedidoRealRepository.save(subPedido);
                        enviosAlg.add(subEnv);

                        // Registrar ruta del subenvío en la solución principal
                        ResultadoRuta rutaSub = solucionSubAceptada.getRuta(subEnv);
                        solucion.agregarRuta(subEnv, rutaSub);
                    }
                }

                // Remover el envío original de la solución principal
                solucion.getEnviosPlanificados().remove(env);
                solucion.getMapaRutas().remove(env.getOrigenOaci() + "-" + env.getId());
            }

            // Recalcular SLA promedio
            solucion.calcularPromedioConsumoSLA(inputMaestro.getMapaAeropuertos());
        }

        log.info("[TiempoReal] Resultado: {} pedidos planificados, SLA: {}%",
                solucion.enviosConRuta(), solucion.getPromedioConsumoSLA());

        // 4. Persistir asignaciones
        List<PedidoRealEntity> planificados = new ArrayList<>();

        for (EnvioAlgoritmo envioAlg : solucion.getEnviosPlanificados()) {
            ResultadoRuta ruta = solucion.getRuta(envioAlg);
            PedidoRealEntity entity = pedidoRealRepository.findById(envioAlg.getId()).orElse(null);
            if (entity == null) continue;

            entity.setFechaPlanificacion(ahora);

            if (ruta == null || ruta.vuelosUsados.isEmpty()) {
                entity.setEstado(EstadoPedido.SIN_RUTA);
            } else {
                String destinoAlcanzado = ruta.vuelosUsados.get(ruta.vuelosUsados.size() - 1).getDestinoOaci();
                entity.setEstado(destinoAlcanzado.equals(envioAlg.getDestinoOaci())
                        ? EstadoPedido.PLANIFICADO : EstadoPedido.SIN_RUTA);

                // Obtener tramos existentes (COMPLETADO o EN_VUELO)
                List<AsignacionRealEntity> tramosExistentes = asignacionRealRepository
                        .findByPedidoIdOrderByOrdenVueloAsc(envioAlg.getId()).stream()
                        .filter(t -> t.getEstado() == EstadoTramo.COMPLETADO || t.getEstado() == EstadoTramo.EN_VUELO)
                        .collect(Collectors.toList());

                int offset = tramosExistentes.size();
                entity.setTotalTramos(offset + ruta.vuelosUsados.size());

                // No sobreescribir ubicacionActual al origen si ya avanzó
                if (offset == 0) {
                    entity.setUbicacionActual(entity.getOrigenOaci());
                }

                // Limpiar asignaciones anteriores que no sean COMPLETADO o EN_VUELO
                asignacionRealRepository.deleteByPedidoIdAndEstadoIn(envioAlg.getId(), 
                        List.of(EstadoTramo.PROGRAMADO, EstadoTramo.CANCELADO));

                // Guardar tramos de ruta
                for (int i = 0; i < ruta.vuelosUsados.size(); i++) {
                    VueloAlgoritmo vuelo = ruta.vuelosUsados.get(i);
                    LocalDateTime fechaSalida = ruta.fechasVuelo.get(i);
                    LocalDateTime fechaLlegada = fechaSalida.with(vuelo.getHoraLlegada());
                    if (fechaLlegada.isBefore(fechaSalida)) fechaLlegada = fechaLlegada.plusDays(1);

                    AsignacionRealEntity asig = new AsignacionRealEntity();
                    asig.setPedidoId(envioAlg.getId());
                    asig.setOrdenVuelo(offset + i + 1);
                    asig.setVueloId(buscarVueloId(vuelo));
                    asig.setOrigenOaci(vuelo.getOrigenOaci());
                    asig.setDestinoOaci(vuelo.getDestinoOaci());
                    asig.setFechaSalida(fechaSalida);
                    asig.setFechaLlegada(fechaLlegada);
                    asig.setEstado(EstadoTramo.PROGRAMADO);
                    asignacionRealRepository.save(asig);
                }
            }

            pedidoRealRepository.save(entity);
            planificados.add(entity);
        }

        // 5. Notificar RealTimeOperationsService
        if (!planificados.isEmpty()) {
            rtService.actualizarPedidosPlanificados(planificados);
        }
    }

    private void inicializarInputMaestro() {
        List<AeropuertoAlgoritmo> aeropuertos = aeropuertoRepository.findAll().stream()
                .map(dataMapper::toAeropuertoAlgoritmo)
                .collect(Collectors.toList());

        List<VueloAlgoritmo> vuelos = vueloRepository.findAll().stream()
                .map(dataMapper::toVueloAlgoritmo)
                .collect(Collectors.toList());

        inputMaestro = new PlanificationProblemInput();
        aeropuertos.forEach(inputMaestro::agregarAeropuerto);
        vuelos.forEach(inputMaestro::agregarVuelo);

        initialized = true;
        log.info("[TiempoReal] Input maestro inicializado: {} aeropuertos, {} vuelos",
                aeropuertos.size(), vuelos.size());
    }

    private Long buscarVueloId(VueloAlgoritmo vuelo) {
        // El algoritmo trabaja en UTC. VueloEntity guarda en hora LOCAL del aeropuerto.
        int gmtOrigen  = aeropuertoRepository.findById(vuelo.getOrigenOaci())
                .map(AeropuertoEntity::getGmt).orElse(0);
        int gmtDestino = aeropuertoRepository.findById(vuelo.getDestinoOaci())
                .map(AeropuertoEntity::getGmt).orElse(0);

        // UTC → hora local (lo que está persistido en VueloEntity)
        java.time.LocalTime horaSalidaLocal  = vuelo.getHoraSalida().plusHours(gmtOrigen);
        java.time.LocalTime horaLlegadaLocal = vuelo.getHoraLlegada().plusHours(gmtDestino);

        // Intento exacto primero
        var exacto = vueloRepository.findByOrigenOaciAndDestinoOaciAndHoraSalidaAndHoraLlegada(
                vuelo.getOrigenOaci(), vuelo.getDestinoOaci(), horaSalidaLocal, horaLlegadaLocal);
        if (exacto.isPresent()) return exacto.get().getId();

        // Fallback: comparar en minutos normalizados (evita desbordamiento de medianoche en LocalTime)
        int salidaUtcMin = (vuelo.getHoraSalida().getHour() * 60 + vuelo.getHoraSalida().getMinute() + 1440) % 1440;

        return vueloRepository.findAll().stream()
                .filter(v -> v.getOrigenOaci().equals(vuelo.getOrigenOaci())
                          && v.getDestinoOaci().equals(vuelo.getDestinoOaci()))
                .filter(v -> {
                    // Hora local en minutos → convertir a UTC restando gmtOrigen
                    int localMin = v.getHoraSalida().getHour() * 60 + v.getHoraSalida().getMinute();
                    int utcMin   = (localMin - gmtOrigen * 60 + 1440) % 1440;
                    return Math.abs(utcMin - salidaUtcMin) <= 1; // tolerancia 1 minuto
                })
                .map(com.tasf.b2b.domain.VueloEntity::getId)
                .findFirst()
                .orElse(0L);
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
