package com.tasf.b2b.service;

import com.tasf.b2b.domain.PedidoRealEntity;
import com.tasf.b2b.domain.PedidoRealEntity.EstadoPedido;
import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.domain.AsignacionRealEntity.EstadoTramo;
import com.tasf.b2b.repository.PedidoRealRepository;
import com.tasf.b2b.repository.AsignacionRealRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Slf4j
public class TramoStatusUpdaterService {

    private final AsignacionRealRepository asignacionRepo;
    private final PedidoRealRepository pedidoRepo;
    private final RealTimeOperationsService rtService;

    @Scheduled(fixedDelay = 60_000)  // Cada minuto
    public void actualizarEstadosTramos() {
        LocalDateTime ahora = LocalDateTime.now();
        Set<String> pedidosAfectados = new HashSet<>();

        // Tramos PROGRAMADO que ya deberían estar volando
        List<AsignacionRealEntity> despegados = asignacionRepo.findTramosQueDeberianEstarEnVuelo(ahora);
        despegados.forEach(t -> {
            t.setEstado(EstadoTramo.EN_VUELO);
            pedidosAfectados.add(t.getPedidoId());
        });
        if (!despegados.isEmpty()) asignacionRepo.saveAll(despegados);

        // Tramos EN_VUELO que ya deberían haber aterrizado
        List<AsignacionRealEntity> aterrizados = asignacionRepo.findTramosQueDeberianHaberAterrizado(ahora);
        aterrizados.forEach(t -> {
            t.setEstado(EstadoTramo.COMPLETADO);
            pedidosAfectados.add(t.getPedidoId());
            actualizarEstadoPedidoSiCorresponde(t.getPedidoId(), t, ahora);
        });
        if (!aterrizados.isEmpty()) asignacionRepo.saveAll(aterrizados);

        // Actualizar caché solo si hubo cambios
        if (!pedidosAfectados.isEmpty()) {
            rtService.refrescarCachePedidos(new ArrayList<>(pedidosAfectados));
            log.info("[RT] {} pedidos actualizados por cambios de estado en tramos", pedidosAfectados.size());
        }
    }

    private void actualizarEstadoPedidoSiCorresponde(String pedidoId, AsignacionRealEntity tramoAterrizado, LocalDateTime ahora) {
        // Si todos los tramos están COMPLETADO → pedido ENTREGADO
        long tramosNoCompletados = asignacionRepo.countByPedidoIdAndEstadoNot(pedidoId, EstadoTramo.COMPLETADO);
        if (tramosNoCompletados == 0) {
            pedidoRepo.findById(pedidoId).ifPresent(p -> {
                p.setEstado(EstadoPedido.ENTREGADO);
                p.setFechaEntrega(ahora);
                p.setUbicacionActual(tramoAterrizado.getDestinoOaci());
                pedidoRepo.save(p);
            });
        } else {
            // Al menos un tramo completo o en vuelo → pedido EN_RUTA
            pedidoRepo.findById(pedidoId).ifPresent(p -> {
                p.setUbicacionActual("EN_VUELO: " + tramoAterrizado.getOrigenOaci() + " -> " + tramoAterrizado.getDestinoOaci());
                if (p.getEstado() == EstadoPedido.PLANIFICADO) {
                    p.setEstado(EstadoPedido.EN_RUTA);
                }
                pedidoRepo.save(p);
            });
        }
    }
}
