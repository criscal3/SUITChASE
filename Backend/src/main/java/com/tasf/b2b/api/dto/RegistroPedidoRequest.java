package com.tasf.b2b.api.dto;

public record RegistroPedidoRequest(
    String origenOaci,
    String destinoOaci,
    Integer cantidadMaletas,
    Long aerolineaId
) {}
