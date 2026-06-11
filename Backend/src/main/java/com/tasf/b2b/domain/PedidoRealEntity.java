package com.tasf.b2b.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "pedido_real", indexes = {
    @Index(name = "idx_pr_aerolinea_estado", columnList = "aerolinea_id, estado"),
    @Index(name = "idx_pr_estado_fecha",     columnList = "estado, fecha_hora_registro"),
    @Index(name = "idx_pr_operario",         columnList = "operario_id")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PedidoRealEntity {
    @Id @Column(length = 50)
    private String id;                         // "PED-XXXXXXXX"

    private String origenOaci;
    private String destinoOaci;
    private LocalDateTime fechaHoraRegistro;
    private Integer cantidadMaletas;
    
    @Column(name = "aerolinea_id")
    private Long aerolineaId;                  // Aerolínea que registra el pedido
    
    @Column(name = "operario_id")
    private Long operarioId;                   // Operario que lo registró

    @Enumerated(EnumType.STRING)
    private EstadoPedido estado = EstadoPedido.PENDIENTE;

    // Campos de planificación (soporte histórico)
    private LocalDateTime fechaPlanificacion;  // Cuándo fue planificado por primera vez
    private LocalDateTime fechaEntrega;        // Cuándo llegó al destino (histórico)
    private Integer totalTramos;               // Número de tramos asignados
    private String ubicacionActual;            // OACI del nodo actual (para mapa)

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    public enum EstadoPedido {
        PENDIENTE,     // Registrado, esperando próximo ciclo Sa
        PLANIFICADO,   // Ruta calculada, tramos aún no han despegado
        EN_RUTA,       // Al menos 1 tramo EN_VUELO
        ENTREGADO,     // Llegó al destino final
        SIN_RUTA,      // El algoritmo no encontró ruta viable
        COLAPSO        // Excedió tiempo límite
    }
}
