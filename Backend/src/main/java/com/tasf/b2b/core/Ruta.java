package com.tasf.b2b.core;

import java.util.List;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;
import java.util.HashSet;

public class Ruta {
    private List<Asignacion> asignaciones;
    private Map<String, Integer> ocupacionVuelos;
    private Map<String, int[]> ocupacionAlmacenes;
    private Map<String, String> estadoUbicacionPedido;
    private Map<String, Set<String>> aeropuertosVisitados;
    /** Disponibilidad O(1) por pedido (evita recorrer asignaciones en cada A*). */
    private Map<String, LocalDateTime> disponibilidadPedido;

    public Ruta() {
        this.asignaciones = new ArrayList<>();
        this.ocupacionVuelos = new HashMap<>();
        this.ocupacionAlmacenes = new HashMap<>();
        this.estadoUbicacionPedido = new HashMap<>();
        this.aeropuertosVisitados = new HashMap<>();
        this.disponibilidadPedido = new HashMap<>();
    }

    public Ruta(List<Asignacion> asignaciones) {
        this.asignaciones = new ArrayList<>(asignaciones);
        this.ocupacionVuelos = new HashMap<>();
        this.ocupacionAlmacenes = new HashMap<>();
        this.estadoUbicacionPedido = new HashMap<>();
        this.aeropuertosVisitados = new HashMap<>();
        this.disponibilidadPedido = new HashMap<>();
        for (Asignacion a : asignaciones) {
            this.ocupacionVuelos.put(a.getVuelo().getId(),
                    this.ocupacionVuelos.getOrDefault(a.getVuelo().getId(), 0) + a.getPedido().getCantidadMaletas());
            this.estadoUbicacionPedido.put(a.getPedido().getId(), a.getVuelo().getDestino());
            this.ocupacionAlmacenes.put(a.getVuelo().getOrigen(),
                    TimeUtils.ajustarArregloOcupacion(this.ocupacionAlmacenes.getOrDefault(
                            a.getVuelo().getOrigen(), TimeUtils.nuevoArregloOcupacionAlmacen())).clone());
            this.aeropuertosVisitados.computeIfAbsent(a.getPedido().getId(), k -> new HashSet<>())
                    .add(a.getVuelo().getDestino());
            this.aeropuertosVisitados.get(a.getPedido().getId()).add(a.getPedido().getOrigen());
        }
    }

    public void agregarAsignacion(Pedido p, Vuelo v) {
        LocalDateTime disp = getDisponibilidadPedido(p);
        LocalDateTime salida = disp.with(v.getHoraSalida());
        if (salida.isBefore(disp)) salida = salida.plusDays(1);
        LocalDateTime llegada = salida.with(v.getHoraLlegada());
        if (llegada.isBefore(salida)) llegada = llegada.plusDays(1);
        String flightKey = v.getId() + "-" + salida.toLocalDate().toString();

        this.asignaciones.add(new Asignacion(p, v, flightKey));
        this.ocupacionVuelos.put(flightKey,
            this.ocupacionVuelos.getOrDefault(flightKey, 0) + p.getCantidadMaletas());
        this.estadoUbicacionPedido.put(p.getId(), v.getDestino());
        this.disponibilidadPedido.put(p.getId(), llegada.plusMinutes(VueloSelector.HANDLING_MINUTES));

        this.aeropuertosVisitados.computeIfAbsent(p.getId(), k -> new HashSet<>()).add(p.getOrigen());
        this.aeropuertosVisitados.get(p.getId()).add(v.getDestino());
    }

    public LocalDateTime getDisponibilidadPedido(Pedido p) {
        return disponibilidadPedido.getOrDefault(p.getId(), p.getTiempoCreacion());
    }

    public List<Asignacion> getAsignaciones() {
        return asignaciones;
    }

    public int getOcupacionVuelo(String vueloId) {
        return ocupacionVuelos.getOrDefault(vueloId, 0);
    }

    public String getUbicacionActual(Pedido p) {
        return estadoUbicacionPedido.getOrDefault(p.getId(), p.getOrigen());
    }

    public boolean haVisitadoAeropuerto(Pedido p, String aeropuertoId) {
        // Solo considerar el origen como visitado si el envío ya salió de ese aeropuerto
        // (ubicación actual diferente del origen). Esto permite replanificaciones
        // donde el envío sigue en su origen original.
        String ubicacionActual = getUbicacionActual(p);
        if (p.getOrigen().equals(aeropuertoId) && !p.getOrigen().equals(ubicacionActual))
            return true;
        Set<String> visitados = aeropuertosVisitados.get(p.getId());
        return visitados != null && visitados.contains(aeropuertoId);
    }

    /** Ultimo vuelo asignado a este pedido, null si ninguno aun. O(1). */
    public Vuelo getUltimoVuelo(Pedido p) {
        // walk backwards through assignments to find last flight for this order
        for (int i = asignaciones.size() - 1; i >= 0; i--) {
            if (asignaciones.get(i).getPedido().getId().equals(p.getId())) {
                return asignaciones.get(i).getVuelo();
            }
        }
        return null;
    }

    public PlanificationSolutionOutputACS aPlanificationSolution() {
        return new PlanificationSolutionOutputACS(new ArrayList<>(this.asignaciones));
    }

    public void registrarUsoAlmacen(String oaci, LocalDateTime llegada, LocalDateTime salida, int cantidad) {
        // 1. Obtener los Ã­ndices de inicio y fin en minutos globales
        int idxInicio = TimeUtils.getIndiceMinuto(llegada);
        int idxFin    = TimeUtils.getIndiceMinuto(salida);

        // 2. Obtener o inicializar el arreglo para este aeropuerto (OACI)
        // El tamaÃ±o debe cubrir hasta el final de la simulaciÃ³n (usualmente FECHA_FIN_SIM + margen)
        if (!TimeUtils.intervaloAlmacenValido(idxInicio, idxFin)) {
            return;
        }

        int[] almacen = this.ocupacionAlmacenes.computeIfAbsent(oaci, k -> TimeUtils.nuevoArregloOcupacionAlmacen());
        almacen = TimeUtils.ajustarArregloOcupacion(almacen);
        this.ocupacionAlmacenes.put(oaci, almacen);

        for (int i = idxInicio; i < idxFin; i++) {
            almacen[i] += cantidad;
        }
    }

    public int[] getOcupacionAlmacen(String claveAlmacen) {
        int[] existente = ocupacionAlmacenes.get(claveAlmacen);
        if (existente == null) {
            return TimeUtils.almacenSinUso();
        }
        return existente;
    }

}

