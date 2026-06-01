package com.tasf.b2b.core;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Selector de vuelo para el ACS (Ant Colony System).
 * Implementa la heurÃ­stica y regla de transiciÃ³n del paper de Schyns,
 * mÃ¡s bÃºsqueda A* guiada por feromonas para encontrar rutas completas.
 */
public class VueloSelector {

    private static final Random random = new Random(11111L);

    // ======= PARÃMETROS CONFIGURABLES =======
    /** Probabilidad de explotaciÃ³n (vs exploraciÃ³n probabilÃ­stica). */
    private static final double Q0 = 0.3;
    /** Peso de la heurÃ­stica de visibilidad (inverso del costo). */
    private static final double BETA = 2.0;
    /** Minutos mÃ­nimos de manipulaciÃ³n de maletas entre vuelos. */
    public static final int HANDLING_MINUTES = 10;
    // ========================================

    // Cache ThreadLocal para getDisponibilidadAbsoluta.
    // Clave: pedidoId + ":" + totalAsignaciones â†’ evita recalcular para el mismo estado de Ruta.
    private static final ThreadLocal<Map<String, LocalDateTime>> CACHE_DISP =
            ThreadLocal.withInitial(HashMap::new);

    /** Limpia el cache de disponibilidad. Llamar al inicio de cada hormiga. */
    public static void limpiarCacheDisponibilidad() {
        CACHE_DISP.get().clear();
    }

    // =======================================================================
    //  Nodo interno para A* (equivalente ACS de NodoRuta del AG)
    // =======================================================================

    private static class NodoAstar implements Comparable<NodoAstar> {
        final String ubicacion;
        final LocalDateTime tiempoDisponible; // cuÃ¡ndo la maleta puede tomar el siguiente vuelo
        final List<Vuelo> vuelosUsados;
        final double costoF; // f = g + h - bonusFeromonas

        NodoAstar(String ubicacion, LocalDateTime tiempoDisponible,
                  List<Vuelo> vuelosUsados, double costoF) {
            this.ubicacion       = ubicacion;
            this.tiempoDisponible = tiempoDisponible;
            this.vuelosUsados    = vuelosUsados;
            this.costoF          = costoF;
        }

        @Override
        public int compareTo(NodoAstar o) {
            return Double.compare(this.costoF, o.costoF);
        }
    }

    // =======================================================================
    //  A* guiado por feromonas â€” reemplaza el bucle greedy hop-a-hop
    // =======================================================================

    /**
     * Encuentra la ruta completa Ã³ptima (A*) para el pedido, sesgada por feromonas.
     * Las rutas con alta feromona tienen menor costo efectivo y son preferidas.
     *
     * @param maxSaltos Profundidad mÃ¡xima de bÃºsqueda (nÃºmero de vuelos en la ruta)
     * @return Lista ordenada de vuelos que forman la ruta, o null si no existe.
     */
    public static List<Vuelo> encontrarRutaCompletaAstar(
            Pedido p, Ruta ruta, Map<String, Double> feromonas,
            double tau0, PlanificationProblemInputACS input, int maxSaltos) {

        LocalDateTime tiempoInicio = getDisponibilidadAbsoluta(p, ruta);
        double hInicial = estimarTiempoRestante(p.getOrigen(), p.getDestino(), input) * 60.0;

        PriorityQueue<NodoAstar> cola = new PriorityQueue<>();
        cola.add(new NodoAstar(p.getOrigen(), tiempoInicio, new ArrayList<>(), hInicial));

        // Mejor tiempo de llegada visto por aeropuerto (para poda)
        Map<String, LocalDateTime> mejorLlegada = new HashMap<>();

        while (!cola.isEmpty()) {
            NodoAstar actual = cola.poll();

            // Llegamos al destino
            if (actual.ubicacion.equals(p.getDestino())) {
                return actual.vuelosUsados;
            }

            // LÃ­mite de profundidad
            if (actual.vuelosUsados.size() >= maxSaltos) continue;

            // Poda: ya encontramos una llegada igual o mejor a este aeropuerto
            LocalDateTime prevMejor = mejorLlegada.get(actual.ubicacion);
            if (prevMejor != null && !actual.tiempoDisponible.isBefore(prevMejor)) continue;
            mejorLlegada.put(actual.ubicacion, actual.tiempoDisponible);

            for (Vuelo v : input.getVuelosDesdeLinea(actual.ubicacion)) {
                // No revisitar aeropuertos ya en la ruta (evita ciclos)
                if (aeropuertoEnRuta(actual.vuelosUsados, v.getDestino(), p.getOrigen())) continue;

                // Calcular tiempos
                LocalDateTime salida = actual.tiempoDisponible.toLocalDate().atTime(v.getHoraSalida());
                if (salida.isBefore(actual.tiempoDisponible)) salida = salida.plusDays(1);
                LocalDateTime llegada = salida.toLocalDate().atTime(v.getHoraLlegada());
                if (llegada.isBefore(salida)) llegada = llegada.plusDays(1);
                LocalDateTime dispSiguiente = llegada.plusMinutes(HANDLING_MINUTES);

                // Verificar SLA
                if (dispSiguiente.isAfter(p.getTiempoLimite())) continue;

                // Verificar capacidad del vuelo
                String flightKey = v.getId() + "-" + salida.toLocalDate();
                int usoGlobalVuelo = input.getOcupacionGlobalVuelos(flightKey);
                int usoLocalVuelo  = ruta.getOcupacionVuelo(flightKey);
                if (usoGlobalVuelo + usoLocalVuelo + p.getCantidadMaletas() > v.getCapacidad()) continue;

                // Verificar capacidad del almacÃ©n de origen minuto a minuto
                Aeropuerto aeroOrig = input.getAeropuerto(v.getOrigen());
                if (aeroOrig == null) continue;
                
                int idxInicio = TimeUtils.getIndiceMinuto(actual.tiempoDisponible);
                int idxFin = TimeUtils.getIndiceMinuto(salida);
                if (!TimeUtils.intervaloAlmacenValido(idxInicio, idxFin)) continue;

                int[] globalAlmacen = input.getOcupacionGlobalAlmacenes(v.getOrigen());
                int[] localAlmacen = ruta.getOcupacionAlmacen(v.getOrigen());

                boolean almacenOK = true;
                for (int i = idxInicio; i < idxFin; i++) {
                    int usoGlobal = TimeUtils.usoAlmacenEnMinuto(globalAlmacen, i);
                    int usoLocal = TimeUtils.usoAlmacenEnMinuto(localAlmacen, i);
                    
                    if (usoGlobal + usoLocal + p.getCantidadMaletas() > aeroOrig.getCapacidad()) {
                        almacenOK = false;
                        break;
                    }
                }
                
                if (!almacenOK) continue;

                // Verificar almacen destino final: 10 min de estadia antes de recogida
                if (v.getDestino().equals(p.getDestino())
                        && !almacenTieneCapacidadEnIntervalo(
                                v.getDestino(), llegada, dispSiguiente,
                                p.getCantidadMaletas(), input, ruta)) {
                    continue;
                }

                // Costo A* con bias de feromonas:
                // Mayor feromona â†’ bonus negativo â†’ ruta mÃ¡s barata â†’ preferida
                double tau = feromonas.getOrDefault(flightKey, tau0);
                double bonusMin = Math.max(0.0, (tau / tau0 - 1.0) * 120.0); // hasta 2h de bonus
                double g = java.time.Duration.between(p.getTiempoCreacion(), dispSiguiente).toMinutes();
                double h = estimarTiempoRestante(v.getDestino(), p.getDestino(), input) * 60.0;
                double f = Math.max(0.0, g + h - bonusMin);

                List<Vuelo> nuevaRuta = new ArrayList<>(actual.vuelosUsados);
                nuevaRuta.add(v);
                cola.add(new NodoAstar(v.getDestino(), dispSiguiente, nuevaRuta, f));
            }
        }

        return null; // No se encontrÃ³ ruta dentro de las restricciones
    }

    /** Verifica si un aeropuerto ya aparece en la ruta en construcciÃ³n (evita ciclos). */
    private static boolean aeropuertoEnRuta(List<Vuelo> vuelos, String aeropuerto, String origen) {
        if (aeropuerto.equals(origen)) return true;
        for (Vuelo v : vuelos) {
            if (v.getOrigen().equals(aeropuerto) || v.getDestino().equals(aeropuerto)) return true;
        }
        return false;
    }

    // =======================================================================
    //  seleccionarSiguienteVuelo â€” versiÃ³n con disp pre-calculado (mantenida)
    // =======================================================================

    public static Vuelo seleccionarSiguienteVuelo(
            Pedido p, Ruta ruta, Map<String, Double> feromonas,
            double tau0, PlanificationProblemInputACS input, Instant reloj,
            LocalDateTime disp) {

        List<Vuelo> Ni = candidatosViables(p, ruta, input, disp);
        if (Ni == null || Ni.isEmpty()) return null;

        double[] valor     = new double[Ni.size()];
        double   sumaValor = 0.0;
        int      mejorIdx  = 0;
        double   mejorVal  = -1.0;

        for (int idx = 0; idx < Ni.size(); idx++) {
            Vuelo j = Ni.get(idx);

            LocalDateTime salida = disp.toLocalDate().atTime(j.getHoraSalida());
            if (salida.isBefore(disp)) salida = salida.plusDays(1);
            LocalDateTime llegada = salida.toLocalDate().atTime(j.getHoraLlegada());
            if (llegada.isBefore(salida)) llegada = llegada.plusDays(1);

            double Rij = java.time.Duration.between(p.getTiempoCreacion(), llegada).toMinutes() / 60.0;
            double costoRestante = estimarTiempoRestante(j.getDestino(), p.getDestino(), input);
            Rij += costoRestante;
            if (Rij <= 0) Rij = 0.001;

            double eta_ij  = 1.0 / Rij;
            String flightKey = j.getId() + "-" + salida.toLocalDate();
            double tau     = feromonas.getOrDefault(flightKey, tau0);

            valor[idx] = tau * Math.pow(eta_ij, BETA);
            sumaValor += valor[idx];

            if (valor[idx] > mejorVal) {
                mejorVal = valor[idx];
                mejorIdx = idx;
            }
        }

        if (random.nextDouble() <= Q0) return Ni.get(mejorIdx);
        if (sumaValor <= 0) return Ni.get(random.nextInt(Ni.size()));

        double tirada = random.nextDouble() * sumaValor;
        double acum   = 0.0;
        for (int idx = 0; idx < Ni.size(); idx++) {
            acum += valor[idx];
            if (acum >= tirada) return Ni.get(idx);
        }
        return Ni.get(Ni.size() - 1);
    }

    public static Vuelo seleccionarSiguienteVuelo(
            Pedido p, Ruta ruta, Map<String, Double> feromonas,
            double tau0, PlanificationProblemInputACS input, Instant reloj) {
        return seleccionarSiguienteVuelo(p, ruta, feromonas, tau0, input, reloj,
                getDisponibilidadAbsoluta(p, ruta));
    }

    // =======================================================================
    //  candidatosViables
    // =======================================================================

    public static List<Vuelo> candidatosViables(
            Pedido p, Ruta ruta, PlanificationProblemInputACS input, LocalDateTime disp) {

        String desde = ruta.getUbicacionActual(p);
        List<Vuelo> viables = new ArrayList<>();

        for (Vuelo v : input.getVuelosDesdeLinea(desde)) {
            if (ruta.haVisitadoAeropuerto(p, v.getDestino())) continue;

            LocalDateTime salida = disp.with(v.getHoraSalida());
            if (salida.isBefore(disp)) salida = salida.plusDays(1);
            LocalDateTime llegada = salida.with(v.getHoraLlegada());
            if (llegada.isBefore(salida)) llegada = llegada.plusDays(1);

            if (llegada.isAfter(p.getTiempoLimite())) continue;

            String flightKey = v.getId() + "-" + salida.toLocalDate().toString();
            int usoGlobalVuelo = input.getOcupacionGlobalVuelos(flightKey);
            int usoLocalVuelo  = ruta.getOcupacionVuelo(flightKey);
            if (usoGlobalVuelo + usoLocalVuelo + p.getCantidadMaletas() > v.getCapacidad()) continue;

            Aeropuerto aeroOrig = input.getAeropuerto(v.getOrigen());
            if (aeroOrig == null) continue;

            // VerificaciÃ³n minuto a minuto de almacenes
            int idxInicio = TimeUtils.getIndiceMinuto(disp);
            int idxFin = TimeUtils.getIndiceMinuto(salida);
            if (!TimeUtils.intervaloAlmacenValido(idxInicio, idxFin)) continue;

            int[] globalAlmacen = input.getOcupacionGlobalAlmacenes(v.getOrigen());
            int[] localAlmacen = ruta.getOcupacionAlmacen(v.getOrigen());

            boolean almacenConEspacio = true;
            for (int i = idxInicio; i < idxFin; i++) {
                int usoGlobal = TimeUtils.usoAlmacenEnMinuto(globalAlmacen, i);
                int usoLocal = TimeUtils.usoAlmacenEnMinuto(localAlmacen, i);

                if (usoGlobal + usoLocal + p.getCantidadMaletas() > aeroOrig.getCapacidad()) {
                    almacenConEspacio = false;
                    break;
                }
            }

            if (!almacenConEspacio) continue;

            if (v.getDestino().equals(p.getDestino())) {
                LocalDateTime recogidaCliente = llegada.plusMinutes(HANDLING_MINUTES);
                if (!almacenTieneCapacidadEnIntervalo(
                        v.getDestino(), llegada, recogidaCliente,
                        p.getCantidadMaletas(), input, ruta)) {
                    continue;
                }
            }

            viables.add(v);
        }
        return viables;
    }

    public static List<Vuelo> candidatosViables(
            Pedido p, Ruta ruta, PlanificationProblemInputACS input) {
        return candidatosViables(p, ruta, input, getDisponibilidadAbsoluta(p, ruta));
    }

    // =======================================================================
    //  VerificaciÃ³n de capacidad de almacÃ©n
    // =======================================================================

    public static boolean almacenTieneCapacidadEnIntervalo(
            String oaci, LocalDateTime desde, LocalDateTime hasta,
            int cantidadMaletas, PlanificationProblemInputACS input, Ruta ruta) {

        Aeropuerto aero = input.getAeropuerto(oaci);
        if (aero == null) return false;

        int idxInicio = TimeUtils.getIndiceMinuto(desde);
        int idxFin = TimeUtils.getIndiceMinuto(hasta);
        if (!TimeUtils.intervaloAlmacenValido(idxInicio, idxFin)) return false;

        int[] globalAlmacen = input.getOcupacionGlobalAlmacenes(oaci);
        int[] localAlmacen = ruta.getOcupacionAlmacen(oaci);

        for (int i = idxInicio; i < idxFin; i++) {
            int usoGlobal = TimeUtils.usoAlmacenEnMinuto(globalAlmacen, i);
            int usoLocal = TimeUtils.usoAlmacenEnMinuto(localAlmacen, i);
            if (usoGlobal + usoLocal + cantidadMaletas > aero.getCapacidad()) {
                return false;
            }
        }
        return true;
    }

    // =======================================================================
    //  getDisponibilidadAbsoluta â€” con cache ThreadLocal
    // =======================================================================

    public static LocalDateTime getDisponibilidadAbsoluta(Pedido p, Ruta ruta) {
        List<Asignacion> todas = ruta.getAsignaciones();
        String cacheKey = p.getId() + ":" + todas.size();

        Map<String, LocalDateTime> cache = CACHE_DISP.get();
        LocalDateTime cached = cache.get(cacheKey);
        if (cached != null) return cached;

        LocalDateTime actual = p.getTiempoCreacion();
        for (Asignacion a : todas) {
            if (!a.getPedido().getId().equals(p.getId())) continue;
            Vuelo v = a.getVuelo();
            LocalDateTime salida = actual.with(v.getHoraSalida());
            if (salida.isBefore(actual)) salida = salida.plusDays(1);
            LocalDateTime llegada = salida.with(v.getHoraLlegada());
            if (llegada.isBefore(salida)) llegada = llegada.plusDays(1);
            actual = llegada.plusMinutes(HANDLING_MINUTES);
        }

        cache.put(cacheKey, actual);
        return actual;
    }

    // =======================================================================
    //  HeurÃ­stica de distancia (Haversine)
    // =======================================================================

    static double estimarTiempoRestante(
            String nodoIntermedio, String destinoFinal, PlanificationProblemInputACS input) {
        if (nodoIntermedio.equals(destinoFinal)) return 0.0;

        Aeropuerto aInter = input.getAeropuerto(nodoIntermedio);
        Aeropuerto aDest  = input.getAeropuerto(destinoFinal);
        if (aInter == null || aDest == null) return 12.0;

        double lat1 = Math.toRadians(aInter.getLatitud());
        double lon1 = Math.toRadians(aInter.getLongitud());
        double lat2 = Math.toRadians(aDest.getLatitud());
        double lon2 = Math.toRadians(aDest.getLongitud());

        double dLat = lat2 - lat1;
        double dLon = lon2 - lon1;
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                 + Math.cos(lat1) * Math.cos(lat2)
                 * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double distanciaKm = 6371.0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return distanciaKm / 950.0; // horas estimadas a 950 km/h
    }
}
