package com.tasf.b2b.api.dto;

import java.time.LocalDateTime;
import java.util.List;

public record PedidoRealDTO(
    String id,
    String origenOaci,
    String destinoOaci,
    LocalDateTime fechaHoraRegistro,
    Integer cantidadMaletas,
    Long aerolineaId,
    String nombreAerolinea,
    String estado,
    Integer totalTramos,
    String ubicacionActual,
    List<TramoDTO> tramos,
    String operarioOaci,
    Long operarioId
) {}
