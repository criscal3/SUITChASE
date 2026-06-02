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
    private final Map<String, Double> cacheHeuristicaHoras = new HashMap<>();

    public PlanificationProblemInputACS(
            Map<String, Aeropuerto> aeropuertos,
            List<Vuelo> vuelos,
            List<Pedido> pedidos,
            Map<String, Integer> ocupacionGlobalVuelos,
            Map<String, int[]> ocupacionGlobalAlmacenes) {

        this.aeropuertos           = aeropuertos;
        this.pedidos               = pedidos;
        this.ocupacionGlobalVuelos = ocupacionGlobalVuelos;

        this.vuelosPorOrigen = new HashMap<>();
        for (Vuelo v : vuelos) {
            this.vuelosPorOrigen
                    .computeIfAbsent(v.getOrigen(), k -> new ArrayList<>())
                    .add(v);
        }

        // Normalizar arreglos de almacén una sola vez (evita copias en cada expansión A*)
        Map<String, int[]> normalizados = new HashMap<>(ocupacionGlobalAlmacenes.size());
        for (Map.Entry<String, int[]> e : ocupacionGlobalAlmacenes.entrySet()) {
            normalizados.put(e.getKey(), TimeUtils.ajustarArregloOcupacion(e.getValue()));
        }
        this.ocupacionGlobalAlmacenes = normalizados;
    }

    public Aeropuerto getAeropuerto(String id) { return aeropuertos.get(id); }
    public Map<String, Aeropuerto> getAeropuertos() { return aeropuertos; }

    public List<Vuelo> getVuelosDesdeLinea(String origen) {
        List<Vuelo> vuelos = vuelosPorOrigen.get(origen);
        return vuelos != null ? vuelos : Collections.emptyList();
    }

    public List<Pedido> getPedidos() { return pedidos; }

    public int getOcupacionGlobalVuelos(String flightKey) {
        return ocupacionGlobalVuelos.getOrDefault(flightKey, 0);
    }

    public int[] getOcupacionGlobalAlmacenes(String warehouseKey) {
        int[] existente = ocupacionGlobalAlmacenes.get(warehouseKey);
        return existente != null ? existente : TimeUtils.almacenSinUso();
    }

    /** Heurística Haversine en horas, cacheada por par OACI (A*). */
    public double estimarHorasHastaDestino(String origen, String destino) {
        if (origen.equals(destino)) {
            return 0.0;
        }
        String key = origen + ">" + destino;
        Double cached = cacheHeuristicaHoras.get(key);
        if (cached != null) {
            return cached;
        }
        Aeropuerto aOrig = aeropuertos.get(origen);
        Aeropuerto aDest = aeropuertos.get(destino);
        if (aOrig == null || aDest == null) {
            cacheHeuristicaHoras.put(key, 12.0);
            return 12.0;
        }
        double lat1 = Math.toRadians(aOrig.getLatitud());
        double lon1 = Math.toRadians(aOrig.getLongitud());
        double lat2 = Math.toRadians(aDest.getLatitud());
        double lon2 = Math.toRadians(aDest.getLongitud());
        double dLat = lat2 - lat1;
        double dLon = lon2 - lon1;
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double distanciaKm = 6371.0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        double horas = distanciaKm / 950.0;
        cacheHeuristicaHoras.put(key, horas);
        return horas;
    }

}

