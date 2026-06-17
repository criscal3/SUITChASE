package com.tasf.b2b.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "cancelacion_vuelo_real")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class CancelacionVueloEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "vuelo_id")
    private Long vueloId;

    @Column(name = "origen_oaci")
    private String origenOaci;

    @Column(name = "destino_oaci")
    private String destinoOaci;

    @Column(name = "fecha_salida")
    private LocalDateTime fechaSalida;
}
