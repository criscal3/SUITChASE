package com.tasf.b2b.repository;

import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.domain.AsignacionRealEntity.EstadoTramo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.util.List;

public interface AsignacionRealRepository extends JpaRepository<AsignacionRealEntity, Long> {

    List<AsignacionRealEntity> findByPedidoIdOrderByOrdenVueloAsc(String pedidoId);

    // Para actualizador de estados: tramos que deberían haber despegado
    @Query("SELECT a FROM AsignacionRealEntity a WHERE a.estado = 'PROGRAMADO' AND a.fechaSalida <= :ahora")
    List<AsignacionRealEntity> findTramosQueDeberianEstarEnVuelo(@Param("ahora") LocalDateTime ahora);

    // Para actualizador de estados: tramos que ya deberían haber aterrizado
    @Query("SELECT a FROM AsignacionRealEntity a WHERE a.estado = 'EN_VUELO' AND a.fechaLlegada <= :ahora")
    List<AsignacionRealEntity> findTramosQueDeberianHaberAterrizado(@Param("ahora") LocalDateTime ahora);

    // Para saber si todos los tramos de un pedido están en un estado que no es el indicado
    long countByPedidoIdAndEstadoNot(String pedidoId, EstadoTramo estado);
}
