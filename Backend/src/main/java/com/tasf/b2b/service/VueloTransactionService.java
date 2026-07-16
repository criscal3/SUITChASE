package com.tasf.b2b.service;

import com.tasf.b2b.domain.VueloEntity;
import com.tasf.b2b.repository.AsignacionEnvioRepository;
import com.tasf.b2b.repository.AsignacionRealRepository;
import com.tasf.b2b.repository.CancelacionVueloRepository;
import com.tasf.b2b.repository.VueloRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Servicio auxiliar que encapsula las operaciones transaccionales de vuelos.
 * Al ser un bean separado, Spring intercepta @Transactional correctamente,
 * permitiendo que VueloController llame el refresco en memoria despues del commit.
 */
@Service
@RequiredArgsConstructor
public class VueloTransactionService {

    private final VueloRepository vueloRepository;
    private final AsignacionRealRepository asignacionRealRepository;
    private final AsignacionEnvioRepository asignacionEnvioRepository;
    private final CancelacionVueloRepository cancelacionVueloRepo;

    @Transactional
    public void borrarTodosLosVuelos() {
        asignacionEnvioRepository.deleteAllInBatch();
        asignacionRealRepository.deleteAllInBatch();
        cancelacionVueloRepo.deleteAllInBatch();
        vueloRepository.deleteAllInBatch();
    }

    @Transactional
    public int guardarVuelos(List<VueloEntity> vuelos) {
        if (!vuelos.isEmpty()) {
            vueloRepository.saveAll(vuelos);
        }
        return vuelos.size();
    }
}
