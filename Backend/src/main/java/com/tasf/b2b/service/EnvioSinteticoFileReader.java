package com.tasf.b2b.service;

import com.tasf.b2b.core.EnvioAlgoritmo;
import com.tasf.b2b.domain.AeropuertoEntity;
import com.tasf.b2b.repository.AeropuertoRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.*;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Lee envíos sintéticos directamente de los archivos .txt en disco.
 *
 * <p>A diferencia de la lectura bloque-a-bloque que re-escaneaba todos los archivos,
 * cada simulación carga una vez los envíos del rango [fechaInicio, fechaFin] (como
 * {@code LectorEnvios} en Planificador) y avanza un índice en memoria.</p>
 */
@Service
@Slf4j
public class EnvioSinteticoFileReader {

    @Autowired
    private AeropuertoRepository aeropuertoRepository;

    @Value("${suitchase.envios.path:Planificador/_envios_preliminar_}")
    private String enviosBasePath;

    private List<Path> archivosSinteticos = new ArrayList<>();
    private Map<String, Integer> gmtPorOaci = new HashMap<>();

    /** Estado de lectura por simulación (índice en lista ordenada). */
    private final Map<Long, EstadoLecturaSimulacion> estadoPorSimulacion = new ConcurrentHashMap<>();

    private static final class EstadoLecturaSimulacion {
        final List<EnvioAlgoritmo> enviosOrdenados;
        int indiceLectura;

        EstadoLecturaSimulacion(List<EnvioAlgoritmo> enviosOrdenados) {
            this.enviosOrdenados = enviosOrdenados;
            this.indiceLectura = 0;
        }
    }

    @PostConstruct
    public void init() {
        Path basePath = Paths.get(enviosBasePath);
        if (!Files.exists(basePath)) {
            basePath = Paths.get("..").resolve(enviosBasePath);
        }

        if (!Files.exists(basePath)) {
            log.warn("Directorio de envíos sintéticos no encontrado: {}. "
                    + "La simulación con datos de archivo no funcionará.", enviosBasePath);
            return;
        }

        try {
            archivosSinteticos = Files.list(basePath)
                    .filter(p -> p.getFileName().toString().startsWith("_envios_")
                            && p.getFileName().toString().endsWith(".txt"))
                    .sorted()
                    .collect(Collectors.toList());

            log.info("EnvioSinteticoFileReader inicializado con {} archivos en {}",
                    archivosSinteticos.size(), basePath.toAbsolutePath());
        } catch (IOException e) {
            log.error("Error listando archivos de envíos sintéticos: {}", e.getMessage());
        }

        recargarCacheGmt();
    }

    private void recargarCacheGmt() {
        gmtPorOaci = aeropuertoRepository.findAll().stream()
                .collect(Collectors.toMap(AeropuertoEntity::getOaci, AeropuertoEntity::getGmt, (a, b) -> a));
    }

    /**
     * Carga en memoria todos los envíos del rango de la simulación (una sola pasada por archivos).
     */
    public void iniciarLecturaSimulacion(Long simulacionId, LocalDateTime fechaInicio, LocalDateTime fechaFin) {
        recargarCacheGmt();
        long t0 = System.currentTimeMillis();
        List<EnvioAlgoritmo> cargados = cargarEnviosEnRango(fechaInicio, fechaFin);
        cargados.sort(Comparator.comparing(EnvioAlgoritmo::getFechaHoraRegistro));
        estadoPorSimulacion.put(simulacionId, new EstadoLecturaSimulacion(cargados));
        log.info("Simulación {} — índice de envíos: {} registros en rango [{}, {}) cargados en {}ms",
                simulacionId, cargados.size(), fechaInicio, fechaFin, System.currentTimeMillis() - t0);
        if (cargados.isEmpty()) {
            log.warn("Simulación {} — no hay envíos sintéticos en el rango seleccionado. "
                    + "Revise que fechaInicio/fechaFin coincidan con las fechas en los archivos .txt.", simulacionId);
        }
    }

    public void finalizarLecturaSimulacion(Long simulacionId) {
        estadoPorSimulacion.remove(simulacionId);
    }

    /**
     * Devuelve envíos con fecha en [inicio, fin) usando el índice en memoria.
     */
    public List<EnvioAlgoritmo> leerEnviosPorRango(Long simulacionId,
                                                   LocalDateTime inicio,
                                                   LocalDateTime fin) {
        EstadoLecturaSimulacion estado = estadoPorSimulacion.get(simulacionId);
        if (estado == null) {
            log.warn("Simulación {} sin índice de envíos; cargando rango bajo demanda", simulacionId);
            iniciarLecturaSimulacion(simulacionId, inicio, fin);
            estado = estadoPorSimulacion.get(simulacionId);
        }
        if (estado == null) {
            return List.of();
        }

        List<EnvioAlgoritmo> bloque = new ArrayList<>();
        while (estado.indiceLectura < estado.enviosOrdenados.size()) {
            EnvioAlgoritmo envio = estado.enviosOrdenados.get(estado.indiceLectura);
            LocalDateTime fecha = envio.getFechaHoraRegistro();

            if (fecha.isBefore(inicio)) {
                estado.indiceLectura++;
                continue;
            }
            if (!fecha.isBefore(fin)) {
                break;
            }
            bloque.add(envio);
            estado.indiceLectura++;
        }

        log.debug("Simulación {} — bloque [{}, {}): {} envíos", simulacionId, inicio, fin, bloque.size());
        return bloque;
    }

    /** Compatibilidad: sin simulacionId, escaneo directo (evitar en producción). */
    @Deprecated
    public List<EnvioAlgoritmo> leerEnviosPorRango(LocalDateTime inicio, LocalDateTime fin) {
        List<EnvioAlgoritmo> cargados = cargarEnviosEnRango(inicio, fin);
        return cargados.stream()
                .filter(e -> !e.getFechaHoraRegistro().isBefore(inicio)
                        && e.getFechaHoraRegistro().isBefore(fin))
                .collect(Collectors.toList());
    }

    private List<EnvioAlgoritmo> cargarEnviosEnRango(LocalDateTime fechaInicio, LocalDateTime fechaFin) {
        List<EnvioAlgoritmo> resultado = new ArrayList<>();

        for (Path archivo : archivosSinteticos) {
            String origenOaci = extraerOrigenDeArchivo(archivo.getFileName().toString());
            if (origenOaci == null) continue;

            int gmtOrigen = gmtPorOaci.getOrDefault(origenOaci, 0);

            try (BufferedReader reader = Files.newBufferedReader(archivo)) {
                String linea;
                while ((linea = reader.readLine()) != null) {
                    linea = linea.trim();
                    if (linea.isEmpty()) continue;

                    EnvioAlgoritmo envio = parsearLinea(linea, origenOaci, gmtOrigen);
                    if (envio == null) continue;

                    LocalDateTime fecha = envio.getFechaHoraRegistro();

                    if (fechaInicio != null && fecha.isBefore(fechaInicio)) {
                        continue;
                    }
                    if (fechaFin != null && !fecha.isBefore(fechaFin)) {
                        break;
                    }
                    resultado.add(envio);
                }
            } catch (IOException e) {
                log.error("Error leyendo archivo {}: {}", archivo.getFileName(), e.getMessage());
            }
        }
        return resultado;
    }

    private String extraerOrigenDeArchivo(String fileName) {
        if (fileName.startsWith("_envios_") && fileName.endsWith("_.txt")) {
            return fileName.substring(8, fileName.length() - 5);
        }
        return null;
    }

    private EnvioAlgoritmo parsearLinea(String linea, String origenOaci, int gmtOrigen) {
        try {
            String[] partes = linea.split("-");
            if (partes.length < 7) return null;

            String idEnvio = partes[0];
            String fechaStr = partes[1];
            int hora = Integer.parseInt(partes[2]);
            int minuto = Integer.parseInt(partes[3]);
            String destinoOaci = partes[4];
            int cantidad = Integer.parseInt(partes[5]);
            String clienteId = partes[6];

            int anio = Integer.parseInt(fechaStr.substring(0, 4));
            int mes = Integer.parseInt(fechaStr.substring(4, 6));
            int dia = Integer.parseInt(fechaStr.substring(6, 8));

            LocalDateTime fechaHora = LocalDateTime.of(anio, mes, dia, hora, minuto);
            LocalDateTime fechaGmt0 = fechaHora.minusHours(gmtOrigen);

            EnvioAlgoritmo envio = new EnvioAlgoritmo();
            envio.setId(origenOaci + "-" + idEnvio);
            envio.setOrigenOaci(origenOaci);
            envio.setDestinoOaci(destinoOaci);
            envio.setFechaHoraRegistro(fechaGmt0);
            envio.setCantidadMaletas(cantidad);
            envio.setClienteId(clienteId);
            return envio;
        } catch (Exception e) {
            log.trace("Error parseando línea '{}': {}", linea, e.getMessage());
            return null;
        }
    }

    public boolean tieneArchivos() {
        return !archivosSinteticos.isEmpty();
    }

    public int cantidadArchivos() {
        return archivosSinteticos.size();
    }
}
