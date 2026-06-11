package com.tasf.b2b.api;

import com.tasf.b2b.domain.AerolineaEntity;
import com.tasf.b2b.domain.UsuarioEntity;
import com.tasf.b2b.repository.AerolineaRepository;
import com.tasf.b2b.repository.UsuarioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/aerolineas")
@RequiredArgsConstructor
@CrossOrigin
public class AerolineaController {

    private final AerolineaRepository aerolineaRepository;
    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoder passwordEncoder;

    // DTO de respuesta enriquecido con correo
    public record AerolineaDTO(Long id, String nombre, String codigo, String correo) {}

    // GET /api/aerolineas — cualquier autenticado
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<AerolineaDTO>> getAll() {
        List<AerolineaDTO> result = aerolineaRepository.findAll().stream().map(a -> {
            String correo = usuarioRepository.findByAerolineaId(a.getId())
                    .map(UsuarioEntity::getCorreo)
                    .orElse("");
            return new AerolineaDTO(a.getId(), a.getNombre(), a.getCodigo(), correo);
        }).collect(Collectors.toList());
        return ResponseEntity.ok(result);
    }

    // POST /api/aerolineas — solo ADMIN
    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> create(@RequestBody CreateAerolineaRequest req) {
        if (aerolineaRepository.existsByCodigo(req.codigo().toUpperCase())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("mensaje", "El código OACI ya está registrado"));
        }
        if (usuarioRepository.existsByCorreo(req.correo())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("mensaje", "El correo ya está registrado"));
        }

        // 1. Crear aerolínea
        AerolineaEntity aerolinea = new AerolineaEntity();
        aerolinea.setNombre(req.nombre());
        aerolinea.setCodigo(req.codigo().toUpperCase());
        AerolineaEntity saved = aerolineaRepository.save(aerolinea);

        // 2. Crear usuario AEROLINEA asociado
        UsuarioEntity usuario = new UsuarioEntity();
        usuario.setNombreCompleto(req.nombre());
        usuario.setCorreo(req.correo());
        usuario.setPasswordHash(passwordEncoder.encode(req.password()));
        usuario.setRol(UsuarioEntity.Rol.AEROLINEA);
        usuario.setAerolineaId(saved.getId());
        usuario.setActivo(true);
        usuarioRepository.save(usuario);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AerolineaDTO(saved.getId(), saved.getNombre(), saved.getCodigo(), req.correo()));
    }

    // PUT /api/aerolineas/{id} — solo ADMIN
    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody UpdateAerolineaRequest req) {
        return aerolineaRepository.findById(id).map(a -> {
            a.setNombre(req.nombre());
            AerolineaEntity updated = aerolineaRepository.save(a);
            String correo = usuarioRepository.findByAerolineaId(id)
                    .map(UsuarioEntity::getCorreo).orElse("");
            return ResponseEntity.ok(new AerolineaDTO(updated.getId(), updated.getNombre(), updated.getCodigo(), correo));
        }).orElse(ResponseEntity.notFound().build());
    }

    // DELETE /api/aerolineas/{id} — solo ADMIN
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!aerolineaRepository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        usuarioRepository.findAll().stream()
                .filter(u -> id.equals(u.getAerolineaId()))
                .forEach(usuarioRepository::delete);
        aerolineaRepository.deleteById(id);
        return ResponseEntity.ok().build();
    }

    // --- DTOs de entrada ---
    public record CreateAerolineaRequest(String nombre, String codigo, String correo, String password) {}
    public record UpdateAerolineaRequest(String nombre) {}
}
