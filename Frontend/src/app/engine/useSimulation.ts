import { useState, useRef, useCallback, useEffect } from "react";
import { createEmptyStats } from "./simulation";
import { AIRPORTS as DEFAULT_AIRPORTS, type Airport } from "../data/airports";
import type { SimulationState, SimEvent, Airline } from "./types";
import { SIM_BASE_DATE, SIM_WEEKLY_DURATION_MS } from "./types";
import { toast } from "sonner";
import { api } from "../services/api";
import { SimulationWebSocketClient } from "../services/websocket";
import {
  mapBlockResultToBaggageGroups,
  updateStatsFromMetrics,
  minuteIndexFromSimStart,
  mapOccupancyToAirports,
  mergeOccupancyState,
  mergeFlightOccupancyState,
  mergeFlightCapacityState,
  extractCapacitiesFromRoutes,
  computeWarehouseUtilization,
  type OcupacionAlmacenesPorAeropuerto,
  type CapacidadesVuelosPorClave,
} from "./backendAdapter";

const DEFAULT_AIRLINES: Airline[] = [
  { id: "AL-001", name: "AeroLatam", code: "ALT", email: "contacto@aerolatam.com", password: "aerolatam123", assignedAirports: ["GRU", "EZE", "BOG", "LIM", "SCL"] },
];

const SA_MINUTES = 2;        // Sa: salto del algoritmo en minutos
const K_DEFAULT = 120;       // K: constante de velocidad
const TA_SECONDS = 10;       // Ta: tiempo del algoritmo en segundos (máx. espera inicial: 50 s)
const SC_MINUTES = K_DEFAULT * SA_MINUTES; // Sc: ventana de consumo = 240 min = 4h
const SA_SECONDS = SA_MINUTES * 60;        // Sa en segundos = 120s = 2 min
export const INITIAL_WAIT_SECONDS = 60;    // Espera inicial real antes de iniciar el cronómetro
const SC_MS = SC_MINUTES * 60 * 1000;      // Sc = 4 h de simulación entre actualizaciones de maletas
// Clock speed: Sc minutos de simulación en Sa segundos reales
// = 240 min sim / 120 s real = 2 min sim / 1 s real = 120 s sim / 1 s real
const SIM_MS_PER_REAL_MS = (SC_MINUTES * 60 * 1000) / (SA_SECONDS * 1000); // = 120
/** Intervalo mínimo entre commits de React del cronómetro (evita saturar la UI). */
const CLOCK_UI_COMMIT_MS = 50;

// ─── Constantes para simulación en tiempo real ───
const RT_SA_MINUTES = 2;         // Sa para tiempo real
const RT_K = 180;                // K para tiempo real (Sc = 360 min = 6h)
const RT_TA_SECONDS = 10;        // Ta para tiempo real
const RT_SC_MINUTES = RT_K * RT_SA_MINUTES; // 360 min = 6h
const RT_SC_MS = RT_SC_MINUTES * 60 * 1000;
const RT_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h hacia atrás
const RT_LOOKAHEAD_MS = 6 * 60 * 60 * 1000; // 6h hacia adelante
/** Velocidad de fast-forward en modo realtime: 1h sim por 1s real = 3600x */
const RT_FAST_FORWARD_SPEED = 3600;
/** Margen antes del borde de datos para solicitar extensión (1h) */
const RT_EXTENSION_MARGIN_MS = 1 * 60 * 60 * 1000;

export function useSimulation() {
  const [state, setState] = useState<SimulationState>(() => {
    return {
      scenario: "weekly",
      turnaroundHours: 1,
      currentTime: 0,
      startTime: 0,
      day: 1,
      hour: 0,
      airports: {},
      flights: [],
      flightOccupancy: {},
      flightCapacities: {},
      baggageGroups: [],
      stats: createEmptyStats(),
      collapsed: false,
      collapseReason: "",
      running: false,
      stopped: false,
      hasStarted: false,
      waitingForFirstBlock: false,
      speed: K_DEFAULT,
    };
  });

  const [events, setEvents] = useState<SimEvent[]>([]);
  const [speed, setSpeed] = useState(K_DEFAULT);
  const [airportsList, setAirportsList] = useState<Airport[]>(DEFAULT_AIRPORTS);
  const [airlines, setAirlines] = useState<Airline[]>(DEFAULT_AIRLINES);
  // Countdown seconds remaining for the initial wait (INITIAL_WAIT_SECONDS)
  const [waitCountdown, setWaitCountdown] = useState(0);
  // Queue of received blocks waiting to be displayed
  const blockQueueRef = useRef<any[]>([]);
  // Track how many blocks have been consumed (applied) so far
  const blocksConsumedRef = useRef<number>(0);

  const wsClientRef = useRef<SimulationWebSocketClient | null>(null);
  const activeSimIdRef = useRef<number | null>(null);
  const prevCollapsed = useRef(false);
  const [pendingStartDate, setPendingStartDate] = useState<Date | undefined>(undefined);
  const airportsListRef = useRef<Airport[]>(airportsList);
  const occupancyByAirportRef = useRef<OcupacionAlmacenesPorAeropuerto>({});
  const flightOccupancyRef = useRef<CapacidadesVuelosPorClave>({});
  const flightCapacitiesRef = useRef<CapacidadesVuelosPorClave>({});
  const flightTemplateCapacitiesRef = useRef<CapacidadesVuelosPorClave>({});

  // ─── Refs para modo realtime ───
  const scenarioRef = useRef<string>(state.scenario);
  const realtimeAnchorRef = useRef<number>(0);   // hora real cuando se hizo click
  const realtimeEndRef = useRef<number>(0);       // fin de la ventana de datos actual
  const realtimeExtendingRef = useRef<boolean>(false); // evita extensiones duplicadas

  useEffect(() => {
    airportsListRef.current = airportsList;
  }, [airportsList]);

  const fetchAirports = useCallback(async () => {
    try {
      const data = await api.getAirports();
      if (data && data.length > 0) {
        const mapped = data.map((a: any) => ({
          code: a.oaci,
          city: a.ciudad,
          country: a.pais,
          continent: a.continente === "Europe" ? "Europa" : (a.continente || "America"),
          timezone: a.gmt >= 0 ? `UTC+${a.gmt}` : `UTC${a.gmt}`,
          lat: a.latitud,
          lng: a.longitud,
          warehouseCapacity: a.capacidadAlmacen,
          currentStock: a.stockActual || 0
        }));
        setAirportsList(mapped);
      }
    } catch (err) {
      console.error("Error fetching simulation airports:", err);
    }
  }, []);

  useEffect(() => {
    fetchAirports();
    fetchFlightCapacities();
  }, [fetchAirports]);

  const fetchFlightCapacities = useCallback(async () => {
    try {
      const data = await api.getFlights();
      if (!data?.length) return;
      const templateIndex: CapacidadesVuelosPorClave = {};
      for (const f of data) {
        const origen = String(f.origenOaci || f.origin || "").toUpperCase();
        const destino = String(f.destinoOaci || f.destination || "").toUpperCase();
        const capacidad = Number(f.capacidad ?? f.capacity ?? 0);
        if (!origen || !destino || !capacidad) continue;

        const airport = airportsListRef.current.find(a => a.code === origen);
        const gmtMatch = airport?.timezone?.match(/UTC([+-]?\d+)/);
        const gmt = gmtMatch ? parseInt(gmtMatch[1], 10) : 0;

        const horaRaw = String(f.horaSalida || f.departureTime || "");
        const timeParts = horaRaw.split(":");
        if (timeParts.length < 2) continue;
        let hours = parseInt(timeParts[0], 10) - gmt;
        const minutes = parseInt(timeParts[1], 10);
        const seconds = timeParts[2] ? parseInt(timeParts[2], 10) : 0;
        while (hours < 0) hours += 24;
        hours %= 24;
        const horaSalida = seconds
          ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
          : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

        templateIndex[`${origen}-${destino}-${horaSalida}`] = capacidad;
      }
      flightTemplateCapacitiesRef.current = templateIndex;
    } catch (err) {
      console.error("Error fetching flight capacities:", err);
    }
  }, []);

  const targetTimeRef = useRef<number>(state.currentTime);
  const currentTimeRef = useRef<number>(state.currentTime);
  const runningRef = useRef(false);
  const waitingForFirstBlockRef = useRef(false);
  const lastMinuteIdxRef = useRef(-1);
  // Track the real-time timestamp when the simulation clock started (after initial wait)
  const clockStartRealTimeRef = useRef<number>(0);
  // Track the sim-time when the clock started
  const clockStartSimTimeRef = useRef<number>(0);
  // Track startTime for block boundary calculations in the clock tick
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    runningRef.current = state.running;
  }, [state.running]);

  useEffect(() => {
    scenarioRef.current = state.scenario;
  }, [state.scenario]);

  useEffect(() => {
    waitingForFirstBlockRef.current = !!state.waitingForFirstBlock;
  }, [state.waitingForFirstBlock]);

  useEffect(() => {
    currentTimeRef.current = state.currentTime;
    targetTimeRef.current = state.currentTime;
  }, [state.currentTime]);

  // ─── Countdown timer for the initial wait before the chronometer starts ───
  useEffect(() => {
    if (!state.waitingForFirstBlock) return;

    const waitSec = state.scenario === "realtime" ? 30 : 60;
    setWaitCountdown(waitSec);
    const countdownStart = Date.now();

    const countdownId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - countdownStart) / 1000);
      const remaining = waitSec - elapsed;

      if (remaining <= 0) {
        clearInterval(countdownId);
        setWaitCountdown(0);
        // Transition: stop waiting, start running the chronometer
        setState(prev => {
          clockStartRealTimeRef.current = Date.now();
          clockStartSimTimeRef.current = prev.currentTime;
          startTimeRef.current = prev.startTime;
          blocksConsumedRef.current = 0;
          return {
            ...prev,
            waitingForFirstBlock: false,
            running: true,
          };
        });
        // Solo arranca el cronómetro; maletas/rastreo se actualizan cada Sc (6 h sim)
      } else {
        setWaitCountdown(remaining);
      }
    }, 1000);

    return () => clearInterval(countdownId);
  }, [state.waitingForFirstBlock, state.scenario]);

  // ─── Block consumption is driven by the clock ticker below ───

  // ─── Apply a block's data to the simulation state ───
  const applyBlock = useCallback((msg: any) => {
    setState(prev => {
      let cursorTime = targetTimeRef.current;
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

      let newGroups = prev.baggageGroups;
      let newStats  = prev.stats;
      let newAirports = { ...prev.airports };
      let blockGroups: ReturnType<typeof mapBlockResultToBaggageGroups> = [];

      if (msg.rutasResumen?.length && msg.metricas) {
        blockGroups = mapBlockResultToBaggageGroups(
          msg.rutasResumen,
          cursorTime,
          prev.baggageGroups,
          airportsListRef.current
        );

        const mergedMap = new Map<string | number, any>();
        for (const bg of prev.baggageGroups) {
          mergedMap.set(bg.id, bg);
        }
        const smoothTime = prev.currentTime;
        for (const bg of blockGroups) {
          const existing = mergedMap.get(bg.id);
          if (existing) {
            const isFlying = existing.route?.some(
              (leg: any) => smoothTime >= leg.departureTime && smoothTime < leg.arrivalTime
            );
            if (isFlying) continue;
          }
          mergedMap.set(bg.id, bg);
        }
        newGroups = Array.from(mergedMap.values());
      }

      if (msg.estadoOcupacionAlmacenes) {
        occupancyByAirportRef.current = mergeOccupancyState(
          occupancyByAirportRef.current,
          msg.estadoOcupacionAlmacenes as OcupacionAlmacenesPorAeropuerto
        );
      }

      if (msg.estadoCapacidadesVuelos) {
        flightOccupancyRef.current = mergeFlightOccupancyState(
          flightOccupancyRef.current,
          msg.estadoCapacidadesVuelos as CapacidadesVuelosPorClave
        );
      }

      if (msg.rutasResumen?.length) {
        flightCapacitiesRef.current = mergeFlightCapacityState(
          flightCapacitiesRef.current,
          extractCapacitiesFromRoutes(blockGroups)
        );
      }

      const minuteIdx = minuteIndexFromSimStart(prev.startTime, prev.currentTime);
      newAirports = mapOccupancyToAirports(
        occupancyByAirportRef.current,
        newAirports,
        minuteIdx
      );
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
      };
    });
  }, []);

  const applyBlockRef = useRef(applyBlock);
  applyBlockRef.current = applyBlock;

  /**
   * Aplica el siguiente bloque cuando el reloj sim alcanza start + n×Sc (n = bloques ya mostrados).
   * Ej.: inicio 01/01 18:00 → bloque 1; 02/01 00:00 → bloque 2; 06:00 → bloque 3; …
   */
  const tryConsumeBlocksAtSimTime = useCallback((simTimeMs: number) => {
    const blockSize = scenarioRef.current === "realtime" ? RT_SC_MS : SC_MS;
    while (blockQueueRef.current.length > 0) {
      const nextBoundary =
        startTimeRef.current + blocksConsumedRef.current * blockSize;
      if (simTimeMs < nextBoundary) break;
      const nextBlock = blockQueueRef.current.shift();
      if (!nextBlock) break;
      blocksConsumedRef.current += 1;
      queueMicrotask(() => applyBlockRef.current(nextBlock));
    }
  }, []);

  const tryConsumeBlocksAtSimTimeRef = useRef(tryConsumeBlocksAtSimTime);
  tryConsumeBlocksAtSimTimeRef.current = tryConsumeBlocksAtSimTime;

  // ─── Cronómetro: avance por tiempo real (rAF), independiente de la carga de la UI ───
  useEffect(() => {
    if (!state.running) return;

    let lastReal = performance.now();
    let lastUiCommit = lastReal;
    let rafId = 0;

    const commitClock = (nextTime: number, prev: SimulationState) => {
      const isRealtime = prev.scenario === "realtime";
      const maxTime = isRealtime
        ? Infinity  // realtime no tiene fin fijo
        : prev.startTime + SIM_WEEKLY_DURATION_MS;
      const reachedEnd =
        !isRealtime && prev.scenario === "weekly" && nextTime >= maxTime;
      const clampedTime = reachedEnd ? maxTime : nextTime;

      currentTimeRef.current = clampedTime;
      targetTimeRef.current = Math.max(targetTimeRef.current, clampedTime);

      const diffHours = (clampedTime - prev.startTime) / 3600000;
      const minuteIdx = minuteIndexFromSimStart(prev.startTime, clampedTime);

      let airports = prev.airports;
      let stats = prev.stats;
      if (minuteIdx !== lastMinuteIdxRef.current) {
        lastMinuteIdxRef.current = minuteIdx;
        airports = mapOccupancyToAirports(
          occupancyByAirportRef.current,
          prev.airports,
          minuteIdx
        );
        stats = {
          ...prev.stats,
          warehouseUtilization:
            Object.keys(occupancyByAirportRef.current).length > 0
              ? computeWarehouseUtilization(airports)
              : prev.stats.warehouseUtilization,
        };
      }

      // Detectar transición de fast-forward a 1:1 en modo realtime
      let realtimeUpdates: Partial<SimulationState> = {};
      if (isRealtime) {
        const anchorMs = realtimeAnchorRef.current;
        const wasFastForwarding = prev.realtimeFastForwarding;
        const nowReachedRealtime = clampedTime >= anchorMs;
        if (wasFastForwarding && nowReachedRealtime) {
          // Clamp to the real-time anchor so we don't overshoot
          currentTimeRef.current = anchorMs;
          realtimeUpdates = { realtimeFastForwarding: false };
        }
      }

      return {
        ...prev,
        currentTime: isRealtime && !prev.realtimeFastForwarding
          ? clampedTime  // will be synced to real time in tick
          : clampedTime,
        day: Math.floor(diffHours / 24) + 1,
        hour: diffHours % 24,
        airports,
        stats,
        ...realtimeUpdates,
        ...(reachedEnd
          ? { running: false, stopped: true, hasStarted: true }
          : {}),
      };
    };

    const tick = (now: number) => {
      if (!runningRef.current) return;

      const realDelta = now - lastReal;
      lastReal = now;

      if (realDelta > 0) {
        const isRealtime = scenarioRef.current === "realtime";

        if (isRealtime) {
          const anchorMs = realtimeAnchorRef.current;
          const isFastForwarding = currentTimeRef.current < anchorMs;

          if (isFastForwarding) {
            // Fast-forward: 3600x speed (1h sim / 1s real)
            const simDelta = realDelta * RT_FAST_FORWARD_SPEED;
            currentTimeRef.current += simDelta;
            // Don't overshoot past real time anchor
            if (currentTimeRef.current >= anchorMs) {
              currentTimeRef.current = anchorMs;
            }
          } else {
            // 1:1 speed: sync to real wall clock
            // anchorMs was the real time when click happened.
            // The elapsed real ms since then = Date.now() - anchorMs
            // So simTime = anchorMs + (Date.now() - anchorMs) = Date.now()
            currentTimeRef.current = Date.now();
          }

          // Auto-extension: when approaching the data edge, request more
          const endMs = realtimeEndRef.current;
          if (
            endMs > 0 &&
            currentTimeRef.current >= endMs - RT_EXTENSION_MARGIN_MS &&
            !realtimeExtendingRef.current
          ) {
            realtimeExtendingRef.current = true;
            void extendRealtimeWindowRef.current();
          }
        } else {
          // Normal simulation speed (weekly/collapse)
          const simDelta = realDelta * SIM_MS_PER_REAL_MS;
          currentTimeRef.current += simDelta;
        }

        tryConsumeBlocksAtSimTimeRef.current(currentTimeRef.current);

        if (now - lastUiCommit >= CLOCK_UI_COMMIT_MS) {
          lastUiCommit = now;
          setState(prev => {
            if (!prev.running) return prev;
            return commitClock(currentTimeRef.current, prev);
          });
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    lastMinuteIdxRef.current = minuteIndexFromSimStart(
      startTimeRef.current,
      currentTimeRef.current
    );
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      const pending = currentTimeRef.current;
      tryConsumeBlocksAtSimTimeRef.current(pending);
      setState(prev => {
        if (pending === prev.currentTime) return prev;
        return commitClock(pending, prev);
      });
    };
  }, [state.running]);

  const connectWebSocket = useCallback((simId: number) => {
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
    }
    const ws = new SimulationWebSocketClient(simId);

    ws.onMessage((msg) => {
      if (!msg) return;

      if (msg.estado === "CANCELADA") {
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

      // Backend terminó de planificar; el cronómetro sigue hasta el fin de la ventana sim (5 días)
      if (msg.estado === "FINALIZADA") {
        return;
      }

      // En cola hasta que el cronómetro sim cruce cada frontera de 6 h (Sc)
      blockQueueRef.current.push(msg);
      console.log(`Block ${msg.bloqueActual} queued. Queue size: ${blockQueueRef.current.length}`);
      if (runningRef.current && !waitingForFirstBlockRef.current) {
        tryConsumeBlocksAtSimTimeRef.current(currentTimeRef.current);
      }
    });

    ws.onConnect(() => {
      toast.success("Conectado a la simulación en tiempo real");
    });

    ws.connect();
    wsClientRef.current = ws;
  }, []);

  const start = useCallback(async (fechaInicio?: Date) => {
    // Disconnect any previous WebSocket connection before starting fresh
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }
    activeSimIdRef.current = null;
    blockQueueRef.current = [];
    blocksConsumedRef.current = 0;
    occupancyByAirportRef.current = {};
    flightOccupancyRef.current = {};
    flightCapacitiesRef.current = {};

    const startDate = fechaInicio || (() => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)); })();
    const endDate = new Date(startDate.getTime());
    endDate.setUTCDate(startDate.getUTCDate() + 5); // 5 days, UTC-aligned

    const formatLocalISO = (d: Date) => {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const hours = String(d.getUTCHours()).padStart(2, "0");
      const minutes = String(d.getUTCMinutes()).padStart(2, "0");
      const seconds = String(d.getUTCSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    const fechaInicioStr = formatLocalISO(startDate);
    const fechaFinStr = formatLocalISO(endDate);

    try {
      const res = await api.iniciarSimulacion({
        nombre: `Simulación ${fechaInicioStr}`,
        fechaInicio: fechaInicioStr,
        fechaFin: fechaFinStr,
        sa: SA_MINUTES,
        k: K_DEFAULT,
        ta: TA_SECONDS
      });

      const simId = res.simulacionId;
      activeSimIdRef.current = simId;

      // Initialize state using airportsList
      const initialAirports: Record<string, any> = {};
      airportsList.forEach(a => {
        initialAirports[a.code] = { code: a.code, currentStock: 0, capacity: a.warehouseCapacity, incoming: 0, outgoing: 0 };
      });

      const startUtcMs = startDate.getTime();
      targetTimeRef.current = startUtcMs;
      startTimeRef.current = startUtcMs;
      blocksConsumedRef.current = 0;

      // Don't start running yet — enter initial waiting phase
      setState({
        scenario: "weekly",
        turnaroundHours: 1,
        currentTime: startUtcMs,
        startTime: startUtcMs,
        day: 1,
        hour: 0,
        airports: initialAirports,
        flights: [],
        flightOccupancy: {},
        flightCapacities: { ...flightTemplateCapacitiesRef.current },
        baggageGroups: [],
        stats: createEmptyStats(),
        collapsed: false,
        collapseReason: "",
        running: false,           // NOT running yet — waiting for INITIAL_WAIT_SECONDS
        waitingForFirstBlock: true, // Show the waiting popup
        stopped: false,
        hasStarted: true,
        speed: K_DEFAULT,
      });
      setEvents([]);

      connectWebSocket(simId);
    } catch (error: any) {
      toast.error(`Error iniciando simulación: ${error.message}`);
    }
  }, [speed, connectWebSocket, airportsList]);

  // ─── Simulación en Tiempo Real ───
  const startRealtime = useCallback(async () => {
    // Disconnect any previous WebSocket connection before starting fresh
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }
    activeSimIdRef.current = null;
    blockQueueRef.current = [];
    blocksConsumedRef.current = 0;
    occupancyByAirportRef.current = {};
    flightOccupancyRef.current = {};
    flightCapacitiesRef.current = {};
    realtimeExtendingRef.current = false;

    const nowMs = Date.now();
    realtimeAnchorRef.current = nowMs;

    // Start 24h before now, end 6h after now
    const startDate = new Date(nowMs - RT_LOOKBACK_MS);
    const endDate = new Date(nowMs + RT_LOOKAHEAD_MS);
    realtimeEndRef.current = endDate.getTime();

    const formatLocalISO = (d: Date) => {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const hours = String(d.getUTCHours()).padStart(2, "0");
      const minutes = String(d.getUTCMinutes()).padStart(2, "0");
      const seconds = String(d.getUTCSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    const fechaInicioStr = formatLocalISO(startDate);
    const fechaFinStr = formatLocalISO(endDate);

    try {
      const res = await api.iniciarSimulacion({
        nombre: `Tiempo Real ${fechaInicioStr}`,
        fechaInicio: fechaInicioStr,
        fechaFin: fechaFinStr,
        sa: RT_SA_MINUTES,
        k: RT_K,
        ta: RT_TA_SECONDS
      });

      const simId = res.simulacionId;
      activeSimIdRef.current = simId;

      // Initialize airport state
      const initialAirports: Record<string, any> = {};
      airportsList.forEach(a => {
        initialAirports[a.code] = { code: a.code, currentStock: 0, capacity: a.warehouseCapacity, incoming: 0, outgoing: 0 };
      });

      const startUtcMs = startDate.getTime();
      targetTimeRef.current = startUtcMs;
      startTimeRef.current = startUtcMs;
      blocksConsumedRef.current = 0;
      scenarioRef.current = "realtime";

      setState({
        scenario: "realtime",
        turnaroundHours: 1,
        currentTime: startUtcMs,
        startTime: startUtcMs,
        day: 1,
        hour: 0,
        airports: initialAirports,
        flights: [],
        flightOccupancy: {},
        flightCapacities: { ...flightTemplateCapacitiesRef.current },
        baggageGroups: [],
        stats: createEmptyStats(),
        collapsed: false,
        collapseReason: "",
        running: false,
        waitingForFirstBlock: true,
        stopped: false,
        hasStarted: true,
        speed: 1,
        realtimeAnchorMs: nowMs,
        realtimeEndMs: endDate.getTime(),
        realtimeFastForwarding: true,
      });
      setEvents([]);

      connectWebSocket(simId);
    } catch (error: any) {
      toast.error(`Error iniciando simulación en tiempo real: ${error.message}`);
    }
  }, [connectWebSocket, airportsList]);

  // ─── Auto-extensión de ventana de datos en tiempo real ───
  const extendRealtimeWindow = useCallback(async () => {
    if (!activeSimIdRef.current || scenarioRef.current !== "realtime") {
      realtimeExtendingRef.current = false;
      return;
    }

    // Extend: new simulation from current end to +6h
    const currentEnd = realtimeEndRef.current;
    const newEnd = currentEnd + RT_LOOKAHEAD_MS;
    const startDate = new Date(currentEnd);
    const endDate = new Date(newEnd);

    const formatLocalISO = (d: Date) => {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const hours = String(d.getUTCHours()).padStart(2, "0");
      const minutes = String(d.getUTCMinutes()).padStart(2, "0");
      const seconds = String(d.getUTCSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    try {
      // Cancel old simulation
      try {
        await api.cancelarSimulacion(activeSimIdRef.current);
      } catch { /* ignore */ }
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }

      const res = await api.iniciarSimulacion({
        nombre: `Tiempo Real Ext ${formatLocalISO(startDate)}`,
        fechaInicio: formatLocalISO(startDate),
        fechaFin: formatLocalISO(endDate),
        sa: RT_SA_MINUTES,
        k: RT_K,
        ta: RT_TA_SECONDS
      });

      activeSimIdRef.current = res.simulacionId;
      realtimeEndRef.current = newEnd;

      // Update state with new end
      setState(prev => ({
        ...prev,
        realtimeEndMs: newEnd,
      }));

      connectWebSocket(res.simulacionId);
      console.log(`Realtime window extended to ${formatLocalISO(endDate)}`);
    } catch (error: any) {
      console.error("Error extending realtime window:", error);
      toast.error("Error extendiendo ventana de simulación en tiempo real");
    } finally {
      realtimeExtendingRef.current = false;
    }
  }, [connectWebSocket]);

  const extendRealtimeWindowRef = useRef(extendRealtimeWindow);
  extendRealtimeWindowRef.current = extendRealtimeWindow;

  const teardownActiveSimulation = useCallback(async (cancelBackend: boolean) => {
    if (cancelBackend && activeSimIdRef.current) {
      try {
        await api.cancelarSimulacion(activeSimIdRef.current);
      } catch (error: any) {
        console.warn("Error cancelando simulación:", error.message);
      }
    }
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }
    activeSimIdRef.current = null;
    blockQueueRef.current = [];
    blocksConsumedRef.current = 0;
    setWaitCountdown(0);
  }, []);

  /**
   * Pausa cronómetro y backend para revisar Highlights.
   * @param markStopped true solo si la simulación terminó (p. ej. 5 días) y no debe reanudarse
   */
  const pauseSimulation = useCallback(async (markStopped = false) => {
    runningRef.current = false;

    if (waitingForFirstBlockRef.current) {
      await teardownActiveSimulation(true);
      setState(prev => ({
        ...prev,
        running: false,
        stopped: false,
        hasStarted: false,
        waitingForFirstBlock: false,
      }));
      return;
    }

    if (activeSimIdRef.current) {
      try {
        await api.pausarSimulacion(activeSimIdRef.current);
      } catch (error: any) {
        console.warn("Error pausando simulación:", error.message);
      }
      // Mantener WebSocket para poder reanudar tras cerrar Highlights
    }

    setState(prev => ({
      ...prev,
      running: false,
      stopped: markStopped,
      hasStarted: markStopped ? prev.hasStarted : true,
      waitingForFirstBlock: false,
    }));
  }, [teardownActiveSimulation]);

  /** @deprecated alias — usar pauseSimulation(false) al detener manualmente */
  const endSimulation = pauseSimulation;

  /** Cancela antes de que arranque el cronómetro (espera inicial). */
  const cancelSimulation = useCallback(async () => {
    await teardownActiveSimulation(true);
    occupancyByAirportRef.current = {};
    flightOccupancyRef.current = {};
    flightCapacitiesRef.current = {};
    setState(prev => ({
      ...prev,
      running: false,
      stopped: false,
      hasStarted: false,
      waitingForFirstBlock: false,
    }));
  }, [teardownActiveSimulation]);

  const togglePause = useCallback(async () => {
    if (!activeSimIdRef.current || state.stopped || state.waitingForFirstBlock) {
      return;
    }
    try {
      if (state.running) {
        runningRef.current = false;
        await api.pausarSimulacion(activeSimIdRef.current);
        setState(prev => ({ ...prev, running: false }));
      } else {
        if (!wsClientRef.current) {
          connectWebSocket(activeSimIdRef.current);
        }
        runningRef.current = true;
        await api.reanudarSimulacion(activeSimIdRef.current);
        setState(prev => ({ ...prev, running: true }));
      }
    } catch (error: any) {
      toast.error(`Error pausando/reanudando: ${error.message}`);
    }
  }, [state.running, state.stopped, state.waitingForFirstBlock, connectWebSocket]);

  const updateSpeed = useCallback(async (newSpeed: number) => {
    setSpeed(newSpeed);
    setState(prev => ({ ...prev, speed: newSpeed }));
    if (activeSimIdRef.current) {
      try {
        await api.actualizarK(activeSimIdRef.current, newSpeed);
        toast.success(`Velocidad (K) actualizada a ${newSpeed}`);
      } catch (error: any) {
        toast.error(`Error actualizando velocidad: ${error.message}`);
      }
    }
  }, []);

  const reset = useCallback(async () => {
    await teardownActiveSimulation(true);
    occupancyByAirportRef.current = {};
    flightOccupancyRef.current = {};
    flightCapacitiesRef.current = {};
    setState(prev => {
      targetTimeRef.current = prev.startTime;
      return {
        ...prev,
        currentTime: prev.startTime,
        day: 1,
        hour: 0,
        airports: {},
        flights: [],
        flightOccupancy: {},
        flightCapacities: { ...flightTemplateCapacitiesRef.current },
        baggageGroups: [],
        stats: createEmptyStats(),
        collapsed: false,
        running: false,
        stopped: false,
        hasStarted: false,
        waitingForFirstBlock: false,
      };
    });
  }, [teardownActiveSimulation]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
      }
    };
  }, []);

  // Mocks for compatibility with other components
  const handleCancelFlight = useCallback((flightId: string) => { }, []);
  const registerBaggage = useCallback(() => { }, []);
  const batchImportBaggage = useCallback(() => 0, []);
  const batchImportFlights = useCallback(() => 0, []);
  const batchImportAirports = useCallback(() => 0, []);
  const addAirport = useCallback(() => { }, []);
  const updateAirport = useCallback(() => { }, []);
  const removeAirport = useCallback(() => { }, []);
  const addAirline = useCallback(() => { }, []);
  const updateAirline = useCallback(() => { }, []);
  const removeAirline = useCallback(() => { }, []);
  const setScenario = useCallback((sc: "weekly" | "collapse" | "realtime") => {
    setState(prev => ({ ...prev, scenario: sc }));
  }, []);
  const confirmFastForward = useCallback(() => { }, []);
  const cancelFastForward = useCallback(() => { }, []);

  return {
    state,
    events,
    airportsList,
    airlines,
    start,
    startRealtime,
    endSimulation,
    pauseSimulation,
    cancelSimulation,
    reset,
    togglePause,
    updateSpeed,
    waitCountdown,
    handleCancelFlight,
    registerBaggage,
    batchImportBaggage,
    batchImportFlights,
    batchImportAirports,
    addAirport,
    updateAirport,
    removeAirport,
    addAirline,
    updateAirline,
    removeAirline,
    setScenario,
    confirmFastForward,
    cancelFastForward,
    pendingStartDate,
    setPendingStartDate,
  };
}