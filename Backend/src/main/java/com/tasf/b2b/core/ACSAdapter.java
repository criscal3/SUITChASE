package com.tasf.b2b.core;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Adaptador ACS â†’ estructuras canÃ³nicas del AG.
 *
 * SemÃ¡ntica de mapas (idÃ©ntica a AlgoritmoGenetico):
 *   estadoCapacidadesVuelos  â†’ capacidad actual
 *   ocupacionAlmacenes       â†’ maletas acumuladas por hora (clave: OACI-fecha-hora)
 */
public class ACSAdapter {

    public static PlanificationSolutionOutput planificar(PlanificationProblemInput input, long tiempoMs) {

        PlanificationSolutionOutput output = new PlanificationSolutionOutput("ACS");
        if (input.getEnvios().isEmpty()) {
            output.setPromedioConsumoSLA(0.0);
            return output;
        }

        Map<String, Integer> capVuelos = new HashMap<>(input.getOcupacionGlobalVuelos());
        Map<String, int[]> capAlmacenes = new HashMap<>();
        for (Map.Entry<String, int[]> entry : input.getOcupacionGlobalAlmacenes().entrySet()) {
            capAlmacenes.put(entry.getKey(), TimeUtils.ajustarArregloOcupacion(entry.getValue()));
        }

        // --- 1. Aeropuerto ACS interno ---
        Map<String, Aeropuerto> mapaAeropuertosACS = new HashMap<>();
        for (AeropuertoAlgoritmo aa : input.getMapaAeropuertos().values()) {
            mapaAeropuertosACS.put(aa.getOaci(),
                    new Aeropuerto(aa.getOaci(), aa.getContinente(),
                            aa.getGmt(), aa.getCapacidadAlmacen(), 
                            aa.getLatitud(), aa.getLongitud()));
        }

        // --- 2. Vuelo ACS interno + mapa inverso id â†’ VueloAlgoritmo ---
        Map<String, VueloAlgoritmo> mapaVueloPorId = new HashMap<>();
        List<Vuelo> vuelosACS = new ArrayList<>();
        for (VueloAlgoritmo va : input.getTodosLosVuelos()) {
            Vuelo v = new Vuelo(va.getOrigenOaci(), va.getDestinoOaci(),
                    va.getHoraSalida(), va.getHoraLlegada(), va.getCapacidad());
            vuelosACS.add(v);
            mapaVueloPorId.put(v.getId(), va);
        }

        // --- 3. Pedido ACS interno + mapa inverso id â†’ EnvioAlgoritmo ---
        Map<String, EnvioAlgoritmo> mapaEnvioPorPedidoId = new HashMap<>();
        List<Pedido> pedidosACS = new ArrayList<>();
        for (EnvioAlgoritmo ea : input.getEnvios()) {
            AeropuertoAlgoritmo aOrig = input.getAeropuerto(ea.getOrigenOaci());
            AeropuertoAlgoritmo aDest = input.getAeropuerto(ea.getDestinoOaci());
            int limiteHoras = (aOrig != null && aDest != null &&
                    aOrig.getContinente().equalsIgnoreCase(aDest.getContinente())) ? 24 : 48;
            String idUnico = ea.getOrigenOaci() + "-" + ea.getId();
            Pedido p = new Pedido(idUnico, ea.getOrigenOaci(), ea.getDestinoOaci(),
                    ea.getFechaHoraRegistro(), ea.getCantidadMaletas(), ea.getClienteId());
            p.setTiempoLimite(ea.getFechaHoraRegistro().plusHours(limiteHoras));
            pedidosACS.add(p);
            mapaEnvioPorPedidoId.put(idUnico, ea);
        }

        // --- 4. Input ACS interno ---
        PlanificationProblemInputACS inputACS = new PlanificationProblemInputACS(
            mapaAeropuertosACS, 
            vuelosACS, 
            pedidosACS, 
            capVuelos,
            capAlmacenes,
            input.getVuelosCancelados()
        );

        // --- 5. Ejecutar ACS ---
        PlanificationSolutionOutputACS solACS =
                AntColonySystem.ACS_TASF(inputACS, java.time.Instant.now(), tiempoMs);

        // --- 6. Traducir resultado â†’ formato canÃ³nico ---
        Map<String, List<Asignacion>> asigPorPedido = new LinkedHashMap<>();
        for (Asignacion asig : solACS.getAsignaciones()) {
            asigPorPedido
                    .computeIfAbsent(asig.getPedido().getId(), k -> new ArrayList<>())
                    .add(asig);
        }

        // Iteramos sobre TODOS los envÃ­os originales, no solo los que tienen ruta
        for (EnvioAlgoritmo envio : input.getEnvios()) {
            String idUnico = envio.getOrigenOaci() + "-" + envio.getId();
            List<Asignacion> asignadas = asigPorPedido.get(idUnico);

            // Si el ACS no encontrÃ³ ruta (A* retornÃ³ null), registramos el envÃ­o como sin ruta/colapsado
            if (asignadas == null || asignadas.isEmpty()) {
                output.agregarRuta(envio, null);
                continue;
            }

            List<VueloAlgoritmo> vuelosUsados = new ArrayList<>();
            List<LocalDateTime> fechasVuelo   = new ArrayList<>();
            LocalDateTime tiempoActual        = envio.getFechaHoraRegistro();
            LocalDateTime llegadaFinal        = tiempoActual;
            LocalDateTime llegadaAlOrigen     = envio.getFechaHoraRegistro();

            for (Asignacion a : asignadas) {
                VueloAlgoritmo va = mapaVueloPorId.get(a.getVuelo().getId());
                if (va == null) continue;

                LocalDateTime salida = tiempoActual.with(va.getHoraSalida());
                if (salida.isBefore(tiempoActual)) salida = salida.plusDays(1);
                LocalDateTime llegada = salida.with(va.getHoraLlegada());
                if (llegada.isBefore(salida)) llegada = llegada.plusDays(1);

                // Clave de vuelo (misma que AG: origen-destino-horaSalida-fecha)
                String claveVuelo = va.getOrigenOaci() + "-" + va.getDestinoOaci()
                        + "-" + va.getHoraSalida() + "-" + salida.toLocalDate();

                int ocupacionActualVuelo = capVuelos.getOrDefault(claveVuelo, 0);

                actualizarOcupacionAlmacen(va.getOrigenOaci(), llegadaAlOrigen, salida,
                        envio.getCantidadMaletas(), capAlmacenes);

                // â”€â”€ Actualizar capacidad restante del vuelo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                capVuelos.put(claveVuelo, ocupacionActualVuelo + envio.getCantidadMaletas());

                vuelosUsados.add(va);
                fechasVuelo.add(salida);

                tiempoActual  = llegada.plusMinutes(VueloSelector.HANDLING_MINUTES);
                llegadaFinal  = tiempoActual;
                llegadaAlOrigen = llegada;
            }

            // Estadia de 15 min en almacén del aeropuerto destino final antes de recogida
            if (!vuelosUsados.isEmpty()) {
                VueloAlgoritmo ultimoVuelo = vuelosUsados.get(vuelosUsados.size() - 1);
                if (ultimoVuelo.getDestinoOaci().equals(envio.getDestinoOaci())) {
                    LocalDateTime recogidaCliente = llegadaAlOrigen.plusMinutes(VueloSelector.DESTINO_FINAL_MINUTES);
                    actualizarOcupacionAlmacen(
                            ultimoVuelo.getDestinoOaci(),
                            llegadaAlOrigen,
                            recogidaCliente,
                            envio.getCantidadMaletas(),
                            capAlmacenes);
                }
            }

            // Agregar ruta vÃ¡lida
            output.agregarRuta(envio, new ResultadoRuta(
                    llegadaFinal, vuelosUsados, fechasVuelo));
        }

        input.getOcupacionGlobalVuelos().putAll(capVuelos);
        input.getOcupacionGlobalAlmacenes().putAll(capAlmacenes);

        output.calcularPromedioConsumoSLA(input.getMapaAeropuertos());
        output.setEstadoCapacidadesVuelos(capVuelos);
        output.setEstadoOcupacionAlmacenes(capAlmacenes);
        return output;
    }

    /** Replica AlgoritmoGenetico.actualizarOcupacionAlmacen exactamente. */
    private static void actualizarOcupacionAlmacen(
            String oaci, LocalDateTime llegada, LocalDateTime salida,
            int cantidadMaletas, Map<String, int[]> mapaAlmacenes) {
        int idxInicio = TimeUtils.getIndiceMinuto(llegada);
        int idxFin    = TimeUtils.getIndiceMinuto(salida);
        if (!TimeUtils.intervaloAlmacenValido(idxInicio, idxFin)) {
            return;
        }
        int[] almacen = mapaAlmacenes.computeIfAbsent(oaci, k -> TimeUtils.nuevoArregloOcupacionAlmacen());
        almacen = TimeUtils.ajustarArregloOcupacion(almacen);
        mapaAlmacenes.put(oaci, almacen);
        for (int i = idxInicio; i < idxFin; i++) {
            almacen[i] += cantidadMaletas;
        }
    }
}
