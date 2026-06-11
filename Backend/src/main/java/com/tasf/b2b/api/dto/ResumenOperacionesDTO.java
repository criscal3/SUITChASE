package com.tasf.b2b.api.dto;

import java.time.LocalDateTime;

public record ResumenOperacionesDTO(
    long totalActivos,
    long pendientes,
    long planificados,
    long enRuta,
    LocalDateTime ultimaActualizacion
) {}
