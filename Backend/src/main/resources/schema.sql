-- =====================================================
-- SUITChASE — Modelo Relacional Completo
-- MySQL 8.x / UTF8MB4
-- =====================================================

CREATE DATABASE IF NOT EXISTS suitchase
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE suitchase;

-- =====================================================
-- 1. AEROLÍNEA
-- =====================================================
CREATE TABLE IF NOT EXISTS aerolinea (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    codigo      VARCHAR(10)  NOT NULL UNIQUE   -- Ej: LAN, AVA, IB
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 2. USUARIO (Login + Roles)
-- =====================================================
CREATE TABLE IF NOT EXISTS usuario (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    correo           VARCHAR(100) NOT NULL UNIQUE,
    password_hash    VARCHAR(255) NOT NULL,
    nombre_completo  VARCHAR(150) NOT NULL,
    dni              VARCHAR(20)  NULL,
    telefono         VARCHAR(25)  NULL,
    genero           VARCHAR(20)  NULL,
    fecha_nacimiento DATE         NULL,
    aeropuerto_oaci  VARCHAR(4)   NULL,
    rol              ENUM('ADMIN', 'OPERARIO', 'AEROLINEA') NOT NULL,
    aerolinea_id     BIGINT       NULL,      -- Solo si rol = AEROLINEA
    activo           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuario_aerolinea
        FOREIGN KEY (aerolinea_id) REFERENCES aerolinea(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 3. AEROPUERTO
-- =====================================================
CREATE TABLE IF NOT EXISTS aeropuerto (
    oaci               VARCHAR(4)   PRIMARY KEY,
    ciudad             VARCHAR(100) NOT NULL,
    pais               VARCHAR(100) NOT NULL,
    continente         VARCHAR(50)  NOT NULL,
    gmt                INT          NOT NULL,
    capacidad_almacen  INT          NOT NULL,
    latitud            DOUBLE       NOT NULL,
    longitud           DOUBLE       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 4. VUELO (Planes de vuelo — cíclicos, se repiten diario)
-- =====================================================
CREATE TABLE IF NOT EXISTS vuelo (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    origen_oaci   VARCHAR(4) NOT NULL,
    destino_oaci  VARCHAR(4) NOT NULL,
    hora_salida   TIME       NOT NULL,
    hora_llegada  TIME       NOT NULL,
    capacidad     INT        NOT NULL,

    CONSTRAINT fk_vuelo_origen
        FOREIGN KEY (origen_oaci) REFERENCES aeropuerto(oaci),
    CONSTRAINT fk_vuelo_destino
        FOREIGN KEY (destino_oaci) REFERENCES aeropuerto(oaci),

    INDEX idx_vuelo_origen (origen_oaci)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 5. SIMULACIÓN
-- =====================================================
CREATE TABLE IF NOT EXISTS simulacion (
    id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre                   VARCHAR(200) NOT NULL,
    estado                   ENUM('PENDIENTE', 'EJECUTANDO', 'PAUSADA', 'FINALIZADA', 'CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
    fecha_inicio_sim         DATETIME     NOT NULL,
    fecha_fin_sim            DATETIME     NOT NULL,
    salto_algoritmo_sa       INT          NOT NULL,  -- minutos
    constante_k              INT          NOT NULL,
    tiempo_algoritmo_ta      INT          NOT NULL,  -- segundos
    skip_sleep_until_block   INT          NOT NULL DEFAULT 0,
    bloque_actual            INT          NOT NULL DEFAULT 0,
    total_bloques_estimados  INT          NOT NULL DEFAULT 0,
    cursor_temporal          DATETIME     NULL,       -- Hasta dónde se procesó
    creado_por               BIGINT       NOT NULL,
    created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_simulacion_creador
        FOREIGN KEY (creado_por) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 6. ENVÍO
-- =====================================================
CREATE TABLE IF NOT EXISTS envio (
    id                   VARCHAR(50)  PRIMARY KEY,
    origen_oaci          VARCHAR(4)   NOT NULL,
    destino_oaci         VARCHAR(4)   NOT NULL,
    fecha_hora_registro  DATETIME     NOT NULL,
    cantidad_maletas     INT          NOT NULL,
    aerolinea_id         BIGINT       NOT NULL,    -- Quién solicita
    operario_id          BIGINT       NULL,         -- NULL si es sintético
    es_sintetico         BOOLEAN      NOT NULL DEFAULT FALSE,
    estado               ENUM('PENDIENTE', 'EN_RUTA', 'ENTREGADO', 'COLAPSO', 'SIN_RUTA') NOT NULL DEFAULT 'PENDIENTE',
    simulacion_id        BIGINT       NULL,         -- NULL = tiempo real

    CONSTRAINT fk_envio_origen
        FOREIGN KEY (origen_oaci) REFERENCES aeropuerto(oaci),
    CONSTRAINT fk_envio_destino
        FOREIGN KEY (destino_oaci) REFERENCES aeropuerto(oaci),
    CONSTRAINT fk_envio_aerolinea
        FOREIGN KEY (aerolinea_id) REFERENCES aerolinea(id),
    CONSTRAINT fk_envio_operario
        FOREIGN KEY (operario_id) REFERENCES usuario(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_envio_simulacion
        FOREIGN KEY (simulacion_id) REFERENCES simulacion(id)
        ON DELETE CASCADE,

    -- Índices para queries eficientes por bloque
    INDEX idx_envio_simulacion_fecha (simulacion_id, fecha_hora_registro),
    INDEX idx_envio_aerolinea_estado (aerolinea_id, estado),
    INDEX idx_envio_estado_fecha (estado, fecha_hora_registro)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 7. BLOQUE RESULTADO
-- =====================================================
CREATE TABLE IF NOT EXISTS bloque_resultado (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    simulacion_id        BIGINT   NOT NULL,
    numero_bloque        INT      NOT NULL,
    inicio_ventana       DATETIME NOT NULL,
    fin_ventana          DATETIME NOT NULL,
    total_envios         INT      NOT NULL DEFAULT 0,
    envios_con_ruta      INT      NOT NULL DEFAULT 0,
    envios_sin_ruta      INT      NOT NULL DEFAULT 0,
    promedio_sla         DOUBLE   NOT NULL DEFAULT 0.0,
    ocupacion_vuelos     DOUBLE   NOT NULL DEFAULT 0.0,
    ocupacion_almacenes  DOUBLE   NOT NULL DEFAULT 0.0,
    duracion_ms          BIGINT   NOT NULL DEFAULT 0,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_bloque_simulacion
        FOREIGN KEY (simulacion_id) REFERENCES simulacion(id)
        ON DELETE CASCADE,

    INDEX idx_bloque_simulacion (simulacion_id, numero_bloque)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 8. ASIGNACIÓN ENVÍO (Tramos de ruta asignados)
-- =====================================================
CREATE TABLE IF NOT EXISTS asignacion_envio (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    bloque_resultado_id   BIGINT      NULL,       -- NULL si es tiempo real
    envio_id              VARCHAR(50) NOT NULL,
    orden_vuelo           INT         NOT NULL,    -- 1, 2, 3... (secuencia de tramos)
    vuelo_id              BIGINT      NOT NULL,
    fecha_salida          DATETIME    NOT NULL,
    fecha_llegada         DATETIME    NOT NULL,
    estado                ENUM('A_TIEMPO', 'COLAPSO', 'SIN_RUTA') NOT NULL DEFAULT 'A_TIEMPO',

    CONSTRAINT fk_asignacion_bloque
        FOREIGN KEY (bloque_resultado_id) REFERENCES bloque_resultado(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_asignacion_envio
        FOREIGN KEY (envio_id) REFERENCES envio(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_asignacion_vuelo
        FOREIGN KEY (vuelo_id) REFERENCES vuelo(id),

    INDEX idx_asignacion_envio (envio_id),
    INDEX idx_asignacion_bloque (bloque_resultado_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
