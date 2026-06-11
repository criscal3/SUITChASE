package com.tasf.b2b.api.dto;

import java.time.LocalDateTime;

public record TramoDTO(
    Integer orden,
    String origenOaci,
    String destinoOaci,
    LocalDateTime fechaSalida,
    LocalDateTime fechaLlegada,
    String estado
) {}
