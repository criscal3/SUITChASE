package com.tasf.b2b.api;

import com.tasf.b2b.api.dto.VueloResponseDTO;
import com.tasf.b2b.domain.AeropuertoEntity;
import com.tasf.b2b.domain.VueloEntity;
import com.tasf.b2b.repository.AeropuertoRepository;
import com.tasf.b2b.repository.VueloRepository;
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

@RestController
@RequestMapping("/api/vuelos")
@RequiredArgsConstructor
@CrossOrigin
public class VueloController {

    private final VueloRepository vueloRepository;
    private final AeropuertoRepository aeropuertoRepository;

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
                    .intercontinental(intercontinental)
                    .cancelled(false)
                    .build();
        }).collect(Collectors.toList());

        return ResponseEntity.ok(dtoList);
    }
}
