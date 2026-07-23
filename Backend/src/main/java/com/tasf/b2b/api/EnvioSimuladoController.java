package com.tasf.b2b.api;

import com.tasf.b2b.service.EnvioSinteticoFileReader;
import com.tasf.b2b.service.SimulationService;
import lombok.extern.slf4j.Slf4j;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/envios-simulados")
@RequiredArgsConstructor
@Slf4j
@PreAuthorize("hasRole('ADMIN')")
public class EnvioSimuladoController {

    private final EnvioSinteticoFileReader envioFileReader;
    private final SimulationService simulationService;

    @GetMapping("/actual")
    public ResponseEntity<?> getCarpetaActual() {
        try {
            Map<String, Object> response = new HashMap<>();
            response.put("carpetaActual", envioFileReader.getNombreCarpetaActual());
            response.put("cantidadArchivos", envioFileReader.cantidadArchivos());
            response.put("totalEnvios", envioFileReader.contarTotalEnvios());
            response.put("simulacionesActivas", simulationService.contarSimulacionesActivas());
            response.put("carpetasDisponibles", envioFileReader.listarCarpetasDisponibles());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error obteniendo carpeta actual de envíos simulados", e);
            return ResponseEntity.internalServerError().body(Map.of("mensaje", "Error obteniendo datos de carpeta: " + e.getMessage()));
        }
    }

    @PostMapping(value = "/cargar-carpeta-multipart", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> cargarCarpetaMultipart(
            @RequestParam("nombreCarpeta") String nombreCarpeta,
            @RequestParam(value = "archivos", required = false) MultipartFile[] archivos) {

        if (nombreCarpeta == null || nombreCarpeta.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "Nombre de carpeta inválido"));
        }

        int simCanceladas = simulationService.cancelarTodasSimulacionesActivas();

        try {
            envioFileReader.cargarNuevaCarpetaMultipart(nombreCarpeta, archivos);

            Map<String, Object> response = new HashMap<>();
            response.put("mensaje", "Carpeta cargada exitosamente");
            response.put("carpetaActual", envioFileReader.getNombreCarpetaActual());
            response.put("cantidadArchivos", envioFileReader.cantidadArchivos());
            response.put("totalEnvios", envioFileReader.contarTotalEnvios());
            response.put("simulacionesCanceladas", simCanceladas);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("mensaje", "Error procesando carpeta multipart: " + e.getMessage()));
        }
    }

    @PostMapping("/iniciar-carga")
    public ResponseEntity<?> iniciarCarga(@RequestBody Map<String, String> body) {
        String nombreCarpeta = body.get("nombreCarpeta");
        if (nombreCarpeta == null || nombreCarpeta.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "Nombre de carpeta inválido"));
        }
        int simCanceladas = simulationService.cancelarTodasSimulacionesActivas();
        try {
            envioFileReader.prepararCarpetaParaCarga(nombreCarpeta);
            return ResponseEntity.ok(Map.of("mensaje", "Carga iniciada", "simulacionesCanceladas", simCanceladas));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("mensaje", "Error preparando carpeta: " + e.getMessage()));
        }
    }

    @PostMapping(value = "/cargar-archivo-individual", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> cargarArchivoIndividual(
            @RequestParam("nombreCarpeta") String nombreCarpeta,
            @RequestParam("archivo") MultipartFile archivo) {
        try {
            envioFileReader.guardarArchivoIndividual(nombreCarpeta, archivo);
            return ResponseEntity.ok(Map.of("mensaje", "Archivo guardado exitosamente"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("mensaje", "Error guardando archivo: " + e.getMessage()));
        }
    }

    @PostMapping("/finalizar-carga")
    public ResponseEntity<?> finalizarCarga(@RequestBody Map<String, String> body) {
        String nombreCarpeta = body.get("nombreCarpeta");
        if (nombreCarpeta == null || nombreCarpeta.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "Nombre de carpeta inválido"));
        }
        boolean exito = envioFileReader.seleccionarCarpetaExistente(nombreCarpeta);
        if (!exito) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "Error activando la carpeta"));
        }
        Map<String, Object> response = new HashMap<>();
        response.put("mensaje", "Carpeta cargada y activada exitosamente");
        response.put("carpetaActual", envioFileReader.getNombreCarpetaActual());
        response.put("cantidadArchivos", envioFileReader.cantidadArchivos());
        response.put("totalEnvios", envioFileReader.contarTotalEnvios());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/seleccionar-carpeta")
    public ResponseEntity<?> seleccionarCarpeta(@RequestBody Map<String, String> body) {
        String nombreCarpeta = body.get("nombreCarpeta");
        if (nombreCarpeta == null || nombreCarpeta.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "Nombre de carpeta no provisto"));
        }

        int simCanceladas = simulationService.cancelarTodasSimulacionesActivas();
        boolean exito = envioFileReader.seleccionarCarpetaExistente(nombreCarpeta);

        if (!exito) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "No se encontró la carpeta: " + nombreCarpeta));
        }

        Map<String, Object> response = new HashMap<>();
        response.put("mensaje", "Carpeta activada exitosamente");
        response.put("carpetaActual", envioFileReader.getNombreCarpetaActual());
        response.put("cantidadArchivos", envioFileReader.cantidadArchivos());
        response.put("totalEnvios", envioFileReader.contarTotalEnvios());
        response.put("simulacionesCanceladas", simCanceladas);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/cargar-carpeta")
    public ResponseEntity<?> cargarCarpetaJson(@RequestBody CargarCarpetaRequest request) {
        if (request.getNombreCarpeta() == null || request.getNombreCarpeta().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "Nombre de carpeta inválido"));
        }

        int simCanceladas = simulationService.cancelarTodasSimulacionesActivas();

        Map<String, String> archivosMap = new HashMap<>();
        if (request.getArchivos() != null) {
            for (ArchivoItem item : request.getArchivos()) {
                if (item.getNombre() != null && item.getContenido() != null) {
                    archivosMap.put(item.getNombre(), item.getContenido());
                }
            }
        }

        try {
            envioFileReader.cargarNuevaCarpeta(request.getNombreCarpeta(), archivosMap);

            Map<String, Object> response = new HashMap<>();
            response.put("mensaje", "Carpeta cargada exitosamente");
            response.put("carpetaActual", envioFileReader.getNombreCarpetaActual());
            response.put("cantidadArchivos", envioFileReader.cantidadArchivos());
            response.put("totalEnvios", envioFileReader.contarTotalEnvios());
            response.put("simulacionesCanceladas", simCanceladas);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("mensaje", "Error procesando carpeta: " + e.getMessage()));
        }
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<?> handleMaxUploadSizeExceeded(org.springframework.web.multipart.MaxUploadSizeExceededException e) {
        log.warn("El tamaño de la carga de envíos simulados excedió el límite configurado: {}", e.getMessage());
        return ResponseEntity.badRequest().body(Map.of(
                "mensaje", "El tamaño total de la carpeta de envíos supera el límite máximo permitido (1000MB)."
        ));
    }

    @Data
    public static class CargarCarpetaRequest {
        private String nombreCarpeta;
        private List<ArchivoItem> archivos;
    }

    @Data
    public static class ArchivoItem {
        private String nombre;
        private String contenido;
    }
}
