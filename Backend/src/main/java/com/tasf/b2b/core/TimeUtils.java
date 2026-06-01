package com.tasf.b2b.core;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

/**
 * Utilidades de tiempo para el sistema de simulación.
 */
public class TimeUtils {

    public static volatile LocalDateTime FECHA_INICIO_SIM = LocalDateTime.of(2027, 7, 24, 0, 0);
    public static volatile LocalDateTime FECHA_FIN_SIM = LocalDateTime.of(2027, 7, 26, 0, 0);

    public static final int MARGEN_POST_FIN_HORAS = 72;
    public static final int MARGEN_SLA_HORAS = 48;
    public static final int MARGEN_MULTITRAMO_DIAS = 8;

    private static volatile int capacidadMinutosAlmacen = -1;

    public static void setFechaInicioSim(LocalDateTime fecha) {
        FECHA_INICIO_SIM = fecha;
        capacidadMinutosAlmacen = -1;
    }

    public static void setFechaFinSim(LocalDateTime fecha) {
        FECHA_FIN_SIM = fecha;
        capacidadMinutosAlmacen = -1;
    }

    public static void configurarRangoSimulacion(LocalDateTime inicio, LocalDateTime fin) {
        setFechaInicioSim(inicio);
        setFechaFinSim(fin);
    }

    public static LocalDateTime getFechaInicioSim() {
        return FECHA_INICIO_SIM;
    }

    public static LocalDateTime getFechaFinSim() {
        return FECHA_FIN_SIM;
    }

    public static int getCapacidadMinutosAlmacen() {
        if (capacidadMinutosAlmacen < 0) {
            long minutosSim = Math.max(0, ChronoUnit.MINUTES.between(FECHA_INICIO_SIM, FECHA_FIN_SIM));
            long margenMin = (long) (MARGEN_POST_FIN_HORAS + MARGEN_SLA_HORAS) * 60L
                    + (long) MARGEN_MULTITRAMO_DIAS * 24L * 60L;
            capacidadMinutosAlmacen = (int) Math.min(minutosSim + margenMin, Integer.MAX_VALUE - 1L) + 1;
        }
        return capacidadMinutosAlmacen;
    }

    public static int[] nuevoArregloOcupacionAlmacen() {
        return new int[getCapacidadMinutosAlmacen()];
    }

    /**
     * Arreglo de solo lectura compartido (todos ceros) para aeropuertos sin ocupacion local/global.
     * Evita asignar ~26k enteros en cada evaluacion de A*.
     */
    public static int[] almacenSinUso() {
        int cap = getCapacidadMinutosAlmacen();
        int[] actual = almacenCero;
        if (actual != null && actual.length == cap) {
            return actual;
        }
        synchronized (TimeUtils.class) {
            if (almacenCero == null || almacenCero.length != cap) {
                almacenCero = new int[cap];
            }
            return almacenCero;
        }
    }

    private static volatile int[] almacenCero = null;

    public static int[] ajustarArregloOcupacion(int[] existente) {
        int cap = getCapacidadMinutosAlmacen();
        if (existente != null && existente.length == cap) {
            return existente;
        }
        int[] nuevo = new int[cap];
        if (existente != null && existente.length > 0) {
            System.arraycopy(existente, 0, nuevo, 0, Math.min(existente.length, cap));
        }
        return nuevo;
    }

    public static int getIndiceMinuto(LocalDateTime fecha) {
        return (int) ChronoUnit.MINUTES.between(FECHA_INICIO_SIM, fecha);
    }

    public static boolean intervaloAlmacenValido(int idxInicio, int idxFin) {
        if (idxFin <= idxInicio) return true;
        int cap = getCapacidadMinutosAlmacen();
        return idxInicio >= 0 && idxInicio < cap && idxFin <= cap;
    }

    public static int usoAlmacenEnMinuto(int[] arreglo, int minuto) {
        if (arreglo == null || minuto < 0 || minuto >= arreglo.length) return 0;
        return arreglo[minuto];
    }
}
