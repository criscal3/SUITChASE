package com.tasf.b2b.api;

import com.tasf.b2b.domain.UsuarioEntity;
import com.tasf.b2b.repository.UsuarioRepository;
import com.tasf.b2b.security.JwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthenticationManager authManager;
    private final JwtService jwtService;
    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoder passwordEncoder;

    // ========================================
    // LOGIN — Público
    // ========================================
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        try {
            authManager.authenticate(
                    new UsernamePasswordAuthenticationToken(request.correo(), request.password())
            );

            UsuarioEntity usuario = usuarioRepository.findByCorreo(request.correo())
                    .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

            String principalName = usuario.getCorreo();

            String token = jwtService.generateToken(
                    principalName,
                    usuario.getRol().name(),
                    usuario.getAerolineaId()
            );

            Map<String, Object> responseMap = new HashMap<>();
            responseMap.put("token", token);
            responseMap.put("correo", principalName);
            responseMap.put("role", usuario.getRol().name());
            responseMap.put("nombreCompleto", usuario.getNombreCompleto());
            responseMap.put("aerolineaId", usuario.getAerolineaId());

            return ResponseEntity.ok(responseMap);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Credenciales inválidas"));
        }
    }

    // ========================================
    // REGISTRO — Solo ADMIN
    // ========================================
    @PostMapping("/registro")
    public ResponseEntity<?> registrar(@RequestBody RegistroRequest request) {
        if (usuarioRepository.existsByCorreo(request.correo())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "El correo ya está registrado"));
        }

        UsuarioEntity usuario = new UsuarioEntity();
        usuario.setCorreo(request.correo());
        usuario.setPasswordHash(passwordEncoder.encode(request.password()));
        usuario.setNombreCompleto(request.nombreCompleto());
        usuario.setRol(UsuarioEntity.Rol.valueOf(request.rol()));
        usuario.setAerolineaId(request.aerolineaId());
        usuario.setActivo(true);

        usuarioRepository.save(usuario);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(Map.of("mensaje", "Usuario creado exitosamente",
                             "correo", usuario.getCorreo()));
    }

    // --- DTOs como records ---
    public record LoginRequest(String correo, String password) {}
    public record RegistroRequest(String correo, String password, String nombreCompleto,
                                  String rol, Long aerolineaId) {}
}
