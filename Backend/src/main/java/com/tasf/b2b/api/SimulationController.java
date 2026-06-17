package com.tasf.b2b.api;

import com.tasf.b2b.core.PlanificationSolutionOutput;
import com.tasf.b2b.domain.AsignacionEnvioEntity;
import com.tasf.b2b.domain.BloqueResultadoEntity;
import com.tasf.b2b.domain.SimulacionEntity;
import com.tasf.b2b.service.SimulationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import com.tasf.b2b.repository.UsuarioRepository;
import com.tasf.b2b.domain.UsuarioEntity;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/simulacion")
@RequiredArgsConstructor
public class SimulationController {

    private final SimulationService simulationService;
    private final UsuarioRepository usuarioRepository;

    // ========================================
    // INICIAR SIMULACIÓN — Solo ADMIN
    // ========================================
    @PostMapping("/iniciar")
    public ResponseEntity<?> iniciar(@RequestBody IniciarSimulacionRequest request,
                                     Authentication auth) {
        String correo = auth.getName();
        Long userId = usuarioRepository.findByCorreo(correo)
                .map(UsuarioEntity::getId)
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

        SimulacionEntity sim = simulationService.iniciarSimulacion(
                userId, request.nombre(),
                request.fechaInicio(), request.fechaFin(),
                request.sa(), request.k(), request.ta()
        );

        return ResponseEntity.ok(Map.of(
                "simulacionId", sim.getId(),
                "estado", sim.getEstado().name(),
                "totalBloques", sim.getTotalBloquesEstimados(),
                "mensaje", "Simulación iniciada exitosamente"
        ));
    }

    // ========================================
    // PAUSAR
    // ========================================
    @PostMapping("/{id}/pausar")
    public ResponseEntity<?> pausar(@PathVariable Long id) {
        simulationService.pausarSimulacion(id);
        return ResponseEntity.ok(Map.of("mensaje", "Simulación pausada", "simulacionId", id));
    }

    // ========================================
    // REANUDAR
    // ========================================
    @PostMapping("/{id}/reanudar")
    public ResponseEntity<?> reanudar(@PathVariable Long id) {
        simulationService.reanudarSimulacion(id);
        return ResponseEntity.ok(Map.of("mensaje", "Simulación reanudada", "simulacionId", id));
    }

    // ========================================
    // CANCELAR
    // ========================================
    @PostMapping("/{id}/cancelar")
    public ResponseEntity<?> cancelar(@PathVariable Long id) {
        simulationService.cancelarSimulacion(id);
        return ResponseEntity.ok(Map.of("mensaje", "Simulación cancelada", "simulacionId", id));
    }

    // ========================================
    // ACTUALIZAR K EN CALIENTE
    // ========================================
    @PutMapping("/{id}/k")
    public ResponseEntity<?> actualizarK(@PathVariable Long id,
                                          @RequestBody Map<String, Integer> body) {
        int nuevoK = body.getOrDefault("k", 4);
        simulationService.actualizarK(id, nuevoK);
        return ResponseEntity.ok(Map.of(
                "mensaje", "K actualizado",
                "simulacionId", id,
                "nuevoK", nuevoK
        ));
    }

    // ========================================
    // CONSULTAR ESTADO
    // ========================================
    @GetMapping("/{id}")
    public ResponseEntity<SimulacionEntity> obtener(@PathVariable Long id) {
        return ResponseEntity.ok(simulationService.obtenerSimulacion(id));
    }

    // ========================================
    // LISTAR TODAS
    // ========================================
    @GetMapping
    public ResponseEntity<List<SimulacionEntity>> listar() {
        return ResponseEntity.ok(simulationService.listarSimulaciones());
    }

    // ========================================
    // BLOQUES DE UNA SIMULACIÓN
    // ========================================
    @GetMapping("/{id}/bloques")
    public ResponseEntity<List<BloqueResultadoEntity>> bloques(@PathVariable Long id) {
        return ResponseEntity.ok(simulationService.obtenerBloques(id));
    }

    // ========================================
    // RUTAS DETALLADAS DE UN BLOQUE — bajo demanda
    // ========================================
    @GetMapping("/{simId}/bloques/{bloqueId}/rutas")
    public ResponseEntity<List<AsignacionEnvioEntity>> rutasDeBloque(
            @PathVariable Long simId,
            @PathVariable Long bloqueId) {
        return ResponseEntity.ok(simulationService.obtenerRutasDeBloque(bloqueId));
    }

    // ========================================
    // TEST BLOQUE (mantener compatibilidad)
    // ========================================
    @GetMapping("/test-bloque")
    public ResponseEntity<PlanificationSolutionOutput> testBloque(
            @RequestParam(defaultValue = "2027-07-24T00:00:00") String inicio,
            @RequestParam(defaultValue = "240") int ventanaSc,
            @RequestParam(defaultValue = "10") int taSegundos) {

        LocalDateTime inicioBloque = LocalDateTime.parse(inicio, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        PlanificationSolutionOutput resultado = simulationService.procesarBloquePrueba(inicioBloque, ventanaSc, taSegundos);

        return ResponseEntity.ok(resultado);
    }

    // ========================================
    // CANCELACIÓN DE VUELOS (SIMULACIÓN)
    // ========================================
    @GetMapping("/{id}/pedidos-afectados-vuelo")
    public ResponseEntity<List<Map<String, Object>>> pedidosAfectadosVuelo(
            @PathVariable Long id,
            @RequestParam String origen,
            @RequestParam String destino,
            @RequestParam String fechaSalida) {
        LocalDateTime fecha = LocalDateTime.parse(fechaSalida, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        return ResponseEntity.ok(simulationService.obtenerPedidosAfectadosSimulacion(id, origen, destino, fecha));
    }

    @PostMapping("/{id}/cancelar-vuelo")
    public ResponseEntity<Map<String, Object>> cancelarVuelo(
            @PathVariable Long id,
            @RequestBody Map<String, String> request) {
        String origen = request.get("origen");
        String destino = request.get("destino");
        LocalDateTime fecha = LocalDateTime.parse(request.get("fechaSalida"), DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        
        simulationService.cancelarVueloSimulacion(id, origen, destino, fecha);
        
        return ResponseEntity.ok(Map.of(
                "simulacionId", id,
                "mensaje", "Vuelo cancelado exitosamente para la simulación"
        ));
    }

    // --- DTO ---
    public record IniciarSimulacionRequest(String nombre,
                                           LocalDateTime fechaInicio, LocalDateTime fechaFin,
                                           int sa, int k, int ta) {}
}
