package com.tasf.b2b.repository;

import com.tasf.b2b.domain.AsignacionRealEntity;
import com.tasf.b2b.domain.AsignacionRealEntity.EstadoTramo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;
import java.util.List;

public interface AsignacionRealRepository extends JpaRepository<AsignacionRealEntity, Long> {

    List<AsignacionRealEntity> findByPedidoIdOrderByOrdenVueloAsc(String pedidoId);

    @Transactional
    @Modifying
    void deleteByPedidoId(String pedidoId);

    // Para actualizador de estados: tramos que deberían haber despegado
    @Query("SELECT a FROM AsignacionRealEntity a WHERE a.estado = 'PROGRAMADO' AND a.fechaSalida <= :ahora")
    List<AsignacionRealEntity> findTramosQueDeberianEstarEnVuelo(@Param("ahora") LocalDateTime ahora);

    // Para actualizador de estados: tramos que ya deberían haber aterrizado
    @Query("SELECT a FROM AsignacionRealEntity a WHERE a.estado = 'EN_VUELO' AND a.fechaLlegada <= :ahora")
    List<AsignacionRealEntity> findTramosQueDeberianHaberAterrizado(@Param("ahora") LocalDateTime ahora);

    // Para saber si todos los tramos de un pedido están en un estado que no es el indicado
    long countByPedidoIdAndEstadoNot(String pedidoId, EstadoTramo estado);

    // Para cancelación del día: tramos PROGRAMADO de un vuelo específico dentro de una ventana temporal
    List<AsignacionRealEntity> findByVueloIdAndEstadoAndFechaSalidaBetween(
            Long vueloId, EstadoTramo estado, LocalDateTime inicio, LocalDateTime fin);

    /**
     * Busca tramos por ruta (origen/destino) + estado + ventana temporal.
     * Alternativa robusta cuando vueloId puede ser 0 (bug de conversión de zona horaria).
     */
    List<AsignacionRealEntity> findByOrigenOaciAndDestinoOaciAndEstadoAndFechaSalidaBetween(
            String origenOaci, String destinoOaci, EstadoTramo estado,
            LocalDateTime inicio, LocalDateTime fin);

    // Tramos de una ruta por estado (para buscar dinámicamente la próxima salida)
    List<AsignacionRealEntity> findByOrigenOaciAndDestinoOaciAndEstado(
            String origenOaci, String destinoOaci, EstadoTramo estado);

    // Tramos PROGRAMADO de un pedido (para limpiar ruta parcial tras cancelación)
    List<AsignacionRealEntity> findByPedidoIdAndEstado(String pedidoId, EstadoTramo estado);
}
