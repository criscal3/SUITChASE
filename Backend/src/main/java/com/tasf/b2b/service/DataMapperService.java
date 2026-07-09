package com.tasf.b2b.service;

import com.tasf.b2b.core.AeropuertoAlgoritmo;
import com.tasf.b2b.core.EnvioAlgoritmo;
import com.tasf.b2b.core.VueloAlgoritmo;
import com.tasf.b2b.domain.AeropuertoEntity;
import com.tasf.b2b.domain.EnvioEntity;
import com.tasf.b2b.domain.VueloEntity;
import com.tasf.b2b.repository.AeropuertoRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class DataMapperService {

    @Autowired
    private AeropuertoRepository aeropuertoRepository;

    public AeropuertoAlgoritmo toAeropuertoAlgoritmo(AeropuertoEntity entity) {
        AeropuertoAlgoritmo aero = new AeropuertoAlgoritmo();
        // El algoritmo original usaba OACI como primary key lógicamente, 'id' numérico no era vital
        aero.setOaci(entity.getOaci());
        aero.setCiudad(entity.getCiudad());
        aero.setPais(entity.getPais());
        aero.setContinente(entity.getContinente());
        aero.setGmt(entity.getGmt());
        aero.setCapacidadAlmacen(entity.getCapacidadAlmacen());
        aero.setLatitud(entity.getLatitud());
        aero.setLongitud(entity.getLongitud());
        return aero;
    }

    public VueloAlgoritmo toVueloAlgoritmo(VueloEntity entity) {
        VueloAlgoritmo vuelo = new VueloAlgoritmo();
        vuelo.setOrigenOaci(entity.getOrigenOaci());
        vuelo.setDestinoOaci(entity.getDestinoOaci());

        int gmtOrigen = aeropuertoRepository.findById(entity.getOrigenOaci())
                .map(AeropuertoEntity::getGmt).orElse(0);
        int gmtDestino = aeropuertoRepository.findById(entity.getDestinoOaci())
                .map(AeropuertoEntity::getGmt).orElse(0);

        vuelo.setHoraSalida(entity.getHoraSalida().minusHours(gmtOrigen));
        vuelo.setHoraLlegada(entity.getHoraLlegada().minusHours(gmtDestino));
        vuelo.setCapacidad(entity.getCapacidad());
        return vuelo;
    }

    public EnvioAlgoritmo toEnvioAlgoritmo(EnvioEntity entity) {
        EnvioAlgoritmo envio = new EnvioAlgoritmo();
        envio.setId(entity.getId());
        envio.setOrigenOaci(entity.getOrigenOaci());
        envio.setDestinoOaci(entity.getDestinoOaci());

        // fechaHoraRegistro ya está en UTC (guardado con LocalDateTime.now() en servidor UTC).
        // NO aplicar offset de GMT del origen: los vuelos sí están en hora local y necesitan
        // conversión a UTC, pero el registro ya es UTC.
        envio.setFechaHoraRegistro(entity.getFechaHoraRegistro());

        envio.setCantidadMaletas(entity.getCantidadMaletas());
        envio.setClienteId(entity.getAerolineaId() != null ? String.valueOf(entity.getAerolineaId()) : "UNK");
        return envio;
    }

    public EnvioAlgoritmo toEnvioAlgoritmo(com.tasf.b2b.domain.PedidoRealEntity entity) {
        EnvioAlgoritmo envio = new EnvioAlgoritmo();
        envio.setId(entity.getId());
        
        String ubicacion = entity.getUbicacionActual();
        if (ubicacion != null && ubicacion.startsWith("EN_VUELO:")) {
            String[] parts = ubicacion.split("->");
            if (parts.length > 1) {
                ubicacion = parts[1].trim();
            }
        }
        envio.setOrigenOaci(ubicacion != null && !ubicacion.isBlank() ? ubicacion : entity.getOrigenOaci());
        envio.setDestinoOaci(entity.getDestinoOaci());

        // fechaHoraRegistro ya está en UTC (guardado con LocalDateTime.now() en servidor UTC).
        // NO aplicar offset de GMT del origen: los vuelos sí están en hora local y necesitan
        // conversión a UTC, pero el registro ya es UTC.
        envio.setFechaHoraRegistro(entity.getFechaHoraRegistro());

        envio.setCantidadMaletas(entity.getCantidadMaletas());
        envio.setClienteId(entity.getAerolineaId() != null ? String.valueOf(entity.getAerolineaId()) : "UNK");
        return envio;
    }
}
