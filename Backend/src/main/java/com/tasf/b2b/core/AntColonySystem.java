package com.tasf.b2b.core;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ACS adaptado segÃºn el paper "An Ant Colony System for Responsive Dynamic Vehicle Routing"
 * de M. Schyns (Gambardella et al. 1999).
 *
 * Mejora clave: cada hormiga usa A* guiado por feromonas (en lugar de selecciÃ³n greedy
 * hop-a-hop) para encontrar rutas completas. Los pedidos se procesan ordenados por
 * urgencia (deadline mÃ¡s prÃ³ximo primero), lo que evita que envÃ­os tardÃ­os consuman
 * la capacidad necesaria para envÃ­os con SLA mÃ¡s ajustado.
 */
public class AntColonySystem {

    // ======= PARÃMETROS CONFIGURABLES =======
    /** Tasa de evaporaciÃ³n de feromonas (local y global). */
    private static final double RHO             = 0.4;
    /** NÃºmero de hormigas por iteraciÃ³n del bucle principal. */
    private static final int    M_HORMIGAS      = 10;
    /** Saltos mÃ¡ximos en la bÃºsqueda A* (profundidad del grafo de rutas). */
    private static final int    MAX_SALTOS_ASTAR = 8;
    /** Pares mÃ¡ximos evaluados en busquedaLocalCROSS por pedido. */
    private static final int    MAX_CROSS_PAIRS  = 50;
    /** Entradas mÃ¡ximas en el mapa de feromonas antes de limpiar. */
    private static final int    MAX_FEROMONAS    = 500_000;
    /** MÃ¡x. pedidos procesados en la soluciÃ³n inicial para entradas muy grandes. */
    private static final int    MAX_PEDIDOS_FIFO  = 100;
    // ========================================

    public static PlanificationSolutionOutputACS ACS_TASF(
            PlanificationProblemInputACS input, Instant reloj, long maxTiempoMs) {

        int n = input.getPedidos().size();
        if (n == 0) return new PlanificationSolutionOutputACS(new ArrayList<>());

        // Deadline global: TODO el mÃ©todo debe terminar antes de este instante
        long deadline = System.currentTimeMillis() + maxTiempoMs;

        // --- 1. SoluciÃ³n inicial con A* puro (sin feromonas aÃºn) ---
        PlanificationSolutionOutputACS psiStar = construirSolucionInicial(input, deadline);
        double Rstar = calcularResponsiveness(psiStar, input);
        double Tstar = calcularDistanciaTotal(psiStar);

        double tau0 = Rstar > 0
                ? 1.0 / (n * Math.max(Rstar / n, 0.01))
                : 1.0 / Math.max(n, 1);

        Map<String, Double> feromonas = new ConcurrentHashMap<>();

        // Ordenar pedidos por urgencia UNA vez â€” se reutiliza en cada hormiga
        List<Pedido> pedidosPorUrgencia = new ArrayList<>(input.getPedidos());
        pedidosPorUrgencia.sort(Comparator.comparing(Pedido::getTiempoLimite));

        // --- 2. Bucle principal ACS ---
        while (System.currentTimeMillis() < deadline) {

            for (int h = 0; h < M_HORMIGAS; h++) {
                if (System.currentTimeMillis() >= deadline) break;

                Ruta ruta = new Ruta();
                VueloSelector.limpiarCacheDisponibilidad();

                for (Pedido pedido : pedidosPorUrgencia) {
                    if (System.currentTimeMillis() >= deadline) break;

                    // Skip pedidos ya en su destino
                    if (ruta.getUbicacionActual(pedido).equals(pedido.getDestino())) continue;

                    // A* guiado por feromonas: encuentra la ruta completa Ã³ptima
                    List<Vuelo> rutaCompleta = VueloSelector.encontrarRutaCompletaAstar(
                            pedido, ruta, feromonas, tau0, input, MAX_SALTOS_ASTAR);

                    if (rutaCompleta == null) continue; // sin ruta posible

                    // Registrar todos los vuelos de la ruta y actualizar feromonas localmente
                    for (Vuelo vuelo : rutaCompleta) {
                        LocalDateTime disp = VueloSelector.getDisponibilidadAbsoluta(pedido, ruta);
                        LocalDateTime salidaDelVuelo = disp.toLocalDate().atTime(vuelo.getHoraSalida());
                        if (salidaDelVuelo.isBefore(disp)) salidaDelVuelo = salidaDelVuelo.plusDays(1);

                        String flightKey = vuelo.getId() + "-" + salidaDelVuelo.toLocalDate();
                        ruta.agregarAsignacion(pedido, vuelo);
                        ruta.registrarUsoAlmacen(vuelo.getOrigen(), disp,
                                salidaDelVuelo, pedido.getCantidadMaletas());

                        // ActualizaciÃ³n local de feromonas (reduce atractivo para otras hormigas)
                        double tauActual = feromonas.getOrDefault(flightKey, tau0);
                        feromonas.put(flightKey, (1 - RHO) * tauActual + RHO * tau0);
                    }
                    registrarAlmacenDestinoFinal(pedido, rutaCompleta, ruta);
                }

                ruta = busquedaLocalCROSS(ruta, input);

                double Rpsi = calcularResponsiveness(ruta.aPlanificationSolution(), input);
                double Tpsi = calcularDistanciaTotal(ruta.aPlanificationSolution());

                final double EPS = 1e-6;
                if (Rpsi < Rstar - EPS || (Math.abs(Rpsi - Rstar) < EPS && Tpsi < Tstar)) {
                    psiStar = ruta.aPlanificationSolution();
                    Rstar   = Rpsi;
                    Tstar   = Tpsi;
                }
            }

            // Limitar tamaÃ±o del mapa de feromonas
            if (feromonas.size() > MAX_FEROMONAS) {
                double umbral = tau0 * 0.01;
                feromonas.entrySet().removeIf(e -> e.getValue() < umbral);
                if (feromonas.size() > MAX_FEROMONAS / 2) {
                    feromonas.replaceAll((k, v) -> v * (1 - RHO * 5));
                }
            }

            // ActualizaciÃ³n global: reforzar rutas de la mejor soluciÃ³n encontrada
            if (Rstar > 0) {
                for (Asignacion a : psiStar.getAsignaciones()) {
                    String key = a.getFlightKey();
                    double tauActual = feromonas.getOrDefault(key, tau0);
                    feromonas.put(key, (1 - RHO) * tauActual + RHO / Rstar);
                }
            }
        }

        return psiStar;
    }

    // =======================================================================
    //  MÃ©tricas â€” sin cambios (lÃ³gica algorÃ­tmica intacta)
    // =======================================================================

    public static double calcularResponsiveness(
            PlanificationSolutionOutputACS sol, PlanificationProblemInputACS input) {

        if (sol == null || sol.getAsignaciones().isEmpty()) return Double.MAX_VALUE / 2;

        Map<String, List<Vuelo>> rutasPorPedido = new HashMap<>();
        for (Asignacion a : sol.getAsignaciones()) {
            rutasPorPedido.computeIfAbsent(a.getPedido().getId(), k -> new ArrayList<>())
                          .add(a.getVuelo());
        }

        double R = 0.0;
        for (Pedido p : input.getPedidos()) {
            List<Vuelo> vuelos = rutasPorPedido.get(p.getId());

            if (vuelos == null || vuelos.isEmpty()) {
                R += 1_000_000.0;
                continue;
            }

            LocalDateTime tiempoCursor = p.getTiempoCreacion();
            String ubicacionActual = p.getOrigen();

            for (Vuelo v : vuelos) {
                LocalDateTime salida = tiempoCursor.toLocalDate().atTime(v.getHoraSalida());
                if (salida.isBefore(tiempoCursor)) salida = salida.plusDays(1);
                LocalDateTime llegada = salida.toLocalDate().atTime(v.getHoraLlegada());
                if (llegada.isBefore(salida)) llegada = llegada.plusDays(1);
                tiempoCursor = llegada;
                ubicacionActual = v.getDestino();
            }

            if (!ubicacionActual.equals(p.getDestino())) {
                R += 1_000_000.0;
                continue;
            }

            double horasTotales = java.time.Duration.between(
                    p.getTiempoCreacion(), tiempoCursor).toMinutes() / 60.0;
            R += Math.max(0, horasTotales);
        }

        return R;
    }

    public static double calcularDistanciaTotal(PlanificationSolutionOutputACS sol) {
        if (sol == null) return Double.MAX_VALUE;
        double t = 0.0;
        for (Asignacion a : sol.getAsignaciones()) {
            Vuelo v = a.getVuelo();
            double s = v.getHoraSalida().toSecondOfDay() / 3600.0;
            double l = v.getHoraLlegada().toSecondOfDay() / 3600.0;
            if (l < s) l += 24.0;
            t += (l - s);
        }
        return t;
    }

    // =======================================================================
    //  SoluciÃ³n inicial con A* puro ordenado por urgencia
    // =======================================================================

    private static PlanificationSolutionOutputACS construirSolucionInicial(
            PlanificationProblemInputACS input, long deadline) {

        List<Pedido> todos = new ArrayList<>(input.getPedidos());
        // Ordenar por urgencia (SLA mÃ¡s ajustado primero)
        todos.sort(Comparator.comparing(Pedido::getTiempoLimite));

        // Para entradas muy grandes, procesar solo los mÃ¡s urgentes
        List<Pedido> aProc = todos;
        if (todos.size() > MAX_PEDIDOS_FIFO * 10) {
            int limite = Math.min(MAX_PEDIDOS_FIFO, Math.max(todos.size() / 10, 1));
            aProc = todos.subList(0, Math.min(limite, todos.size()));
        }

        Ruta rutaTemp = new Ruta();
        VueloSelector.limpiarCacheDisponibilidad();

        // A* sin feromonas (mapa vacÃ­o â†’ sin sesgo, bÃºsqueda puramente Ã³ptima)
        Map<String, Double> sinFeromonas = Collections.emptyMap();

        for (Pedido p : aProc) {
            if (System.currentTimeMillis() >= deadline) break;

            List<Vuelo> rutaCompleta = VueloSelector.encontrarRutaCompletaAstar(
                    p, rutaTemp, sinFeromonas, 1.0, input, MAX_SALTOS_ASTAR);
            if (rutaCompleta == null) continue;

            for (Vuelo v : rutaCompleta) {
                LocalDateTime disp = VueloSelector.getDisponibilidadAbsoluta(p, rutaTemp);
                LocalDateTime salida = disp.toLocalDate().atTime(v.getHoraSalida());
                if (salida.isBefore(disp)) salida = salida.plusDays(1);
                rutaTemp.agregarAsignacion(p, v);
                rutaTemp.registrarUsoAlmacen(v.getOrigen(), disp, salida, p.getCantidadMaletas());
            }
            registrarAlmacenDestinoFinal(p, rutaCompleta, rutaTemp);
        }

        Logger.info("ACS - SoluciÃ³n inicial A* construida (" + aProc.size() + " pedidos).");
        return rutaTemp.aPlanificationSolution();
    }

    /** Registra 10 min de estadia en el almacen del aeropuerto destino final antes de la recogida. */
    private static void registrarAlmacenDestinoFinal(
            Pedido pedido, List<Vuelo> rutaCompleta, Ruta ruta) {
        if (rutaCompleta == null || rutaCompleta.isEmpty()) return;
        Vuelo ultimoVuelo = rutaCompleta.get(rutaCompleta.size() - 1);
        if (!ultimoVuelo.getDestino().equals(pedido.getDestino())) return;

        LocalDateTime recogidaCliente = VueloSelector.getDisponibilidadAbsoluta(pedido, ruta);
        LocalDateTime llegadaDestino = recogidaCliente.minusMinutes(VueloSelector.HANDLING_MINUTES);
        ruta.registrarUsoAlmacen(
                ultimoVuelo.getDestino(),
                llegadaDestino,
                recogidaCliente,
                pedido.getCantidadMaletas());
    }

    // =======================================================================
    //  busquedaLocalCROSS â€” pre-agrupaciÃ³n O(asig) + lÃ­mite de pares
    // =======================================================================

    private static Ruta busquedaLocalCROSS(Ruta ruta, PlanificationProblemInputACS input) {

        Map<String, List<Asignacion>> porPedido = new HashMap<>();
        for (Asignacion a : ruta.getAsignaciones()) {
            porPedido.computeIfAbsent(a.getPedido().getId(), k -> new ArrayList<>()).add(a);
        }

        List<Asignacion> limpias = new ArrayList<>();
        for (Pedido p : input.getPedidos()) {
            List<Asignacion> rp = new ArrayList<>(
                    porPedido.getOrDefault(p.getId(), Collections.emptyList()));
            if (rp.isEmpty()) continue;

            int pares = 0;
            outer:
            for (int i = 0; i < rp.size(); i++) {
                for (int j = rp.size() - 1; j > i; j--) {
                    if (pares++ >= MAX_CROSS_PAIRS) break outer;
                    if (rp.get(i).getVuelo().getOrigen()
                            .equals(rp.get(j).getVuelo().getDestino())) {
                        rp.subList(i + 1, j + 1).clear();
                        break;
                    }
                }
            }
            limpias.addAll(rp);
        }
        return new Ruta(limpias);
    }
}
