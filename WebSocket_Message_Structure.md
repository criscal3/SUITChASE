# WebSocket Message Structure - Block Reception

## Overview
When the backend completes planning for a simulation block (6-hour window), it sends a WebSocket message to the frontend with detailed metrics, shipment routes, warehouse occupancy, and flight capacities.

---

## 1. WebSocket Message Handler in useSimulation.ts
**File:** [Frontend/src/app/engine/useSimulation.ts](Frontend/src/app/engine/useSimulation.ts#L414-L484)

### Message Reception Flow:
```typescript
ws.onMessage((msg) => {
  if (!msg) return;

  // Handle simulation cancellation
  if (msg.estado === "CANCELADA") {
    // Stop running simulation
    runningRef.current = false;
    setState(prev => ({
      ...prev,
      running: false,
      stopped: false,
      hasStarted: true,
      waitingForFirstBlock: false,
    }));
    return;
  }

  // Handle cancelled flights
  if (msg.tipo === "VUELO_CANCELADO") {
    const afectadosIds: string[] = msg.afectadosIds || [];
    const flightKey = msg.claveVuelo || ""; // claveVuelo format: origen-destino-fechaSalida
    setState(prev => {
      const newCancelledFlights = new Set(prev.cancelledFlights);
      if (flightKey) {
        newCancelledFlights.add(flightKey);
      }
      const newGroups = prev.baggageGroups.map(bg => {
        if (afectadosIds.includes(bg.id)) {
          return { ...bg, status: "waiting" as const, route: [] };
        }
        return bg;
      });
      return { ...prev, baggageGroups: newGroups, cancelledFlights: newCancelledFlights };
    });
    return;
  }

  // Backend finished planning; clock continues until end of sim window
  if (msg.estado === "FINALIZADA") {
    return;
  }

  // Queue block until clock reaches next 6-hour boundary (Sc)
  blockQueueRef.current.push(msg);
  console.log(`Block ${msg.bloqueActual} queued. Queue size: ${blockQueueRef.current.length}`);
  if (runningRef.current && !waitingForFirstBlockRef.current) {
    tryConsumeBlocksAtSimTimeRef.current(currentTimeRef.current);
  }
});
```

---

## 2. Complete WebSocket Message Structure from Backend
**File:** [Backend/src/main/java/com/tasf/b2b/service/SimulationService.java](Backend/src/main/java/com/tasf/b2b/service/SimulationService.java#L620-L660)

### Message Creation:
```java
Map<String, Object> wsMessage = new LinkedHashMap<>();
wsMessage.put("simulacionId", simulacionId);
wsMessage.put("bloqueActual", bloqueActual);                    // Block number (e.g., 1, 2, 3...)
wsMessage.put("totalBloques", simActual.getTotalBloquesEstimados());
wsMessage.put("cursor", cursor.toString());                     // LocalDateTime string: "2026-01-01T03:34:00"
wsMessage.put("estado", simActual.getEstado().name());         // "PLANIFICANDO", "FINALIZADA", "CANCELADA"
wsMessage.put("k", k);                                          // Speed constant
wsMessage.put("inicioVentana", bloqueRes.getInicioVentana().toString());

// ===== METRICS OBJECT =====
Map<String, Object> metricas = new LinkedHashMap<>();
metricas.put("totalEnvios", bloqueRes.getTotalEnvios());        // Total shipments in this block
metricas.put("enviosConRuta", bloqueRes.getEnviosConRuta());    // Shipments WITH routes assigned
metricas.put("enviosSinRuta", bloqueRes.getEnviosSinRuta());    // Shipments WITHOUT routes
metricas.put("sla", bloqueRes.getPromedioSla());                // SLA compliance ratio (0.0 to infinity)
metricas.put("ocupacionVuelos", bloqueRes.getOcupacionVuelos());      // Flight occupancy ratio
metricas.put("ocupacionAlmacenes", bloqueRes.getOcupacionAlmacenes()); // Warehouse occupancy ratio
metricas.put("duracionMs", bloqueRes.getDuracionMs());          // Algorithm execution time in ms
wsMessage.put("metricas", metricas);

// ===== ROUTES SUMMARY (if not empty block) =====
if (bloqueVacio) {
    wsMessage.put("bloqueVacio", true);
    wsMessage.put("rutasResumen", List.of());
} else {
    wsMessage.put("rutasResumen", rutasResumen);    // See structure below
    wsMessage.put("bloqueId", bloqueRes.getId());
    if (solucion != null) {
        // Warehouse occupancy per airport over time
        wsMessage.put("estadoOcupacionAlmacenes", solucion.getEstadoOcupacionAlmacenes());
        // Flight capacities/occupancy per flight
        wsMessage.put("estadoCapacidadesVuelos", solucion.getEstadoCapacidadesVuelos());
    }
}

messagingTemplate.convertAndSend("/topic/simulacion/" + simulacionId, wsMessage);
```

---

## 3. Metrics Fields Explained

### 3.1 Shipping Counts
- **`totalEnvios`** (int): Total number of shipments received in this 6-hour block
- **`enviosConRuta`** (int): Count of shipments that HAVE a planned route (successfully assigned)
- **`enviosSinRuta`** (int): Count of shipments that DO NOT have a route (could not be assigned)
  - Calculation: `enviosSinRuta = totalEnvios - enviosConRuta`

### 3.2 Service Level Agreement (SLA)
- **`sla`** (double): SLA compliance metric
  - **Formula:** Average of `(arrivalTime - registrationTime) / SLAWindow` for all shipments
  - **SLA Window:** 
    - 24 hours (1440 minutes) for same-continent shipments
    - 48 hours (2880 minutes) for inter-continental shipments
  - **Interpretation:**
    - `< 1.0` → All shipments delivered on time (good zone)
    - `= 1.0` → Shipments arrived exactly at SLA limit
    - `> 1.0` → Some shipments exceeded SLA (overdue)

### 3.3 Occupancy Metrics
- **`ocupacionVuelos`** (double): Flight capacity utilization ratio (0.0 to 1.0)
  - Represents how full the flights are on average
  - Converted to percentage in frontend: `flightUtilization = ocupacionVuelos * 100`

- **`ocupacionAlmacenes`** (double): Warehouse occupancy ratio (0.0 to 1.0)
  - Average warehouse utilization across all airports
  - Converted to percentage in frontend: `warehouseUtilization = ocupacionAlmacenes * 100`

### 3.4 Processing
- **`duracionMs`** (long): Time taken by the algorithm to compute this block (milliseconds)

---

## 4. Route Summary (rutasResumen) Structure
**File:** [Backend/src/main/java/com/tasf/b2b/service/SimulationService.java](Backend/src/main/java/com/tasf/b2b/service/SimulationService.java#L690-L750)

Each shipment in `rutasResumen` array has this structure:

```java
{
  "envioId": "ENV-12345",                    // Unique shipment ID
  "origen": "GRU",                           // Origin airport OACI code
  "destino": "EZE",                          // Destination airport OACI code
  "maletas": 50,                             // Number of bags/items
  "fechaHoraRegistro": "2026-01-01T18:00:00", // When shipment was registered
  "estado": "CON_RUTA" or "SIN_RUTA",       // Route assignment status
  "numTramos": 2,                            // Number of flight legs
  
  // Only if "estado" === "CON_RUTA":
  "tramos": [
    {
      "origen": "GRU",
      "destino": "SCL",
      "salida": "2026-01-01T20:00:00",       // Departure timestamp (LocalDateTime)
      "llegada": "2026-01-02T01:00:00",      // Arrival timestamp (LocalDateTime)
      "claveVuelo": "GRU-SCL-20:00-2026-01-01", // Flight key with date
      "capacidad": 200                        // Aircraft capacity
    },
    {
      "origen": "SCL",
      "destino": "EZE",
      "salida": "2026-01-02T03:00:00",
      "llegada": "2026-01-02T08:00:00",
      "claveVuelo": "SCL-EZE-18:30-2026-01-02",
      "capacidad": 150
    }
  ],
  
  // Legacy fields (for backward compatibility):
  "primerTramo": "GRU→SCL",
  "ultimoTramo": "SCL→EZE",
  "salidaPrimer": "2026-01-01T20:00:00",
  "llegadaFinal": "2026-01-02T08:00:00"
}
```

### Key Points:
- **`tramos`** (new field): Complete list of flight legs with exact departure/arrival times
- Each tramo represents one flight segment
- **`claveVuelo`** format: `{ORIGIN}-{DESTINATION}-{DEPARTURE_TIME}-{DATE}`
- Timestamps are LocalDateTime strings (no timezone offset) - same as simulation local time
- **`capacidad`**: The aircraft's total capacity for that flight

---

## 5. Warehouse Occupancy State (estadoOcupacionAlmacenes)
**File:** [Frontend/src/app/engine/backendAdapter.ts](Frontend/src/app/engine/backendAdapter.ts#L1-L10)

```typescript
export type OcupacionAlmacenesPorAeropuerto = Record<string, number[]>;

// Example structure from backend:
{
  "GRU": [0, 5, 12, 28, 35, 42, 50, ...],    // Occupancy per minute for airport GRU
  "EZE": [0, 2, 8, 15, 22, 30, ...],         // Occupancy per minute for airport EZE
  "SCL": [1, 3, 10, 18, 25, 31, ...]         // Occupancy per minute for airport SCL
}
```

- Each key is an airport code
- Value is an array of occupancy levels per minute
- Indexed by minute number from simulation start
- Frontend queries: `minuteIndex = Math.floor((currentTime - startTime) / 60000)`

---

## 6. Flight Capacities State (estadoCapacidadesVuelos)
```typescript
export type CapacidadesVuelosPorClave = Record<string, number>;

// Example structure:
{
  "GRU-SCL-20:00-2026-01-01": 150,      // 150 bags on this flight
  "SCL-EZE-18:30-2026-01-02": 200,
  "GRU-EZE-10:00-2026-01-01": 75,
  ...
}
```

- Key is the `claveVuelo` from each tramo
- Value is the current occupancy/capacity being used

---

## 7. How Frontend Processes Block Messages
**File:** [Frontend/src/app/engine/useSimulation.ts](Frontend/src/app/engine/useSimulation.ts#L296-L380)

### applyBlock() Function - Called when clock reaches Sc boundary:

```typescript
const applyBlock = useCallback((msg: any) => {
  setState(prev => {
    let cursorTime = targetTimeRef.current;
    
    // Parse cursor (block timestamp)
    if (msg.cursor) {
      try {
        const parts = String(msg.cursor).split(/[^0-9]/);
        if (parts.length >= 5) {
          const year  = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const day   = parseInt(parts[2], 10);
          const hour  = parseInt(parts[3], 10);
          const min   = parseInt(parts[4], 10);
          const sec   = parts[5] ? parseInt(parts[5], 10) : 0;
          const parsed = Date.UTC(year, month, day, hour, min, sec);
          if (!isNaN(parsed)) cursorTime = parsed;
        }
      } catch (e) {
        console.error("Error parsing cursor:", e);
      }
    }
    targetTimeRef.current = Math.max(targetTimeRef.current, cursorTime);

    // ===== CONVERT ROUTES TO BAGGAGE GROUPS =====
    if (msg.rutasResumen?.length && msg.metricas) {
      blockGroups = mapBlockResultToBaggageGroups(
        msg.rutasResumen,
        cursorTime,
        prev.baggageGroups,
        airportsListRef.current
      );
      // Merge with existing baggage groups (avoid overwriting in-flight items)
      // ...
    }

    // ===== UPDATE OCCUPANCY =====
    if (msg.estadoOcupacionAlmacenes) {
      occupancyByAirportRef.current = mergeOccupancyState(
        occupancyByAirportRef.current,
        msg.estadoOcupacionAlmacenes as OcupacionAlmacenesPorAeropuerto
      );
    }

    // ===== UPDATE FLIGHT CAPACITIES =====
    if (msg.estadoCapacidadesVuelos) {
      flightOccupancyRef.current = mergeFlightOccupancyState(
        flightOccupancyRef.current,
        msg.estadoCapacidadesVuelos as CapacidadesVuelosPorClave
      );
    }

    // ===== UPDATE STATS FROM METRICS =====
    if (msg.metricas) {
      newStats = updateStatsFromMetrics(msg.metricas, prev.stats, newAirports);
    }

    return {
      ...prev,
      baggageGroups: newGroups,
      stats: newStats,
      airports: newAirports,
      flightOccupancy: { ...flightOccupancyRef.current },
      flightCapacities: { ...flightCapacitiesRef.current, ...flightTemplateCapacitiesRef.current },
      cancelledFlights: prev.cancelledFlights,
    };
  });
}, []);
```

---

## 8. Stats Update from Metrics
**File:** [Frontend/src/app/engine/backendAdapter.ts](Frontend/src/app/engine/backendAdapter.ts#L246-L268)

```typescript
export function updateStatsFromMetrics(
  metricas: any,
  currentStats: SimStats,
  airports?: Record<string, AirportState>
): SimStats {
  const warehouseFromAirports =
    airports != null ? computeWarehouseUtilization(airports) : undefined;

  return {
    ...currentStats,
    // Accumulate shipment counts from each block
    totalRegistered: currentStats.totalRegistered + metricas.totalEnvios,
    totalDelivered: currentStats.totalDelivered + metricas.enviosConRuta,
    totalFailed: currentStats.totalFailed + metricas.enviosSinRuta,
    
    // SLA is a ratio, updated from each block
    onTimeRate: metricas.sla ?? currentStats.onTimeRate,
    
    // Warehouse utilization can come from airports or metrics
    warehouseUtilization:
      warehouseFromAirports ??
      (metricas.ocupacionAlmacenes != null
        ? metricas.ocupacionAlmacenes * 100
        : currentStats.warehouseUtilization),
    
    // Flight utilization
    flightUtilization:
      metricas.ocupacionVuelos != null
        ? metricas.ocupacionVuelos * 100
        : currentStats.flightUtilization,
  };
}
```

---

## 9. Important Timing Notes

### Block Queue Mechanism
- Blocks are queued as they arrive from WebSocket
- They are **consumed** (applied) when the simulation clock reaches the next Sc boundary
- **Sc** (consumption window) = 240 minutes = 4 hours of simulation time
- Block N is consumed at: `startTime + N × Sc`

### Clock Speed
- Simulation runs at **120x real-time** by default
- 240 minutes of simulation = 120 seconds of real time
- This is controlled by the `SIM_MS_PER_REAL_MS = 120` constant

### Cursor Field
- Each block includes a `cursor` timestamp indicating the backend's current simulation time
- This marks when the block was planned (not when it's applied)
- Format: ISO-like string `"2026-01-01T03:34:00"` (LocalDateTime, no timezone)

---

## 10. Key Fields Summary Table

| Field | Type | Source | Example | Notes |
|-------|------|--------|---------|-------|
| `simulacionId` | Long | Backend | 1 | Simulation instance ID |
| `bloqueActual` | Integer | Backend | 3 | Current block number |
| `totalBloques` | Integer | Backend | 42 | Estimated total blocks |
| `cursor` | String | Backend | "2026-01-01T03:34:00" | Block planning timestamp |
| `estado` | String | Backend | "PLANIFICANDO" | Simulation state |
| `metricas.totalEnvios` | Integer | Block | 1250 | Total shipments in block |
| `metricas.enviosConRuta` | Integer | Block | 1180 | Shipments with routes |
| `metricas.enviosSinRuta` | Integer | Block | 70 | Shipments without routes |
| `metricas.sla` | Double | Block | 0.85 | SLA compliance ratio |
| `metricas.ocupacionVuelos` | Double | Block | 0.72 | Flight occupancy (0-1) |
| `metricas.ocupacionAlmacenes` | Double | Block | 0.45 | Warehouse occupancy (0-1) |
| `metricas.duracionMs` | Long | Block | 2340 | Algorithm runtime |
| `rutasResumen[].envioId` | String | Block | "ENV-12345" | Shipment ID |
| `rutasResumen[].maletas` | Integer | Block | 50 | Baggage count |
| `rutasResumen[].estado` | String | Block | "CON_RUTA" | "CON_RUTA" or "SIN_RUTA" |
| `rutasResumen[].tramos[]` | Array | Block | [...] | Flight legs with times |
| `estadoOcupacionAlmacenes` | Map | Block | {GRU: [...]} | Per-minute warehouse use |
| `estadoCapacidadesVuelos` | Map | Block | {GRU-SCL...: 150} | Flight occupancy by claveVuelo |

---

## Notes on Missing Fields

### "Envios a tiempo" (On-time Shipments)
- Not explicitly sent as a separate count
- Derived from `sla` metric which is a weighted ratio
- No direct "count of on-time deliveries" field in current implementation
- Could be calculated as: `totalDelivered × (1 / sla)` if sla < 1.0, but this is approximate

### Total Baggage Quantity
- **Not sent as a single aggregate field** in metrics
- Must be summed manually from `rutasResumen[].maletas` across all shipments
- Or can be tracked per airport via `estadoOcupacionAlmacenes` which shows stock per minute

---

## Code References
- **Frontend WebSocket Handler:** [useSimulation.ts L414-484](Frontend/src/app/engine/useSimulation.ts#L414-L484)
- **Frontend Block Application:** [useSimulation.ts L296-380](Frontend/src/app/engine/useSimulation.ts#L296-L380)
- **Frontend Metrics Processing:** [backendAdapter.ts L246-268](Frontend/src/app/engine/backendAdapter.ts#L246-L268)
- **Backend Message Creation:** [SimulationService.java L620-660](Backend/src/main/java/com/tasf/b2b/service/SimulationService.java#L620-L660)
- **Backend Routes Summary:** [SimulationService.java L690-750](Backend/src/main/java/com/tasf/b2b/service/SimulationService.java#L690-L750)
