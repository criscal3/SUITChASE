package com.tasf.b2b.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "simulacion")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class SimulacionEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String nombre;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EstadoSimulacion estado = EstadoSimulacion.PENDIENTE;

    @Column(name = "fecha_inicio_sim", nullable = false)
    private LocalDateTime fechaInicioSim;

    @Column(name = "fecha_fin_sim", nullable = false)
    private LocalDateTime fechaFinSim;

    @Column(name = "salto_algoritmo_sa", nullable = false)
    private Integer saltoAlgoritmoSa;

    @Column(name = "constante_k", nullable = false)
    private Integer constanteK;

    @Column(name = "tiempo_algoritmo_ta", nullable = false)
    private Integer tiempoAlgoritmoTa;

    @Column(name = "skip_sleep_until_block", nullable = false, columnDefinition = "INT DEFAULT 0")
    private Integer skipSleepUntilBlock = 0;

    @Column(name = "bloque_actual", nullable = false)
    private Integer bloqueActual = 0;

    @Column(name = "total_bloques_estimados", nullable = false)
    private Integer totalBloquesEstimados = 0;

    @Column(name = "cursor_temporal")
    private LocalDateTime cursorTemporal;

    @Column(name = "creado_por", nullable = false)
    private Long creadoPor;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt = LocalDateTime.now();

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public enum EstadoSimulacion {
        PENDIENTE, EJECUTANDO, PAUSADA, FINALIZADA, CANCELADA
    }
}
