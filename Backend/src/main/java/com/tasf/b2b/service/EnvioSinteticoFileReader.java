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
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Lee envíos sintéticos directamente de los archivos .txt en disco.
 * 
 * Formato por línea: id_envío-aaaammdd-hh-mm-dest-###-IdCliente
 * Ejemplo: 000000001-20260102-00-47-SUAA-002-0032535
 * 
 * El aeropuerto ORIGEN se determina por el nombre del archivo:
 *   _envios_EBCI_.txt → origen = EBCI
 */
@Service
@Slf4j
public class EnvioSinteticoFileReader {

    @Autowired
    private AeropuertoRepository aeropuertoRepository;

    @Value("${suitchase.envios.path:Planificador/_envios_preliminar_}")
    private String enviosBasePath;

    private List<Path> archivosSinteticos = new ArrayList<>();

    @PostConstruct
    public void init() {
        // Resolver ruta relativa al directorio de trabajo (raíz del proyecto)
        Path basePath = Paths.get(enviosBasePath);
        
        // Si la ruta no existe, intentar buscarla un nivel arriba (Backend -> raíz)
        if (!Files.exists(basePath)) {
            basePath = Paths.get("..").resolve(enviosBasePath);
        }
        
        if (!Files.exists(basePath)) {
            log.warn("Directorio de envíos sintéticos no encontrado: {}. " +
                     "La simulación con datos de archivo no funcionará.", enviosBasePath);
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
    }

    /**
     * Lee envíos de TODOS los archivos que caigan en el rango temporal [inicio, fin).
     * Retorna objetos EnvioAlgoritmo listos para el algoritmo ACS.
     */
    public List<EnvioAlgoritmo> leerEnviosPorRango(LocalDateTime inicio, LocalDateTime fin) {
        List<EnvioAlgoritmo> resultado = new ArrayList<>();

        for (Path archivo : archivosSinteticos) {
            String origenOaci = extraerOrigenDeArchivo(archivo.getFileName().toString());
            if (origenOaci == null) continue;

            try (BufferedReader reader = Files.newBufferedReader(archivo)) {
                String linea;
                while ((linea = reader.readLine()) != null) {
                    linea = linea.trim();
                    if (linea.isEmpty()) continue;

                    EnvioAlgoritmo envio = parsearLinea(linea, origenOaci);
                    if (envio == null) continue;

                    LocalDateTime fecha = envio.getFechaHoraRegistro();
                    
                    // Si ya pasamos del fin, no necesitamos seguir leyendo
                    // (los archivos están ordenados cronológicamente)
                    if (fecha.isAfter(fin) || fecha.isEqual(fin)) {
                        break;
                    }
                    
                    // Si está dentro del rango, incluirlo
                    if (!fecha.isBefore(inicio)) {
                        resultado.add(envio);
                    }
                }
            } catch (IOException e) {
                log.error("Error leyendo archivo {}: {}", archivo.getFileName(), e.getMessage());
            }
        }

        log.debug("Leídos {} envíos sintéticos en rango [{}, {})", resultado.size(), inicio, fin);
        return resultado;
    }

    /**
     * Extrae el código OACI del nombre del archivo.
     * Ejemplo: "_envios_EBCI_.txt" → "EBCI"
     */
    private String extraerOrigenDeArchivo(String fileName) {
        // Formato: _envios_XXXX_.txt
        if (fileName.startsWith("_envios_") && fileName.endsWith("_.txt")) {
            return fileName.substring(8, fileName.length() - 5);
        }
        return null;
    }

    /**
     * Parsea una línea del archivo en un EnvioAlgoritmo.
     * Formato: id_envío-aaaammdd-hh-mm-dest-###-IdCliente
     * Ejemplo: 000000001-20260102-00-47-SUAA-002-0032535
     */
    private EnvioAlgoritmo parsearLinea(String linea, String origenOaci) {
        try {
            String[] partes = linea.split("-");
            if (partes.length < 7) return null;

            String idEnvio = partes[0];                    // 000000001
            String fechaStr = partes[1];                   // 20260102
            String horaStr = partes[2];                    // 00
            String minutoStr = partes[3];                  // 47
            String destinoOaci = partes[4];                // SUAA
            String cantidadStr = partes[5];                // 002
            String clienteId = partes[6];                  // 0032535

            int anio = Integer.parseInt(fechaStr.substring(0, 4));
            int mes = Integer.parseInt(fechaStr.substring(4, 6));
            int dia = Integer.parseInt(fechaStr.substring(6, 8));
            int hora = Integer.parseInt(horaStr);
            int minuto = Integer.parseInt(minutoStr);
            int cantidad = Integer.parseInt(cantidadStr);

            LocalDateTime fechaHora = LocalDateTime.of(anio, mes, dia, hora, minuto);

            int gmtOrigen = aeropuertoRepository.findById(origenOaci)
                    .map(AeropuertoEntity::getGmt).orElse(0);
            LocalDateTime fechaGmt0 = fechaHora.minusHours(gmtOrigen);

            EnvioAlgoritmo envio = new EnvioAlgoritmo();
            // ID único: origen-idEnvio para evitar colisiones entre archivos
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

    /**
     * Verifica si hay archivos sintéticos disponibles.
     */
    public boolean tieneArchivos() {
        return !archivosSinteticos.isEmpty();
    }

    /**
     * Retorna la cantidad de archivos sintéticos encontrados.
     */
    public int cantidadArchivos() {
        return archivosSinteticos.size();
    }
}
