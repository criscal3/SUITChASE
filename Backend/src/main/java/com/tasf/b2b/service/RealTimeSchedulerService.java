package com.tasf.b2b.service;

import com.tasf.b2b.core.*;
import com.tasf.b2b.domain.AeropuertoEntity;
import com.tasf.b2b.domain.AsignacionEnvioEntity;
import com.tasf.b2b.domain.EnvioEntity;
import com.tasf.b2b.domain.EnvioEntity.EstadoEnvio;
import com.tasf.b2b.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Servicio que se ejecuta periódicamente (cada Ta segundos) para consumir
 * envíos registrados por operarios en tiempo real.
 *
 * Flujo:
 *   1. Query envíos PENDIENTES con simulacion_id IS NULL
 *   2. Ejecutar ACS sobre el lote
 *   3. Persistir asignaciones y actualizar estados
 *   4. Notificar por WebSocket a /topic/tiempo-real y /topic/mis-envios/{aerolineaId}
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RealTimeSchedulerService {

    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final EnvioRepository envioRepository;
    private final AsignacionEnvioRepository asignacionEnvioRepository;
    private final DataMapperService dataMapper;
    private final SimpMessagingTemplate messagingTemplate;

    @Value("${planificador.sa-segundos:600}")
    private int saSegundos;  // Sa: cada cuánto se ejecuta (intervalo)

    @Value("${planificador.ta-segundos:20}")
    private int taSegundos;  // Ta: tiempo de ejecución del algoritmo ACS

    @Value("${planificador.enabled:false}")
    private boolean enabled;

    // Estado global de ocupación (se mantiene en memoria entre ciclos)
    private PlanificationProblemInput inputMaestro;
    private boolean initialized = false;

    @Scheduled(fixedDelayString = "${planificador.sa-ms:600000}")
    public void planificarEnTiempoReal() {
        if (!enabled) return;

        if (!initialized) {
            inicializarInputMaestro();
        }

        // 1. Obtener envíos pendientes de tiempo real
        LocalDateTime ahora = LocalDateTime.now();
        List<EnvioEntity> enviosPendientes = envioRepository
                .findBySimulacionIdIsNullAndEstadoAndFechaHoraRegistroBeforeOrderByFechaHoraRegistroAsc(
                        EstadoEnvio.PENDIENTE, ahora);

        if (enviosPendientes.isEmpty()) {
            return; // Nada que planificar
        }

        log.info("[TiempoReal] Planificando {} envíos pendientes", enviosPendientes.size());

        // 2. Convertir a formato algoritmo
        List<EnvioAlgoritmo> enviosAlg = enviosPendientes.stream()
                .map(dataMapper::toEnvioAlgoritmo)
                .collect(Collectors.toList());

        // 3. Crear sub-input y ejecutar ACS
        PlanificationProblemInput subInput = inputMaestro.crearSubInput(enviosAlg);
        long tiempoMs = (long) taSegundos * 1000L;
        PlanificationSolutionOutput solucion = ACSAdapter.planificar(subInput, tiempoMs);

        log.info("[TiempoReal] Resultado: {} envíos planificados, SLA: {}%",
                solucion.enviosConRuta(), solucion.getPromedioConsumoSLA());

        // 4. Persistir asignaciones
        Set<Long> aerolineasNotificadas = new HashSet<>();

        for (EnvioAlgoritmo envioAlg : solucion.getEnviosPlanificados()) {
            ResultadoRuta ruta = solucion.getRuta(envioAlg);
            EnvioEntity entity = envioRepository.findById(envioAlg.getId()).orElse(null);
            if (entity == null) continue;

            if (ruta == null || ruta.vuelosUsados.isEmpty()) {
                entity.setEstado(EstadoEnvio.SIN_RUTA);
            } else {
                String destinoAlcanzado = ruta.vuelosUsados.get(ruta.vuelosUsados.size() - 1).getDestinoOaci();
                entity.setEstado(destinoAlcanzado.equals(envioAlg.getDestinoOaci())
                        ? EstadoEnvio.ENTREGADO : EstadoEnvio.EN_RUTA);

                // Guardar tramos de ruta
                for (int i = 0; i < ruta.vuelosUsados.size(); i++) {
                    VueloAlgoritmo vuelo = ruta.vuelosUsados.get(i);
                    LocalDateTime fechaSalida = ruta.fechasVuelo.get(i);
                    LocalDateTime fechaLlegada = fechaSalida.with(vuelo.getHoraLlegada());
                    if (fechaLlegada.isBefore(fechaSalida)) fechaLlegada = fechaLlegada.plusDays(1);

                    AsignacionEnvioEntity asig = new AsignacionEnvioEntity();
                    asig.setBloqueResultadoId(null); // Tiempo real, no hay bloque
                    asig.setEnvioId(envioAlg.getId());
                    asig.setOrdenVuelo(i + 1);
                    asig.setVueloId(buscarVueloId(vuelo));
                    asig.setFechaSalida(fechaSalida);
                    asig.setFechaLlegada(fechaLlegada);
                    asig.setEstado(AsignacionEnvioEntity.EstadoAsignacion.A_TIEMPO);
                    asignacionEnvioRepository.save(asig);
                }
            }

            envioRepository.save(entity);
            aerolineasNotificadas.add(entity.getAerolineaId());
        }

        // 5. Notificar WebSocket
        messagingTemplate.convertAndSend("/topic/tiempo-real", Map.of(
                "timestamp", ahora.toString(),
                "enviosPlanificados", solucion.enviosConRuta(),
                "enviosSinRuta", enviosPendientes.size() - solucion.enviosConRuta(),
                "sla", solucion.getPromedioConsumoSLA()
        ));

        // Notificar a cada aerolínea afectada
        for (Long aerolineaId : aerolineasNotificadas) {
            List<EnvioEntity> enviosAerolinea = envioRepository
                    .findByAerolineaIdAndSimulacionIdIsNullOrderByFechaHoraRegistroDesc(aerolineaId);
            messagingTemplate.convertAndSend("/topic/mis-envios/" + aerolineaId, enviosAerolinea);
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
}
