package com.tasf.b2b.core;

import java.util.*;

/**
 * Encapsula la entrada del problema de planificaciÃ³n para ambos algoritmos.
 * Usa las estructuras de datos del Algoritmo GenÃ©tico (AeropuertoAlgoritmo,
 * VueloAlgoritmo, EnvioAlgoritmo) como base canÃ³nica.
 */
public class PlanificationProblemInput {

    private Map<String, AeropuertoAlgoritmo> aeropuertos;
    private Map<String, List<VueloAlgoritmo>> vuelosPorOrigen;
    private List<VueloAlgoritmo> todosLosVuelos;
    private List<EnvioAlgoritmo> envios;

    // OcupaciÃ³n global acumulada entre bloques (clave: origen-destino-horaSalida-fecha)
    private Map<String, Integer> ocupacionGlobalVuelos;
    // OcupaciÃ³n acumulada de almacenes (clave: oaciAlmacen, valor: array de ocupaciÃ³n por minuto)
    private Map<String, int[]> ocupacionGlobalAlmacenes;
    // Cancelaciones activas (clave: origen-destino-fechaSalida)
    private Set<String> vuelosCancelados;

    public PlanificationProblemInput() {
        this.aeropuertos            = new HashMap<>();
        this.vuelosPorOrigen        = new HashMap<>();
        this.todosLosVuelos         = new ArrayList<>();
        this.envios                 = new ArrayList<>();
        this.ocupacionGlobalVuelos  = new HashMap<>();
        this.ocupacionGlobalAlmacenes = new HashMap<>();
        this.vuelosCancelados       = new HashSet<>();
    }

    public void setVuelosCancelados(Set<String> cancelados) {
        this.vuelosCancelados = new HashSet<>(cancelados);
    }

    public Set<String> getVuelosCancelados() {
        return vuelosCancelados;
    }

    // ---- Aeropuertos ----

    public void agregarAeropuerto(AeropuertoAlgoritmo a) {
        aeropuertos.put(a.getOaci(), a);
    }

    public AeropuertoAlgoritmo getAeropuerto(String oaci) {
        return aeropuertos.get(oaci);
    }

    public Map<String, AeropuertoAlgoritmo> getMapaAeropuertos() {
        return aeropuertos;
    }

    // ---- Vuelos ----

    public void agregarVuelo(VueloAlgoritmo v) {
        todosLosVuelos.add(v);
        vuelosPorOrigen.computeIfAbsent(v.getOrigenOaci(), k -> new ArrayList<>()).add(v);
    }

    /**
     * Reemplaza completamente la lista de vuelos en el inputMaestro sin tocar
     * el estado de ocupación global. Útil para reflejar vuelos añadidos o
     * eliminados desde la pantalla de gestión sin reinicializar todo el estado.
     */
    public void resetearVuelos(List<VueloAlgoritmo> nuevosVuelos) {
        this.todosLosVuelos = new ArrayList<>(nuevosVuelos);
        this.vuelosPorOrigen = new HashMap<>();
        for (VueloAlgoritmo v : nuevosVuelos) {
            vuelosPorOrigen.computeIfAbsent(v.getOrigenOaci(), k -> new ArrayList<>()).add(v);
        }
    }

    public List<VueloAlgoritmo> getTodosLosVuelos() {
        return todosLosVuelos;
    }

    public List<VueloAlgoritmo> getVuelosDesdeOrigen(String origenOaci) {
        return vuelosPorOrigen.getOrDefault(origenOaci, new ArrayList<>());
    }

    // ---- EnvÃ­os ----

    public void agregarEnvio(EnvioAlgoritmo e) {
        envios.add(e);
    }

    public void setEnvios(List<EnvioAlgoritmo> lista) {
        this.envios = new ArrayList<>(lista);
    }

    public List<EnvioAlgoritmo> getEnvios() {
        return envios;
    }

    // ---- OcupaciÃ³n global de vuelos ----

    public int getOcupacionGlobalVuelo(String claveVuelo) {
        return ocupacionGlobalVuelos.getOrDefault(claveVuelo, 0);
    }

    public Map<String, Integer> getOcupacionGlobalVuelos() {
        return ocupacionGlobalVuelos;
    }

    // ---- OcupaciÃ³n global de almacenes ----

    public Map<String, int[]> getOcupacionGlobalAlmacenes() {
        return ocupacionGlobalAlmacenes;
    }

    /**
     * Crea un sub-input que comparte aeropuertos, vuelos y ocupaciones globales
     * por referencia, pero tiene su propia lista de envÃ­os.
     */
    public PlanificationProblemInput crearSubInput(List<EnvioAlgoritmo> subEnvios) {
        PlanificationProblemInput sub = new PlanificationProblemInput();
        sub.aeropuertos             = this.aeropuertos;
        sub.vuelosPorOrigen         = this.vuelosPorOrigen;
        sub.todosLosVuelos          = this.todosLosVuelos;
        sub.envios                  = new ArrayList<>(subEnvios);
        sub.ocupacionGlobalVuelos   = this.ocupacionGlobalVuelos;
        sub.ocupacionGlobalAlmacenes = this.ocupacionGlobalAlmacenes;
        sub.vuelosCancelados        = this.vuelosCancelados;
        return sub;
    }
}

