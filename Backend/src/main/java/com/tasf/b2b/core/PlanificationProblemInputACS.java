package com.tasf.b2b.core;

import java.util.*;

/**
 * Input interno del ACS que trabaja con sus propias clases (Aeropuerto, Vuelo, Pedido).
 * Usado exclusivamente por AntColonySystem y VueloSelector.
 */
public class PlanificationProblemInputACS {

    private final Map<String, Aeropuerto> aeropuertos;
    private final Map<String, List<Vuelo>> vuelosPorOrigen;
    private final List<Pedido> pedidos;
    private final Map<String, Integer> ocupacionGlobalVuelos;
    private final Map<String, int[]> ocupacionGlobalAlmacenes;

    public PlanificationProblemInputACS(
            Map<String, Aeropuerto> aeropuertos,
            List<Vuelo> vuelos,
            List<Pedido> pedidos,
            Map<String, Integer> ocupacionGlobalVuelos,
            Map<String, int[]> ocupacionGlobalAlmacenes) {

        this.aeropuertos           = aeropuertos;
        this.pedidos               = pedidos;
        this.ocupacionGlobalVuelos = ocupacionGlobalVuelos;
        this.ocupacionGlobalAlmacenes = ocupacionGlobalAlmacenes;

        this.vuelosPorOrigen = new HashMap<>();
        for (Vuelo v : vuelos) {
            this.vuelosPorOrigen
                    .computeIfAbsent(v.getOrigen(), k -> new ArrayList<>())
                    .add(v);
        }
    }

    public Aeropuerto getAeropuerto(String id) { return aeropuertos.get(id); }
    public Map<String, Aeropuerto> getAeropuertos() { return aeropuertos; }

    public List<Vuelo> getVuelosDesdeLinea(String origen) {
        return vuelosPorOrigen.getOrDefault(origen, new ArrayList<>());
    }

    public List<Pedido> getPedidos() { return pedidos; }

    public int getOcupacionGlobalVuelos(String flightKey) {
        return ocupacionGlobalVuelos.getOrDefault(flightKey, 0);
    }

    public int[] getOcupacionGlobalAlmacenes(String warehouseKey) {
        int[] existente = ocupacionGlobalAlmacenes.get(warehouseKey);
        if (existente == null) {
            return TimeUtils.nuevoArregloOcupacionAlmacen();
        }
        return TimeUtils.ajustarArregloOcupacion(existente);
    }

}

