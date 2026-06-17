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

        // Asegurar que no se planifiquen vuelos en el pasado relativo a 'ahora'
        for (EnvioAlgoritmo env : enviosAlg) {
            if (env.getFechaHoraRegistro().isBefore(ahora)) {
                env.setFechaHoraRegistro(ahora);
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
                entity.setTotalTramos(ruta.vuelosUsados.size());
                entity.setUbicacionActual(entity.getOrigenOaci());

                // Limpiar asignaciones anteriores (puede venir de un intento SIN_RUTA previo)
                asignacionRealRepository.deleteByPedidoId(envioAlg.getId());

                // Guardar tramos de ruta
                for (int i = 0; i < ruta.vuelosUsados.size(); i++) {
                    VueloAlgoritmo vuelo = ruta.vuelosUsados.get(i);
                    LocalDateTime fechaSalida = ruta.fechasVuelo.get(i);
                    LocalDateTime fechaLlegada = fechaSalida.with(vuelo.getHoraLlegada());
                    if (fechaLlegada.isBefore(fechaSalida)) fechaLlegada = fechaLlegada.plusDays(1);

                    AsignacionRealEntity asig = new AsignacionRealEntity();
                    asig.setPedidoId(envioAlg.getId());
                    asig.setOrdenVuelo(i + 1);
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
}
