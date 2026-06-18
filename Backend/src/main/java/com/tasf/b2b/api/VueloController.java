package com.tasf.b2b.api;

import com.tasf.b2b.api.dto.VueloResponseDTO;
import com.tasf.b2b.domain.AeropuertoEntity;
import com.tasf.b2b.domain.VueloEntity;
import com.tasf.b2b.repository.AeropuertoRepository;
import com.tasf.b2b.repository.VueloRepository;
import com.tasf.b2b.service.RealTimeOperationsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import com.tasf.b2b.repository.AsignacionRealRepository;
import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.repository.CancelacionVueloRepository;
import com.tasf.b2b.domain.CancelacionVueloEntity;
import java.time.LocalDateTime;

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
}
