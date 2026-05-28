import { useState, useRef, useCallback, useEffect } from "react";
import { createEmptyStats } from "./simulation";
import { AIRPORTS as DEFAULT_AIRPORTS, type Airport } from "../data/airports";
import type { SimulationState, SimEvent, Airline } from "./types";
import { SIM_BASE_DATE } from "./types";
import { toast } from "sonner";
import { api } from "../services/api";
import { SimulationWebSocketClient } from "../services/websocket";
import { mapBlockResultToBaggageGroups, updateStatsFromMetrics } from "./backendAdapter";

const DEFAULT_AIRLINES: Airline[] = [
  { id: "AL-001", name: "AeroLatam", code: "ALT", email: "contacto@aerolatam.com", password: "aerolatam123", assignedAirports: ["GRU", "EZE", "BOG", "LIM", "SCL"] },
  // ... (keep the same if you want, or just a few for mock)
];

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
      baggageGroups: [],
      stats: createEmptyStats(),
      collapsed: false,
      collapseReason: "",
      running: false,
      stopped: false,
      hasStarted: false,
      speed: 4, // Represents K
    };
  });

  const [events, setEvents] = useState<SimEvent[]>([]);
  const [speed, setSpeed] = useState(4); // Default K=4
  const [airportsList, setAirportsList] = useState<Airport[]>(DEFAULT_AIRPORTS);
  const [airlines, setAirlines] = useState<Airline[]>(DEFAULT_AIRLINES);

  const wsClientRef = useRef<SimulationWebSocketClient | null>(null);
  const activeSimIdRef = useRef<number | null>(null);
  const prevCollapsed = useRef(false);
  const [pendingStartDate, setPendingStartDate] = useState<Date | undefined>(undefined);
  const airportsListRef = useRef<Airport[]>(airportsList);

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
  }, [fetchAirports]);

  const targetTimeRef = useRef<number>(state.currentTime);

  // Smooth clock ticker for real-time visualization interpolation
  useEffect(() => {
    if (!state.running) return;

    const intervalId = setInterval(() => {
      setState(prev => {
        if (!prev.running) return prev;

        // sa = 30 mins, ta = 15 seconds, K = prev.speed
        // ClockSpeed = (sa * 60 * K) / ta
        const sa = 30;
        const ta = 15;
        const k = prev.speed || 4;

        // simulated ms to advance in 50ms of real time
        const deltaMs = 50 * (sa * 60 * k) / ta;

        const nextTime = prev.currentTime + deltaMs;
        const diffHours = (nextTime - prev.startTime) / 3600000;

        return {
          ...prev,
          currentTime: nextTime,
          day: Math.floor(diffHours / 24) + 1,
          hour: diffHours % 24,
        };
      });
    }, 50);

    return () => clearInterval(intervalId);
  }, [state.running]);

  const connectWebSocket = useCallback((simId: number) => {
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
    }
    const ws = new SimulationWebSocketClient(simId);

    ws.onMessage((msg) => {
      // Discard updates if paused (not finalized/cancelled)
      if (!msg) return;

      setState(prev => {
        if (!prev.running && msg.estado !== "FINALIZADA" && msg.estado !== "CANCELADA") {
          return prev;
        }

        // Parse cursor from the backend (pure LocalDateTime → same UTC reference frame as flight times)
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
            } else {
              const d = new Date(msg.cursor);
              if (!isNaN(d.getTime())) {
                cursorTime = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
              }
            }
          } catch (e) {
            console.error("Error parsing cursor:", e);
          }
        }

        // Advance the smooth clock target — the interval ticker interpolates toward this
        targetTimeRef.current = Math.max(targetTimeRef.current, cursorTime);

        let newGroups = prev.baggageGroups;
        let newStats  = prev.stats;
        let newAirports = { ...prev.airports };

        if (msg.rutasResumen && msg.metricas) {
          const blockGroups = mapBlockResultToBaggageGroups(
            msg.rutasResumen,
            cursorTime,
            prev.baggageGroups
          );

          // Merge: start with ALL existing groups so nothing is deleted
          const mergedMap = new Map<string | number, any>();
          for (const bg of prev.baggageGroups) {
            mergedMap.set(bg.id, bg);
          }
          // Only overwrite a group if it has NO active flight leg right now
          const smoothTime = prev.currentTime;
          for (const bg of blockGroups) {
            const existing = mergedMap.get(bg.id);
            if (existing) {
              const isFlying = existing.route?.some(
                (leg: any) => smoothTime >= leg.departureTime && smoothTime < leg.arrivalTime
              );
              if (isFlying) continue; // keep the current in-transit animation
            }
            mergedMap.set(bg.id, bg);
          }
          newGroups = Array.from(mergedMap.values());
          newStats = updateStatsFromMetrics(msg.metricas, prev.stats);
        }

        for (const code of Object.keys(newAirports)) {
          if (newAirports[code]) {
            newAirports[code].currentStock = Math.floor(
              newAirports[code].capacity * (newStats.warehouseUtilization / 100)
            );
          }
        }

        const isFinished = msg.estado === "FINALIZADA";
        // NOTE: do NOT set currentTime here — the smooth ticker drives it
        return {
          ...prev,
          baggageGroups: newGroups,
          stats: newStats,
          airports: newAirports,
          running: msg.estado === "EJECUTANDO",
          stopped: isFinished || msg.estado === "CANCELADA",
        };
      });
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
        sa: 30, // Fixed
        k: speed, // Modifiable via UI
        ta: 15 // Fixed
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

      setState({
        scenario: "weekly",
        turnaroundHours: 1,
        currentTime: startUtcMs,
        startTime: startUtcMs,
        day: 1,
        hour: 0,
        airports: initialAirports,
        flights: [],
        baggageGroups: [],
        stats: createEmptyStats(),
        collapsed: false,
        collapseReason: "",
        running: true,
        stopped: false,
        hasStarted: true,
        speed: speed,
      });
      setEvents([]);

      connectWebSocket(simId);
    } catch (error: any) {
      toast.error(`Error iniciando simulación: ${error.message}`);
    }
  }, [speed, connectWebSocket, airportsList]);

  const stop = useCallback(async () => {
    if (activeSimIdRef.current) {
      try {
        await api.cancelarSimulacion(activeSimIdRef.current);
      } catch (error: any) {
        // Ignore errors when cancelling (e.g. already cancelled/finished)
        console.warn("Error cancelando simulación:", error.message);
      }
    }
    // Always clean up local state regardless of API success
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }
    activeSimIdRef.current = null;
    setState(prev => ({ ...prev, running: false, stopped: true, hasStarted: false }));
  }, []);

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
     await stop();
     setState(prev => {
       targetTimeRef.current = prev.startTime;
       return {
         ...prev,
         currentTime: prev.startTime,
         day: 1,
         hour: 0,
         airports: {},
         flights: [],
         baggageGroups: [],
         stats: createEmptyStats(),
         collapsed: false,
         running: false,
         stopped: false,
       };
     });
   }, [stop]);

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
    stop,
    reset,
    togglePause,
    updateSpeed,
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