package com.tasf.b2b.api;

import com.tasf.b2b.api.dto.VueloResponseDTO;
import com.tasf.b2b.domain.AeropuertoEntity;
import com.tasf.b2b.domain.VueloEntity;
import com.tasf.b2b.repository.AeropuertoRepository;
import com.tasf.b2b.repository.VueloRepository;
import com.tasf.b2b.service.RealTimeOperationsService;
import com.tasf.b2b.service.RealTimeSchedulerService;
import com.tasf.b2b.service.SimulationService;
import com.tasf.b2b.service.VueloTransactionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import com.tasf.b2b.repository.AsignacionRealRepository;
import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.repository.CancelacionVueloRepository;
import com.tasf.b2b.domain.CancelacionVueloEntity;
import java.time.LocalDateTime;
import com.tasf.b2b.repository.AsignacionEnvioRepository;
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/api/vuelos")
@RequiredArgsConstructor
@CrossOrigin
public class VueloController {

    private final VueloRepository vueloRepository;
    private final AeropuertoRepository aeropuertoRepository;
    private final RealTimeOperationsService rtService;
    private final AsignacionRealRepository asignacionRealRepository;
    private final CancelacionVueloRepository cancelacionVueloRepo;
    private final AsignacionEnvioRepository asignacionEnvioRepository;
    private final RealTimeSchedulerService rtSchedulerService;
    private final SimulationService simulationService;
    private final VueloTransactionService vueloTxService;

    @GetMapping("/cancelaciones-activas")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<Long>> getCancelacionesActivas() {
        LocalDateTime inicioDia = LocalDateTime.now().with(LocalTime.MIN);
        List<Long> cancelados = cancelacionVueloRepo.findByFechaSalidaAfter(inicioDia).stream()
                .map(CancelacionVueloEntity::getVueloId)
                .distinct()
                .collect(Collectors.toList());
        return ResponseEntity.ok(cancelados);
    }

    @GetMapping("/debug-asignaciones")
    @PreAuthorize("permitAll()")
    public ResponseEntity<List<AsignacionRealEntity>> debugAsignaciones() {
        return ResponseEntity.ok(asignacionRealRepository.findAll());
    }

    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<VueloResponseDTO>> getFlights() {
        // Cache all airports to resolve continents and GMT offsets quickly
        Map<String, AeropuertoEntity> airportMap = aeropuertoRepository.findAll().stream()
                .collect(Collectors.toMap(AeropuertoEntity::getOaci, a -> a, (a, b) -> a));

        List<VueloResponseDTO> dtoList = vueloRepository.findAll().stream().map(v -> {
            LocalTime salida = v.getHoraSalida();
            LocalTime llegada = v.getHoraLlegada();
            
            // Calculate departureHour as hours since midnight
            double departureHour = salida.getHour() + salida.getMinute() / 60.0 + salida.getSecond() / 3600.0;
            
            // Calculate transitHours (flight duration in decimal hours)
            long minutes = Duration.between(salida, llegada).toMinutes();
            if (minutes < 0) {
                minutes += 24 * 60; // handle overnight flights
            }
            double transitHours = minutes / 60.0;

            // Determine if intercontinental
            AeropuertoEntity origAero = airportMap.get(v.getOrigenOaci());
            AeropuertoEntity destAero = airportMap.get(v.getDestinoOaci());
            boolean intercontinental = false;
            if (origAero != null && destAero != null && origAero.getContinente() != null && destAero.getContinente() != null) {
                intercontinental = !origAero.getContinente().equalsIgnoreCase(destAero.getContinente());
            }

            return VueloResponseDTO.builder()
                    .id(v.getId().toString())
                    .origin(v.getOrigenOaci())
                    .destination(v.getDestinoOaci())
                    .origenOaci(v.getOrigenOaci())
                    .destinoOaci(v.getDestinoOaci())
                    .horaSalida(salida.format(DateTimeFormatter.ofPattern("HH:mm:ss")))
                    .horaLlegada(llegada.format(DateTimeFormatter.ofPattern("HH:mm:ss")))
                    .departureHour(departureHour)
                    .transitHours(transitHours)
                    .capacity(v.getCapacidad())
                    .capacidad(v.getCapacidad())
                    .origenGmt(origAero != null ? origAero.getGmt() : 0)
                    .intercontinental(intercontinental)
                    .cancelled(false)
                    .build();
        }).collect(Collectors.toList());

        return ResponseEntity.ok(dtoList);
    }

    /**
     * Preview (sin modificar datos): devuelve los pedidos que serían afectados si se
     * cancela la ocurrencia de hoy de un vuelo.
     */
    @GetMapping("/{id}/pedidos-afectados-hoy")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<com.tasf.b2b.api.dto.PedidoRealDTO>> pedidosAfectadosHoy(@PathVariable Long id) {
        var vuelo = vueloRepository.findById(id).orElse(null);
        if (vuelo == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(rtService.getPedidosAfectadosPorVueloHoy(vuelo));
    }

    /**
     * Cancela la ocurrencia de HOY de un vuelo (sin eliminar el vuelo de la BD).
     * Los pedidos cuya ruta incluya este vuelo hoy pasan a PENDIENTE para ser
     * replanificados en el próximo ciclo del scheduler.
     */
    @PostMapping("/{id}/cancelar-hoy")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> cancelarHoy(@PathVariable Long id) {
        var vuelo = vueloRepository.findById(id).orElse(null);
        if (vuelo == null) return ResponseEntity.notFound().build();
        int pedidosAfectados = rtService.cancelarVueloDelDia(vuelo);
        return ResponseEntity.ok(Map.of(
                "vueloId", id,
                "pedidosAfectados", pedidosAfectados,
                "mensaje", pedidosAfectados == 0
                        ? "No hay pedidos afectados por este vuelo hoy"
                        : pedidosAfectados + " pedido(s) regresado(s) a PENDIENTE para replanificación"
        ));
    }

    @DeleteMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteAllFlights() {
        vueloTxService.borrarTodosLosVuelos();
        // Notificar DESPUES del commit de la transaccion
        rtSchedulerService.refrescarVuelos();
        simulationService.refrescarVuelosEnSimulacionesActivas();
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/importar")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Integer> importarVuelos(@RequestBody List<String> lineas) {
        Set<String> aeropuertosExistentes = aeropuertoRepository.findAll().stream()
                .map(AeropuertoEntity::getOaci)
                .collect(Collectors.toSet());

        List<VueloEntity> nuevosVuelos = new java.util.ArrayList<>();
        for (String linea : lineas) {
            if (linea == null) continue;
            linea = linea.trim();
            if (linea.isEmpty()) continue;

            String[] parts = linea.split("-");
            if (parts.length >= 5) {
                String origen = parts[0].trim().toUpperCase();
                String destino = parts[1].trim().toUpperCase();
                String salidaStr = parts[2].trim();
                String llegadaStr = parts[3].trim();
                String capStr = parts[4].trim();

                if (!aeropuertosExistentes.contains(origen) || !aeropuertosExistentes.contains(destino)) {
                    continue;
                }

                try {
                    LocalTime horaSalida = parseTime(salidaStr);
                    LocalTime horaLlegada = parseTime(llegadaStr);
                    Integer capacidad = Integer.parseInt(capStr);

                    VueloEntity vuelo = new VueloEntity();
                    vuelo.setOrigenOaci(origen);
                    vuelo.setDestinoOaci(destino);
                    vuelo.setHoraSalida(horaSalida);
                    vuelo.setHoraLlegada(horaLlegada);
                    vuelo.setCapacidad(capacidad);

                    nuevosVuelos.add(vuelo);
                } catch (Exception e) {
                    // Ignorar lineas invalidas
                }
            }
        }

        int count = vueloTxService.guardarVuelos(nuevosVuelos);
        // Notificar DESPUES del commit de la transaccion
        if (count > 0) {
            rtSchedulerService.refrescarVuelos();
            simulationService.refrescarVuelosEnSimulacionesActivas();
        }
        return ResponseEntity.ok(count);
    }

    private LocalTime parseTime(String timeStr) {
        timeStr = timeStr.trim();
        String[] parts = timeStr.split(":");
        int hour = Integer.parseInt(parts[0]);
        int minute = Integer.parseInt(parts[1]);
        int second = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
        return LocalTime.of(hour, minute, second);
    }
}
