package com.tasf.b2b.api.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record ResumenOperacionesDTO(
    long totalActivos,
    long pendientes,
    long planificados,
    long enRuta,
    LocalDateTime ultimaActualizacion,
    double ocupacionGlobalAlmacenes,
    double ocupacionGlobalVuelos,
    Map<String, Integer> stockActualAlmacenes
) {}
