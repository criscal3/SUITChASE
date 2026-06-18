package com.tasf.b2b.api.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VueloResponseDTO {
    private String id;
    private String origin;
    private String destination;
    private String origenOaci;
    private String destinoOaci;
    private String horaSalida;
    private String horaLlegada;
    private double departureHour;
    private double transitHours;
    private int capacity;
    private int capacidad;
    private int origenGmt;
    private boolean intercontinental;
    private boolean cancelled;
}
