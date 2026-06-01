import { useState, useRef, useCallback, useEffect } from "react";
import { createEmptyStats } from "./simulation";
import { AIRPORTS as DEFAULT_AIRPORTS, type Airport } from "../data/airports";
import type { SimulationState, SimEvent, Airline } from "./types";
import { SIM_BASE_DATE } from "./types";
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
  // ... (keep the same if you want, or just a few for mock)
];

// Simulation timing constants
const SA_MINUTES = 3;        // Sa: salto del algoritmo en minutos
const K_DEFAULT = 120;       // K: constante de velocidad
const TA_SECONDS = 60;       // Ta: tiempo del algoritmo en segundos (máx. espera inicial: 90 s)
const SC_MINUTES = K_DEFAULT * SA_MINUTES; // Sc: ventana de consumo = 360 min = 6h
const SA_SECONDS = SA_MINUTES * 60;        // Sa en segundos = 180s = 3 min
const INITIAL_WAIT_SECONDS = 90;           // Espera inicial antes de iniciar cronómetro
// Clock speed: Sc minutos de simulación en Sa segundos reales
// = 360 min sim / 180 s real = 2 min sim / 1 s real = 120 s sim / 1 s real
const SIM_MS_PER_REAL_MS = (SC_MINUTES * 60 * 1000) / (SA_SECONDS * 1000); // = 120

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
  // Countdown seconds remaining for the initial 90s wait
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
  // Track the real-time timestamp when the simulation clock started (after 90s wait)
  const clockStartRealTimeRef = useRef<number>(0);
  // Track the sim-time when the clock started
  const clockStartSimTimeRef = useRef<number>(0);
  // Track startTime for block boundary calculations in the clock tick
  const startTimeRef = useRef<number>(0);

  // ─── Countdown timer for the initial 90-second wait ───
  useEffect(() => {
    if (!state.waitingForFirstBlock) return;

    setWaitCountdown(INITIAL_WAIT_SECONDS);
    const countdownStart = Date.now();

    const countdownId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - countdownStart) / 1000);
      const remaining = INITIAL_WAIT_SECONDS - elapsed;

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
        // Apply the first block from queue if available
        const firstBlock = blockQueueRef.current.shift();
        if (firstBlock) {
          blocksConsumedRef.current = 1;
          applyBlock(firstBlock);
        }
      } else {
        setWaitCountdown(remaining);
      }
    }, 1000);

    return () => clearInterval(countdownId);
  }, [state.waitingForFirstBlock]);

  // ─── Block consumption is now driven by the clock ticker below (removed setInterval) ───

  // ─── Smooth clock ticker: 2 sim-minutes per 1 real second ───
  // Also checks whether the simulation time has crossed the next block boundary
  // to consume queued blocks in perfect sync with the chronometer.
  useEffect(() => {
    if (!state.running) return;

    const SC_MS = SC_MINUTES * 60 * 1000; // 6 hours in ms

    const intervalId = setInterval(() => {
      setState(prev => {
        if (!prev.running) return prev;

        // Advance: SIM_MS_PER_REAL_MS sim-ms per real-ms → in 50ms tick:
        const deltaMs = 50 * SIM_MS_PER_REAL_MS;

        let nextTime = prev.currentTime + deltaMs;
        const maxTime = prev.startTime + 5 * 86400000;
        const reachedEnd =
          prev.scenario === "weekly" && nextTime >= maxTime;
        if (reachedEnd) {
          nextTime = maxTime;
        }

        const diffHours = (nextTime - prev.startTime) / 3600000;

        const minuteIdx = minuteIndexFromSimStart(prev.startTime, nextTime);
        const airports = mapOccupancyToAirports(
          occupancyByAirportRef.current,
          prev.airports,
          minuteIdx
        );
        const stats = {
          ...prev.stats,
          warehouseUtilization:
            Object.keys(occupancyByAirportRef.current).length > 0
              ? computeWarehouseUtilization(airports)
              : prev.stats.warehouseUtilization,
        };

        // Check if we crossed a block boundary and should consume the next block.
        // Block N should be shown when currentTime reaches startTime + N * SC_MS.
        // blocksConsumedRef tracks how many blocks have been applied (1-indexed).
        const nextBlockIndex = blocksConsumedRef.current + 1;
        const nextBoundary = startTimeRef.current + nextBlockIndex * SC_MS;
        if (nextTime >= nextBoundary) {
          const nextBlock = blockQueueRef.current.shift();
          if (nextBlock) {
            blocksConsumedRef.current = nextBlockIndex;
            // Schedule applyBlock outside setState to avoid nested updates
            queueMicrotask(() => applyBlock(nextBlock));
          }
        }

        return {
          ...prev,
          currentTime: nextTime,
          day: Math.floor(diffHours / 24) + 1,
          hour: diffHours % 24,
          airports,
          stats,
          ...(reachedEnd
            ? { running: false, stopped: true, hasStarted: true }
            : {}),
        };
      });
    }, 50);

    return () => clearInterval(intervalId);
  }, [state.running]);

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

  const connectWebSocket = useCallback((simId: number) => {
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
    }
    const ws = new SimulationWebSocketClient(simId);

    ws.onMessage((msg) => {
      if (!msg) return;

      // Handle final/cancelled states immediately
      if (msg.estado === "FINALIZADA" || msg.estado === "CANCELADA") {
        setState(prev => ({
          ...prev,
          running: false,
          stopped: msg.estado === "FINALIZADA",
          hasStarted: true,
          waitingForFirstBlock: false,
        }));
        return;
      }

      // Queue the block for consumption by the timer
      // During the waiting phase, the first block is queued and will be consumed at t=90s
      blockQueueRef.current.push(msg);
      console.log(`Block ${msg.bloqueActual} queued. Queue size: ${blockQueueRef.current.length}`);
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

      // Don't start running yet — enter 90-second waiting phase
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
        running: false,           // NOT running yet — waiting for 90s
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

  /** Detiene la simulación en curso y conserva datos para Highlights (no reinicia). */
  const endSimulation = useCallback(async () => {
    await teardownActiveSimulation(true);
    setState(prev => ({
      ...prev,
      running: false,
      stopped: true,
      hasStarted: true,
      waitingForFirstBlock: false,
    }));
  }, [teardownActiveSimulation]);

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
    if (!activeSimIdRef.current) return;
    try {
      if (state.running) {
        await api.pausarSimulacion(activeSimIdRef.current);
        setState(prev => ({ ...prev, running: false }));
      } else {
        await api.reanudarSimulacion(activeSimIdRef.current);
        setState(prev => ({ ...prev, running: true }));
      }
    } catch (error: any) {
      toast.error(`Error pausando/reanudando: ${error.message}`);
    }
  }, [state.running]);

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
  const setScenario = useCallback((sc: "weekly" | "collapse") => {
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
    endSimulation,
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