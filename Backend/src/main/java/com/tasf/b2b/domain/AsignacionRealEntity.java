package com.tasf.b2b.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "asignacion_real", indexes = {
    @Index(name = "idx_ar_pedido",       columnList = "pedido_id"),
    @Index(name = "idx_ar_estado_fecha", columnList = "estado, fecha_salida")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class AsignacionRealEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "pedido_id", nullable = false, length = 50)
    private String pedidoId;

    private Integer ordenVuelo;           // 1, 2, 3…
    private Long vueloId;
    private String origenOaci;            // Denormalizado — evita JOINs en consultas frecuentes
    private String destinoOaci;
    private LocalDateTime fechaSalida;
    private LocalDateTime fechaLlegada;

    @Enumerated(EnumType.STRING)
    private EstadoTramo estado = EstadoTramo.PROGRAMADO;

    public enum EstadoTramo {
        PROGRAMADO,   // Aún no despegó
        EN_VUELO,     // Actualmente volando
        COMPLETADO,   // Aterrizó
        CANCELADO
    }
}
