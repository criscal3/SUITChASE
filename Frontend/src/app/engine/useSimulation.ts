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
      currentTime: SIM_BASE_DATE.getTime(),
      startTime: SIM_BASE_DATE.getTime(),
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

  // Keep targetTimeRef updated when simulation currentTime changes from WebSocket
  useEffect(() => {
    if (state.running) {
      targetTimeRef.current = state.currentTime;
    }
  }, [state.currentTime, state.running]);

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
        // Limit drifting too far ahead of the backend's current block
        const limitTime = targetTimeRef.current + (sa * 60 * 1000); 
        
        const clampedTime = Math.min(nextTime, limitTime);
        const startDay = new Date(prev.startTime).getTime();
        const diffHours = (clampedTime - startDay) / 3600000;

        return {
          ...prev,
          currentTime: clampedTime,
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
      setState(prev => {
        let cursorTime = prev.currentTime;
        if (msg.cursor) {
          try {
            const parts = String(msg.cursor).split(/[^0-9]/);
            if (parts.length >= 5) {
              const year = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1; // 0-based
              const day = parseInt(parts[2], 10);
              const hour = parseInt(parts[3], 10);
              const minute = parseInt(parts[4], 10);
              const second = parts[5] ? parseInt(parts[5], 10) : 0;
              const parsedDate = new Date(year, month, day, hour, minute, second);
              if (!isNaN(parsedDate.getTime())) {
                cursorTime = parsedDate.getTime();
              }
            } else {
              const d = new Date(msg.cursor);
              if (!isNaN(d.getTime())) cursorTime = d.getTime();
            }
          } catch (e) {
            console.error("Error parsing cursor date:", e);
          }
        }
        
        const startDay = new Date(prev.startTime).getTime();
        const diffHours = (cursorTime - startDay) / 3600000;
        
        let newGroups = prev.baggageGroups;
        let newStats = prev.stats;
        let newAirports = { ...prev.airports };
        
        if (msg.rutasResumen && msg.metricas) {
          // Get the updated/new groups from this block
          const blockGroups = mapBlockResultToBaggageGroups(msg.rutasResumen, cursorTime, prev.baggageGroups);
          
          // Merge by ID: update existing ones, add new ones
          const mergedMap = new Map<string | number, any>();
          // Start with all existing groups
          for (const bg of prev.baggageGroups) {
            mergedMap.set(bg.id, bg);
          }
          // Overwrite/add groups that arrived in this block
          for (const bg of blockGroups) {
            mergedMap.set(bg.id, bg);
          }
          newGroups = Array.from(mergedMap.values());
          newStats = updateStatsFromMetrics(msg.metricas, prev.stats);
        }

        // Just fake the airport stock for now based on stats
        for (const code of Object.keys(newAirports)) {
          if (newAirports[code]) {
            newAirports[code].currentStock = Math.floor(newAirports[code].capacity * (newStats.warehouseUtilization / 100));
          }
        }

        const isFinished = msg.estado === "FINALIZADA";
        
        return {
          ...prev,
          currentTime: cursorTime,
          day: Math.floor(diffHours / 24) + 1,
          hour: diffHours % 24,
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
    const startDate = fechaInicio || SIM_BASE_DATE;
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 5); // 5 days

    const formatLocalISO = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const seconds = String(d.getSeconds()).padStart(2, "0");
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

      setState({
        scenario: "weekly",
        turnaroundHours: 1,
        currentTime: startDate.getTime(),
        startTime: startDate.getTime(),
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
  }, [speed, connectWebSocket]);

  const stop = useCallback(async () => {
    if (activeSimIdRef.current) {
      try {
        await api.cancelarSimulacion(activeSimIdRef.current);
        setState(prev => ({ ...prev, running: false, stopped: true }));
        if (wsClientRef.current) wsClientRef.current.disconnect();
      } catch (error: any) {
        toast.error(`Error cancelando: ${error.message}`);
      }
    }
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
    setState(prev => ({
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
    }));
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
  const handleCancelFlight = useCallback((flightId: string) => {}, []);
  const registerBaggage = useCallback(() => {}, []);
  const batchImportBaggage = useCallback(() => 0, []);
  const batchImportFlights = useCallback(() => 0, []);
  const batchImportAirports = useCallback(() => 0, []);
  const addAirport = useCallback(() => {}, []);
  const updateAirport = useCallback(() => {}, []);
  const removeAirport = useCallback(() => {}, []);
  const addAirline = useCallback(() => {}, []);
  const updateAirline = useCallback(() => {}, []);
  const removeAirline = useCallback(() => {}, []);
  const setScenario = useCallback(() => {}, []);
  const confirmFastForward = useCallback(() => {}, []);
  const cancelFastForward = useCallback(() => {}, []);

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
  };
}