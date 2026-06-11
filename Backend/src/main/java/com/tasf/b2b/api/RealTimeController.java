package com.tasf.b2b.api;

import com.tasf.b2b.api.dto.PedidoRealDTO;
import com.tasf.b2b.api.dto.RegistroPedidoRequest;
import com.tasf.b2b.api.dto.ResumenOperacionesDTO;
import com.tasf.b2b.domain.UsuarioEntity;
import com.tasf.b2b.repository.UsuarioRepository;
import com.tasf.b2b.service.RealTimeOperationsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/tiempo-real")
@RequiredArgsConstructor
public class RealTimeController {

    private final RealTimeOperationsService rtService;
    private final UsuarioRepository usuarioRepository;

    // ===== ADMIN =====

    /** KPIs rápidos desde caché (sin DB) */
    @GetMapping("/resumen")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ResumenOperacionesDTO> resumen() {
        return ResponseEntity.ok(rtService.getResumen());
    }

    /** Lista operaciones activas (desde caché) — para el panel lateral */
    @GetMapping("/operaciones")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<PedidoRealDTO>> operaciones(
            @RequestParam(required = false) String estado,
            @RequestParam(required = false) Long aerolineaId) {
        return ResponseEntity.ok(rtService.getOperacionesActivas(estado, aerolineaId));
    }

    /** Detalle de un pedido con tramos completos */
    @GetMapping("/pedido/{id}")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<PedidoRealDTO> detalle(@PathVariable String id) {
        var dto = rtService.getDetallePedido(id);
        if (dto == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(dto);
    }

    // ===== AEROLÍNEA =====

    /** Pedidos activos de la aerolínea logueada */
    @GetMapping("/mis-pedidos")
    @PreAuthorize("hasRole('AEROLINEA')")
    public ResponseEntity<List<PedidoRealDTO>> misPedidos(Authentication auth) {
        Long aerolineaId = (Long) auth.getCredentials();
        if (aerolineaId == null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        return ResponseEntity.ok(rtService.getPedidosActivosAerolinea(aerolineaId));
    }

    // ===== OPERARIO / ADMIN =====

    /** Registrar nuevo pedido */
    @PostMapping("/pedidos")
    @PreAuthorize("hasAnyRole('OPERARIO', 'ADMIN')")
    public ResponseEntity<PedidoRealDTO> registrar(
            @RequestBody RegistroPedidoRequest req,
            Authentication auth) {
        String correo = (String) auth.getPrincipal();
        Long operarioId = usuarioRepository.findByCorreo(correo)
                .map(UsuarioEntity::getId)
                .orElse(null);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(rtService.registrarPedido(req, operarioId));
    }
}
