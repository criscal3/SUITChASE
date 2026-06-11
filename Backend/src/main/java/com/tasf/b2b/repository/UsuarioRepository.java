package com.tasf.b2b.repository;

import com.tasf.b2b.domain.UsuarioEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UsuarioRepository extends JpaRepository<UsuarioEntity, Long> {
    Optional<UsuarioEntity> findByCorreo(String correo);
    List<UsuarioEntity> findByRol(UsuarioEntity.Rol rol);
    boolean existsByCorreo(String correo);
    Optional<UsuarioEntity> findByAerolineaId(Long aerolineaId);
}
