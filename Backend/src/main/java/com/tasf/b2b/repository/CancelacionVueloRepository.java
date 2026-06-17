package com.tasf.b2b.repository;

import com.tasf.b2b.domain.CancelacionVueloEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface CancelacionVueloRepository extends JpaRepository<CancelacionVueloEntity, Long> {
    List<CancelacionVueloEntity> findByFechaSalidaAfter(LocalDateTime fecha);
}
