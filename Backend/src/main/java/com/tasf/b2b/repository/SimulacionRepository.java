package com.tasf.b2b.repository;

import com.tasf.b2b.domain.SimulacionEntity;
import com.tasf.b2b.domain.SimulacionEntity.EstadoSimulacion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface SimulacionRepository extends JpaRepository<SimulacionEntity, Long> {
    List<SimulacionEntity> findByEstadoOrderByCreatedAtDesc(EstadoSimulacion estado);
    List<SimulacionEntity> findByEstadoIn(java.util.Collection<EstadoSimulacion> estados);
    List<SimulacionEntity> findAllByOrderByCreatedAtDesc();
}
