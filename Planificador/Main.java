import java.time.LocalDateTime;

/**
 * Punto de entrada unificado para TASF.B2B.
 *
 * Permite ejecutar el Algoritmo Genético (AG) o el Ant Colony System (ACS)
 * sobre la misma simulación, con los mismos parámetros y el mismo formato
 * de reporte.
 *
 * ── Parámetros configurables ──────────────────────────────────────────────
 *  ALGORITMO_ACTIVO  : Simulador.Algoritmo.AG  o  Simulador.Algoritmo.ACS
 *  SALTO_ALGORITMO   : Sa – minutos simulados entre ejecuciones
 *  K                 : Constante de proporcionalidad
 *  TIEMPO_ALGORITMO  : Ta – tiempo máximo por bloque en SEGUNDOS
 *  fechaInicioSim    : LocalDateTime de inicio (null = desde el primer envío)
 *  fechaFinSim       : LocalDateTime de fin    (null = hasta agotar envíos)
 * ─────────────────────────────────────────────────────────────────────────
 */
public class Main {

    // =========================================================
    //  PARÁMETROS DE SIMULACIÓN (modificar aquí)
    // =========================================================

    /** Algoritmo a ejecutar: AG o ACS */
    private static final Simulador.Algoritmo ALGORITMO_ACTIVO = Simulador.Algoritmo.ACS;

    /** Sa: cada cuántos minutos simulados se planifica */
    private static final int SALTO_ALGORITMO_SA = 2;

    /** k: Sc = k * Sa (ventana de consumo de datos) */
    private static final int K = 120;

    /** Ta: tiempo máximo del algoritmo por bloque, en SEGUNDOS */
    private static final int TIEMPO_ALGORITMO_TA = 10;

    // ── Rango temporal de la simulación ──────────────────────
    // Usar LocalDateTime.of(año, mes, día, hora, minuto) o null
    public static final LocalDateTime FECHA_INICIO_SIM =
            LocalDateTime.of(2027, 7, 24, 0, 0);

    public static final LocalDateTime FECHA_FIN_SIM =
            LocalDateTime.of(2027, 7, 26, 0, 0);

    // ── Rutas de archivos ─────────────────────────────────────
    private static final String RUTA_AEROPUERTOS =
            "c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt";

    private static final String RUTA_VUELOS = "planes_vuelo.txt";

    private static final String CARPETA_ENVIOS = "_envios_preliminar_";

    public static int getIndiceMinuto(LocalDateTime fecha) {
        int indice = (int) java.time.temporal.ChronoUnit.MINUTES.between(FECHA_INICIO_SIM, fecha);
        if (indice < 0) return 0;
        return indice;
    }

    // =========================================================
    //  MAIN
    // =========================================================

    public static void main(String[] args) {

        // Permitir sobreescribir el algoritmo por argumento de línea de comandos
        // Uso: java Main AG   ó   java Main ACS
        Simulador.Algoritmo algoritmo = ALGORITMO_ACTIVO;
        if (args.length > 0) {
            try {
                algoritmo = Simulador.Algoritmo.valueOf(args[0].toUpperCase());
                System.out.println("[Main] Algoritmo sobreescrito por argumento: " + algoritmo);
            } catch (IllegalArgumentException e) {
                System.out.println("[Main] Argumento inválido '" + args[0]
                        + "'. Usando algoritmo por defecto: " + algoritmo);
            }
        }

        String archivoReporte = "reporte_" + algoritmo.name().toLowerCase() + ".txt";

        System.out.println("╔══════════════════════════════════════════════════════╗");
        System.out.println("║          TASF.B2B - Simulador de Planificación       ║");
        System.out.println("╚══════════════════════════════════════════════════════╝");
        System.out.println("  Algoritmo : " + algoritmo);
        System.out.printf( "  Sa=%dmin | k=%d | Sc=%dmin | Ta=%ds%n",
                SALTO_ALGORITMO_SA, K, K * SALTO_ALGORITMO_SA, TIEMPO_ALGORITMO_TA);
        if (FECHA_INICIO_SIM != null)
            System.out.println("  Inicio    : " + FECHA_INICIO_SIM);
        if (FECHA_FIN_SIM != null)
            System.out.println("  Fin       : " + FECHA_FIN_SIM);
        System.out.println("  Reporte   : " + archivoReporte);
        System.out.println();

        Simulador simulador = new Simulador(
                SALTO_ALGORITMO_SA,
                K,
                TIEMPO_ALGORITMO_TA,
                FECHA_INICIO_SIM,
                FECHA_FIN_SIM,
                algoritmo
        );

        simulador.ejecutar(
                RUTA_AEROPUERTOS,
                RUTA_VUELOS,
                CARPETA_ENVIOS,
                archivoReporte
        );
    }
}
