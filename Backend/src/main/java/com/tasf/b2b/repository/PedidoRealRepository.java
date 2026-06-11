package com.tasf.b2b.repository;

import com.tasf.b2b.domain.PedidoRealEntity;
import com.tasf.b2b.domain.PedidoRealEntity.EstadoPedido;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.util.List;

public interface PedidoRealRepository extends JpaRepository<PedidoRealEntity, String> {

    // Scheduler: pedidos pendientes para planificar
    List<PedidoRealEntity> findByEstadoAndFechaHoraRegistroBeforeOrderByFechaHoraRegistroAsc(
            EstadoPedido estado, LocalDateTime antes);

    // Aerolínea: sus pedidos activos (PENDIENTE + PLANIFICADO + EN_RUTA)
    List<PedidoRealEntity> findByAerolineaIdAndEstadoInOrderByFechaHoraRegistroDesc(
            Long aerolineaId, List<EstadoPedido> estados);

    // Carga inicial del caché (todos los activos)
    List<PedidoRealEntity> findByEstadoInOrderByFechaHoraRegistroDesc(List<EstadoPedido> estados);

    // Para histórico futuro
    List<PedidoRealEntity> findByAerolineaIdOrderByFechaHoraRegistroDesc(Long aerolineaId);
}
