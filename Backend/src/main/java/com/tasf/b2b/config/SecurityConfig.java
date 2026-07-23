package com.tasf.b2b.config;

import com.tasf.b2b.security.JwtAuthenticationFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtFilter;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // --- Públicos ---
                .requestMatchers("/api/auth/login").permitAll()
                .requestMatchers("/ws/**").permitAll()   // WebSocket handshake
                .requestMatchers("/actuator/health").permitAll()

                // --- Tiempo Real ---
                .requestMatchers(HttpMethod.GET, "/api/tiempo-real/resumen").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/tiempo-real/operaciones").hasAnyRole("ADMIN", "OPERARIO")
                .requestMatchers(HttpMethod.GET, "/api/tiempo-real/mis-pedidos").hasRole("AEROLINEA")
                .requestMatchers(HttpMethod.GET, "/api/tiempo-real/pedido/**").authenticated()
                .requestMatchers(HttpMethod.POST, "/api/tiempo-real/pedidos").hasAnyRole("ADMIN", "OPERARIO")
                .requestMatchers(HttpMethod.POST, "/api/tiempo-real/pedidos/lote").hasAnyRole("ADMIN", "OPERARIO")

                // --- ADMIN solamente ---
                .requestMatchers("/api/auth/registro").hasRole("ADMIN")
                .requestMatchers("/api/usuarios/**").hasRole("ADMIN")
                .requestMatchers("/api/simulacion/**").hasRole("ADMIN")
                .requestMatchers("/api/envios-simulados/**").hasRole("ADMIN")
                .requestMatchers("/api/datos-sinteticos/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/vuelos/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/aerolineas/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/aerolineas/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/aerolineas/**").hasRole("ADMIN")

                // --- OPERARIO puede registrar envíos ---
                // --- Envios ---
                .requestMatchers(HttpMethod.POST, "/api/envios").hasAnyRole("ADMIN", "OPERARIO")
                .requestMatchers("/api/envios/mis-envios").hasAnyRole("ADMIN", "OPERARIO", "AEROLINEA")

                // --- Consultas generales (cualquier autenticado) ---
                .requestMatchers(HttpMethod.GET, "/api/aeropuertos/**").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/aerolineas/**").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/envios/**").authenticated()

                // --- Todo lo demás requiere autenticación ---
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(List.of("http://localhost:5173", "http://localhost:3000"));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        configuration.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
