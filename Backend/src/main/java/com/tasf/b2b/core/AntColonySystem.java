package com.tasf.b2b.core;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.IntStream;

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
    /** NÃºmero de hormigas por iteraciÃ³n del bucle principal (bloques pequeÃ±os). */
    private static final int    M_HORMIGAS      = 10;
    /** Saltos mÃ¡ximos en la bÃºsqueda A* (profundidad del grafo de rutas). */
    private static final int    MAX_SALTOS_ASTAR = 6;
    /** Pares mÃ¡ximos evaluados en busquedaLocalCROSS por pedido. */
    private static final int    MAX_CROSS_PAIRS  = 50;
    /** Entradas mÃ¡ximas en el mapa de feromonas antes de limpiar. */
    private static final int    MAX_FEROMONAS    = 500_000;
    /** Iteraciones ACS sin mejora antes de detener (bloques medianos/grandes). */
    private static final int    MAX_ITER_SIN_MEJORA = 3;
    /** Fracción del tiempo para solución inicial (el resto al bucle ACS). */
    private static final double FRACCION_TIEMPO_INICIAL = 0.30;
    /** Pedidos máximos en la fase inicial para bloques muy grandes (urgencia primero). */
    private static final int    MAX_PEDIDOS_INICIAL   = 100;
    /** Umbral de pedidos para parada temprana por convergencia. */
    private static final int    UMBRAL_PARADA_TEMPRANA = 200;
    // ========================================

    private static final class ResultadoHormiga {
        final Ruta ruta;
        final double responsividad;
        final double distancia;

        ResultadoHormiga(Ruta ruta, double responsividad, double distancia) {
            this.ruta = ruta;
            this.responsividad = responsividad;
            this.distancia = distancia;
        }
    }

    public static PlanificationSolutionOutputACS ACS_TASF(
            PlanificationProblemInputACS input, Instant reloj, long maxTiempoMs) {

        int n = input.getPedidos().size();
        if (n == 0) return new PlanificationSolutionOutputACS(new ArrayList<>());

        long inicio = System.currentTimeMillis();
        long deadline = inicio + maxTiempoMs;
        long deadlineInicial = inicio + (long) (maxTiempoMs * FRACCION_TIEMPO_INICIAL);

        // --- 1. SoluciÃ³n inicial constructiva (todos los pedidos, ordenados por urgencia) ---
        PlanificationSolutionOutputACS psiStar = construirSolucionInicial(input, deadlineInicial);
        double Rstar = calcularResponsiveness(psiStar, input);
        double Tstar = calcularDistanciaTotal(psiStar);

        if (System.currentTimeMillis() >= deadline) {
            return psiStar;
        }

        double tau0 = Rstar > 0
                ? 1.0 / (n * Math.max(Rstar / n, 0.01))
                : 1.0 / Math.max(n, 1);

        Map<String, Double> feromonas = new ConcurrentHashMap<>();
        if (Rstar > 0) {
            for (Asignacion a : psiStar.getAsignaciones()) {
                feromonas.put(a.getFlightKey(), tau0 * 1.5);
            }
        }

        List<Pedido> pedidosPorUrgencia = new ArrayList<>(input.getPedidos());
        pedidosPorUrgencia.sort(Comparator.comparing(Pedido::getTiempoLimite));

        int mHormigas = hormigasPorTamano(n);
        int iteracionesSinMejora = 0;
        final double EPS = 1e-6;

        // --- 2. Bucle ACS (paralelo solo en bloques grandes; sin lock global) ---
        while (System.currentTimeMillis() < deadline) {
            double rAntes = Rstar;
            List<ResultadoHormiga> resultados = new ArrayList<>(mHormigas);

            if (n >= UMBRAL_PARADA_TEMPRANA) {
                List<ResultadoHormiga> paralelo = Collections.synchronizedList(new ArrayList<>());
                IntStream.range(0, mHormigas).parallel().forEach(h -> {
                    if (System.currentTimeMillis() >= deadline) return;
                    ResultadoHormiga res = ejecutarHormiga(
                            pedidosPorUrgencia, feromonas, tau0, input, deadline);
                    if (res != null) paralelo.add(res);
                });
                resultados.addAll(paralelo);
            } else {
                for (int h = 0; h < mHormigas; h++) {
                    if (System.currentTimeMillis() >= deadline) break;
                    ResultadoHormiga res = ejecutarHormiga(
                            pedidosPorUrgencia, feromonas, tau0, input, deadline);
                    if (res != null) resultados.add(res);
                }
            }

            for (ResultadoHormiga res : resultados) {
                if (res.responsividad < Rstar - EPS
                        || (Math.abs(res.responsividad - Rstar) < EPS && res.distancia < Tstar)) {
                    psiStar = res.ruta.aPlanificationSolution();
                    Rstar = res.responsividad;
                    Tstar = res.distancia;
                }
            }

            if (Rstar > 0) {
                for (Asignacion a : psiStar.getAsignaciones()) {
                    String key = a.getFlightKey();
                    double tauActual = feromonas.getOrDefault(key, tau0);
                    feromonas.put(key, (1 - RHO) * tauActual + RHO / Rstar);
                }
            }

            if (feromonas.size() > MAX_FEROMONAS) {
                double umbral = tau0 * 0.01;
                feromonas.entrySet().removeIf(e -> e.getValue() < umbral);
                if (feromonas.size() > MAX_FEROMONAS / 2) {
                    feromonas.replaceAll((k, v) -> v * (1 - RHO * 5));
                }
            }

            if (Rstar >= rAntes - EPS) {
                iteracionesSinMejora++;
            } else {
                iteracionesSinMejora = 0;
            }
            if (n >= UMBRAL_PARADA_TEMPRANA && iteracionesSinMejora >= MAX_ITER_SIN_MEJORA) {
                Logger.info("ACS - Parada temprana tras " + iteracionesSinMejora
                        + " iteraciones sin mejora (" + n + " pedidos).");
                break;
            }
        }

        return psiStar;
    }

    /** Menos hormigas en bloques grandes: misma lógica ACS, menos reconstrucciones redundantes. */
    private static int hormigasPorTamano(int n) {
        if (n >= 1500) return 4;
        if (n >= 800)  return 6;
        if (n >= 400)  return 8;
        return M_HORMIGAS;
    }

    private static ResultadoHormiga ejecutarHormiga(
            List<Pedido> pedidosPorUrgencia,
            Map<String, Double> feromonas,
            double tau0,
            PlanificationProblemInputACS input,
            long deadline) {

        VueloSelector.limpiarCacheDisponibilidad();
        Ruta ruta = construirRutaHormiga(pedidosPorUrgencia, feromonas, tau0, input, deadline);
        if (ruta.getAsignaciones().isEmpty()) {
            return null;
        }
        if (System.currentTimeMillis() < deadline) {
            ruta = busquedaLocalCROSS(ruta, input);
        }
        PlanificationSolutionOutputACS sol = ruta.aPlanificationSolution();
        return new ResultadoHormiga(
                ruta,
                calcularResponsiveness(sol, input),
                calcularDistanciaTotal(sol));
    }

    private static Ruta construirRutaHormiga(
            List<Pedido> pedidosPorUrgencia,
            Map<String, Double> feromonas,
            double tau0,
            PlanificationProblemInputACS input,
            long deadline) {

        Ruta ruta = new Ruta();

        for (Pedido pedido : pedidosPorUrgencia) {
            if (System.currentTimeMillis() >= deadline) break;
            if (ruta.getUbicacionActual(pedido).equals(pedido.getDestino())) continue;

            List<Vuelo> rutaCompleta = VueloSelector.encontrarRutaCompletaAstar(
                    pedido, ruta, feromonas, tau0, input, MAX_SALTOS_ASTAR, deadline);
            if (rutaCompleta == null) continue;

            for (Vuelo vuelo : rutaCompleta) {
                LocalDateTime disp = ruta.getDisponibilidadPedido(pedido);
                LocalDateTime salidaDelVuelo = disp.toLocalDate().atTime(vuelo.getHoraSalida());
                if (salidaDelVuelo.isBefore(disp)) salidaDelVuelo = salidaDelVuelo.plusDays(1);

                String flightKey = vuelo.getId() + "-" + salidaDelVuelo.toLocalDate();
                ruta.agregarAsignacion(pedido, vuelo);
                ruta.registrarUsoAlmacen(vuelo.getOrigen(), disp,
                        salidaDelVuelo, pedido.getCantidadMaletas());

                double tauActual = feromonas.getOrDefault(flightKey, tau0);
                feromonas.put(flightKey, (1 - RHO) * tauActual + RHO * tau0);
            }
            registrarAlmacenDestinoFinal(pedido, rutaCompleta, ruta);
        }

        return ruta;
    }

    // =======================================================================
    //  MÃ©tricas
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
    //  SoluciÃ³n inicial con A* puro ordenado por urgencia (todos los pedidos)
    // =======================================================================

    private static PlanificationSolutionOutputACS construirSolucionInicial(
            PlanificationProblemInputACS input, long deadline) {

        List<Pedido> todos = new ArrayList<>(input.getPedidos());
        todos.sort(Comparator.comparing(Pedido::getTiempoLimite));

        List<Pedido> aProc = todos;
        if (todos.size() > MAX_PEDIDOS_INICIAL * 10) {
            int limite = Math.min(MAX_PEDIDOS_INICIAL, Math.max(todos.size() / 10, 1));
            aProc = todos.subList(0, Math.min(limite, todos.size()));
        }

        Ruta rutaTemp = new Ruta();
        VueloSelector.limpiarCacheDisponibilidad();

        Map<String, Double> sinFeromonas = Collections.emptyMap();

        for (Pedido p : aProc) {
            if (System.currentTimeMillis() >= deadline) break;

            List<Vuelo> rutaCompleta = VueloSelector.encontrarRutaCompletaAstar(
                    p, rutaTemp, sinFeromonas, 1.0, input, MAX_SALTOS_ASTAR, deadline);
            if (rutaCompleta == null) continue;

            for (Vuelo v : rutaCompleta) {
                LocalDateTime disp = rutaTemp.getDisponibilidadPedido(p);
                LocalDateTime salida = disp.toLocalDate().atTime(v.getHoraSalida());
                if (salida.isBefore(disp)) salida = salida.plusDays(1);
                rutaTemp.agregarAsignacion(p, v);
                rutaTemp.registrarUsoAlmacen(v.getOrigen(), disp, salida, p.getCantidadMaletas());
            }
            registrarAlmacenDestinoFinal(p, rutaCompleta, rutaTemp);
        }

        Logger.info("ACS - Solución inicial A* (" + aProc.size() + "/" + todos.size() + " pedidos).");
        return rutaTemp.aPlanificationSolution();
    }

    /** Registra 15 min de estadia en el almacen del aeropuerto destino final antes de la recogida. */
    private static void registrarAlmacenDestinoFinal(
            Pedido pedido, List<Vuelo> rutaCompleta, Ruta ruta) {
        if (rutaCompleta == null || rutaCompleta.isEmpty()) return;
        Vuelo ultimoVuelo = rutaCompleta.get(rutaCompleta.size() - 1);
        if (!ultimoVuelo.getDestino().equals(pedido.getDestino())) return;

        LocalDateTime recogidaCliente = ruta.getDisponibilidadPedido(pedido);
        LocalDateTime llegadaDestino = recogidaCliente.minusMinutes(VueloSelector.DESTINO_FINAL_MINUTES);
        ruta.registrarUsoAlmacen(
                ultimoVuelo.getDestino(),
                llegadaDestino,
                recogidaCliente,
                pedido.getCantidadMaletas());
    }

    // =======================================================================
    //  busquedaLocalCROSS
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
