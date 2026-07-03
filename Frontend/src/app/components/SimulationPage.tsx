import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { SimulationMap } from "./SimulationMap";
import { BaggageTracking } from "./BaggageTracking";
import { TrackingPage } from "./TrackingPage";
import { FlightCancellationCard } from "./FlightCancellationCard";
import type { BaggageGroup } from "../engine/types";
import { hasReachedWeeklySimEnd, hasReachedCollapseSimEnd } from "../engine/types";
import { INITIAL_WAIT_SECONDS } from "../engine/useSimulation";
import { OccupancyLegend, type OccupancyFilters } from "./OccupancyLegend";
import { getOccupancyColor, getOccupancyLevel, computeUtilizationPercent } from "../engine/occupancyStatus";
import { Play, Pause, Square, Plane, Package, Clock, Download, Trophy, AlertTriangle, CheckCircle, XCircle, Warehouse, Radio, ChevronRight, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { RealTimeMap, getRealTimeFlightCapacity } from "./RealTimeMap";
import { RealTimeWebSocketClient } from "../services/realTimeWebSocket";
import { api } from "../services/api";
import { ScrollArea } from "./ui/scroll-area";
import { FlightMonitoringPanel, type FlightItem } from "./FlightMonitoringPanel";
import { resolveFlightCapacity } from "../engine/backendAdapter";
import { WarehouseMonitoringPanel, type WarehouseItem, type WarehouseShipmentItem } from "./WarehouseMonitoringPanel";

const statusConfigRT: Record<string, { color: string; bg: string; lightBg: string; lightColor: string; label: string; icon: React.ReactNode }> = {
  PENDIENTE: { color: "text-amber-500", bg: "bg-amber-500/20", lightBg: "bg-amber-100", lightColor: "text-amber-700", label: "Sin vuelo", icon: <Clock className="w-3 h-3" /> },
  PLANIFICADO: { color: "text-blue-500", bg: "bg-blue-500/20", lightBg: "bg-blue-100", lightColor: "text-blue-800", label: "Asignado", icon: <CheckCircle className="w-3 h-3" /> },
  EN_RUTA: { color: "text-cyan-500", bg: "bg-cyan-500/20", lightBg: "bg-cyan-100", lightColor: "text-cyan-800", label: "En ruta", icon: <Plane className="w-3 h-3" /> },
  ENTREGADO: { color: "text-green-500", bg: "bg-green-500/20", lightBg: "bg-green-100", lightColor: "text-green-700", label: "Entregado", icon: <CheckCircle className="w-3 h-3" /> },
  SIN_RUTA: { color: "text-red-500", bg: "bg-red-500/20", lightBg: "bg-red-100", lightColor: "text-red-700", label: "Sin ruta", icon: <AlertTriangle className="w-3 h-3" /> },
  COLAPSO: { color: "text-red-500", bg: "bg-red-500/20", lightBg: "bg-red-100", lightColor: "text-red-700", label: "Colapso", icon: <AlertTriangle className="w-3 h-3" /> },
};


function formatTimestampShort(ts: number): string {
  if (!ts || isNaN(ts)) return "";
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function formatTimestampFull(ts: number): string {
  if (!ts || isNaN(ts)) return "";
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function formatDurationDHM(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function SimulationPage() {
  const { state, start, startCollapse, pauseSimulation, cancelSimulation, togglePause, updateSpeed, reset, setScenario, confirmFastForward, cancelFastForward, pendingStartDate, waitCountdown } = useSim();
  const { isDark } = useTheme();
  const [selectedBaggage, setSelectedBaggage] = useState<BaggageGroup | null>(null);
  const [showTracking, setShowTracking] = useState(true);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [viewMode, setViewMode] = useState<"simulation" | "tracking">("simulation");
  const [occupancyFilters, setOccupancyFilters] = useState<OccupancyFilters>({
    empty: { warehouse: true, flight: true },
    normal: { warehouse: true, flight: true },
    moderate: { warehouse: true, flight: true },
    saturated: { warehouse: true, flight: true },
    routes: { intracontinental: true, intercontinental: true },
  });
  const [realTimeElapsed, setRealTimeElapsed] = useState(0);

  // Update real time elapsed every second for display
  useEffect(() => {
    if (!state.hasStarted || !state.running) return;
    const interval = setInterval(() => {
      setRealTimeElapsed((prev: number) => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [state.hasStarted, state.running]);

  // Real-time operations state
  const [realTimePedidos, setRealTimePedidos] = useState<any[]>([]);
  const [realTimeResumen, setRealTimeResumen] = useState<any | null>(null);
  const [realTimeAirports, setRealTimeAirports] = useState<any[]>([]);
  const [realTimeFlights, setRealTimeFlights] = useState<any[]>([]);
  const [selectedRealTimePedido, setSelectedRealTimePedido] = useState<any | null>(null);
  const [realTimeSearch, setRealTimeSearch] = useState("");
  const [showRealTimeRightPanel, setShowRealTimeRightPanel] = useState(true);
  const [selectedFlightKey, setSelectedFlightKey] = useState<string | null>(null);
  const [selectedFlightPedidoIds, setSelectedFlightPedidoIds] = useState<string[] | null>(null);
  const [selectedSimFlightKey, setSelectedSimFlightKey] = useState<string | null>(null);
  const [selectedSimFlightBaggageIds, setSelectedSimFlightBaggageIds] = useState<string[] | null>(null);
  const [showRTEnvios, setShowRTEnvios] = useState(false);
  const [showRTVuelos, setShowRTVuelos] = useState(false);
  const [showRTAlmacenes, setShowRTAlmacenes] = useState(false);
  const [showSimEnvios, setShowSimEnvios] = useState(false);
  const [showSimVuelos, setShowSimVuelos] = useState(false);
  const [showSimAlmacenes, setShowSimAlmacenes] = useState(false);
  const [selectedRTWarehouseCode, setSelectedRTWarehouseCode] = useState<string | null>(null);
  const [selectedSimWarehouseCode, setSelectedSimWarehouseCode] = useState<string | null>(null);
  const [showCancelaciones, setShowCancelaciones] = useState(false);
  const [rtPedidosPage, setRtPedidosPage] = useState(1);
  const rtPedidosPageSize = 8;

  // Reset page when realTimeSearch or selectedFlightKey changes
  useEffect(() => {
    setRtPedidosPage(1);
  }, [realTimeSearch, selectedFlightKey]);

  // Jump page if selectedRealTimePedido is set
  useEffect(() => {
    if (selectedRealTimePedido && realTimePedidos) {
      const filteredRT = realTimePedidos.filter(p => {
        if (selectedFlightPedidoIds && !selectedFlightPedidoIds.includes(p.id)) return false;
        if (!realTimeSearch) return true;
        const s = realTimeSearch.toLowerCase();
        return p.id.toLowerCase().includes(s) ||
          p.origenOaci.toLowerCase().includes(s) ||
          p.destinoOaci.toLowerCase().includes(s) ||
          p.nombreAerolinea.toLowerCase().includes(s);
      });
      const idx = filteredRT.findIndex(p => p.id === selectedRealTimePedido.id);
      if (idx !== -1) {
        const pageOfPedido = Math.floor(idx / rtPedidosPageSize) + 1;
        setRtPedidosPage(pageOfPedido);
      }
    }
  }, [selectedRealTimePedido, realTimePedidos, selectedFlightPedidoIds, realTimeSearch]);

  // Load real-time airports
  useEffect(() => {
    api.getAirports().then(data => {
      if (data) {
        setRealTimeAirports(data.map((a: any) => ({
          code: a.oaci,
          city: a.ciudad,
          country: a.pais,
          continent: a.continente || "America",
          timezone: `UTC${a.gmt >= 0 ? `+${a.gmt}` : a.gmt}`,
          gmt: a.gmt,
          lat: a.latitud,
          lng: a.longitud,
          warehouseCapacity: a.capacidadAlmacen,
          currentStock: a.stockActual || 0
        })));
      }
    });
  }, []);

  // WebSockets and REST initial load for real-time
  useEffect(() => {
    if (viewMode !== "tracking") return;

    api.getFlights().then(setRealTimeFlights).catch(console.error);
    api.getOperacionesRT().then(setRealTimePedidos).catch(console.error);
    api.getResumenRT().then(setRealTimeResumen).catch(console.error);

    const ws = new RealTimeWebSocketClient("ADMIN", undefined, {
      onNuevoPedido: (p) => {
        setRealTimePedidos(prev => {
          if (prev.some(x => x.id === p.id)) return prev;
          return [p, ...prev];
        });
      },
      onActualizacion: (r) => {
        setRealTimeResumen(r);
      },
      onPedidosActualizados: (lista: any[]) => {
        setRealTimePedidos(prev => {
          const map = new Map(prev.map(p => [p.id, p]));
          const now = new Date();
          const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
          
          lista.forEach(p => {
            // If the order has finished, check if it was delivered within last 4 hours
            if (["ENTREGADO", "SIN_RUTA", "COLAPSO"].includes(p.estado)) {
              if (p.estado === "ENTREGADO") {
                // Check if delivered within last 4 hours
                const lastTramo = p.tramos[p.tramos.length - 1];
                if (lastTramo && lastTramo.fechaLlegada) {
                  const deliveryDate = new Date(lastTramo.fechaLlegada.endsWith('Z') ? lastTramo.fechaLlegada : lastTramo.fechaLlegada + 'Z');
                  if (deliveryDate >= fourHoursAgo) {
                    map.set(p.id, p);
                  } else {
                    map.delete(p.id);
                  }
                } else {
                  map.delete(p.id);
                }
              } else {
                // SIN_RUTA and COLAPSO are kept so they can be shown in warehouses
                map.set(p.id, p);
              }
            } else {
              map.set(p.id, p);
            }
          });
          return Array.from(map.values()).sort((a, b) => new Date(b.fechaHoraRegistro).getTime() - new Date(a.fechaHoraRegistro).getTime());
        });
      }
    });

    ws.connect();
    return () => ws.disconnect();
  }, [viewMode]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showHighlights, setShowHighlights] = useState(false);
  const [collapseOverlayDismissed, setCollapseOverlayDismissed] = useState(false);
  const weeklyEndHandledRef = useRef(false);
  const collapseHandledRef = useRef(false);

  const getGmt = useCallback((oaci: string) => realTimeAirports.find((a: any) => a.code === oaci)?.gmt ?? 0, [realTimeAirports]);

  const parseUTCDate = (dateStr: any): number => {
    if (!dateStr || typeof dateStr !== "string") return 0;
    let formatted = dateStr.replace(" ", "T");
    if (!formatted.endsWith("Z") && !formatted.includes("+") && !/-\d{2}:\d{2}$/.test(formatted)) {
      formatted += "Z";
    }
    return new Date(formatted).getTime();
  };

  const getDepartureTimeOnly = (isoStr: string) => {
    if (!isoStr) return "";
    try {
      const parts = isoStr.split(/[T ]/);
      if (parts.length >= 2) {
        const timeParts = parts[1].split(":");
        return `${timeParts[0]}:${timeParts[1]}`;
      }
    } catch (e) {}
    return "";
  };

  const fmtLocal = (isoStr: string, gmtOffset: number) => {
    if (!isoStr) return "—";
    try {
      const utc = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z';
      const ms = new Date(utc).getTime() + gmtOffset * 3600_000;
      const d = new Date(ms);
      const day = String(d.getUTCDate()).padStart(2, "0");
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const year = d.getUTCFullYear();
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      const gmtLabel = `UTC${gmtOffset >= 0 ? `+${gmtOffset}` : gmtOffset}`;
      return `${day}-${month}-${year} ${hh}:${mm} ${gmtLabel}`;
    } catch { return "—"; }
  };

  const activeRTFlights = useMemo(() => {
    const flightsMap = new Map<string, any>();

    realTimePedidos.forEach(p => {
      if (!p.tramos) return;
      p.tramos.forEach(leg => {
        if (leg.estado !== "EN_VUELO") return;

        const from = realTimeAirports.find((a) => a.code === leg.origenOaci);
        const to = realTimeAirports.find((a) => a.code === leg.destinoOaci);
        if (!from || !to) return;

        const depTime = parseUTCDate(leg.fechaSalida);
        const arrTime = parseUTCDate(leg.fechaLlegada);
        const flightKey = `${leg.origenOaci}-${leg.destinoOaci}-${depTime}-${arrTime}`;

        if (!flightsMap.has(flightKey)) {
          flightsMap.set(flightKey, {
            key: flightKey,
            fromCode: leg.origenOaci,
            toCode: leg.destinoOaci,
            fechaSalida: leg.fechaSalida,
            fechaLlegada: leg.fechaLlegada,
            cantMaletas: 0,
            pedidoIds: [] as string[],
            shipments: [] as { id: string; cant: number }[],
          });
        }

        const f = flightsMap.get(flightKey)!;
        f.cantMaletas += p.cantidadMaletas;
        f.pedidoIds.push(p.id);
        if (!f.shipments.some((s: any) => s.id === p.id)) {
          f.shipments.push({ id: p.id, cant: p.cantidadMaletas });
        }
      });
    });

    return Array.from(flightsMap.values()).map(f => {
      const capacity = getRealTimeFlightCapacity(f.fromCode, f.toCode, f.fechaSalida, realTimeAirports, realTimeFlights || []);
      const utilization = computeUtilizationPercent(f.cantMaletas, capacity);
      const depTimeStr = getDepartureTimeOnly(f.fechaSalida);
      const id = `${f.fromCode}-${f.toCode}-${depTimeStr}`;
      const fromGmt = getGmt(f.fromCode);
      const toGmt = getGmt(f.toCode);
      
      return {
        id,
        key: f.key,
        fromCode: f.fromCode,
        toCode: f.toCode,
        departureTime: fmtLocal(f.fechaSalida, fromGmt),
        arrivalTime: fmtLocal(f.fechaLlegada, toGmt),
        departureRaw: f.fechaSalida,
        arrivalRaw: f.fechaLlegada,
        currentLoad: f.cantMaletas,
        capacity,
        utilization,
        shipments: f.shipments,
        pedidoIds: f.pedidoIds,
      };
    });
  }, [realTimePedidos, realTimeFlights, realTimeAirports, getGmt]);

  const getSimGmt = useCallback((oaci: string) => {
    const ap = realTimeAirports.find((a: any) => a.code === oaci);
    if (!ap || !ap.timezone) return 0;
    const match = ap.timezone.match(/UTC([+-]\d+(?:\.\d+|:\d+)?)/);
    if (!match) return 0;
    const val = match[1];
    if (val.includes(":")) {
      const parts = val.split(":");
      const hours = parseInt(parts[0], 10);
      const mins = parseInt(parts[1], 10);
      const sign = hours < 0 ? -1 : 1;
      return hours + sign * (mins / 60);
    }
    return parseFloat(val);
  }, [realTimeAirports]);

  const simGmtLabel = useCallback((oaci: string) => {
    const ap = realTimeAirports.find((a: any) => a.code === oaci);
    if (!ap || !ap.timezone) return "UTC+0";
    return ap.timezone;
  }, [realTimeAirports]);

  const formatSimTimestampLocal = useCallback((ts: number, oaci: string): string => {
    if (!ts || isNaN(ts)) return "—";
    const offset = getSimGmt(oaci);
    const localMs = ts + offset * 3600_000;
    const d = new Date(localMs);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const year = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${day}-${month}-${year} ${hh}:${mm} ${simGmtLabel(oaci)}`;
  }, [getSimGmt, simGmtLabel]);

  const getSimDepartureTimeStr = (ts: number) => {
    if (!ts || isNaN(ts)) return "";
    const d = new Date(ts);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const computeSimFlightMetrics = useCallback((
    claveVuelo: string | undefined,
    flightOccupancy: Record<string, number>,
    flightCapacities: Record<string, number>
  ) => {
    const load = claveVuelo ? flightOccupancy[claveVuelo] ?? 0 : 0;
    const capacity = resolveFlightCapacity(claveVuelo, flightCapacities, flightCapacities);
    const utilization = computeUtilizationPercent(load, capacity);
    return { load, capacity, utilization };
  }, []);

  const activeSimFlights = useMemo(() => {
    const { flightOccupancy, flightCapacities, baggageGroups } = state;
    const activePlanes: any[] = [];

    baggageGroups.forEach(bg => {
      if (bg.status !== "in_transit" || !bg.route || bg.route.length === 0) return;

      bg.route.forEach(leg => {
        if (state.currentTime < leg.departureTime || state.currentTime > leg.arrivalTime) return;

        const from = realTimeAirports.find((a) => a.code === leg.from);
        const to = realTimeAirports.find((a) => a.code === leg.to);
        if (!from || !to) return;

        const routeKey = leg.claveVuelo || `${leg.from}-${leg.to}-${leg.departureTime}`;
        if (state.cancelledFlights.has(routeKey)) return;

        const metrics = computeSimFlightMetrics(leg.claveVuelo, flightOccupancy, flightCapacities);

        activePlanes.push({
          routeKey,
          fromCode: leg.from,
          toCode: leg.to,
          departureTime: leg.departureTime,
          arrivalTime: leg.arrivalTime,
          qty: bg.quantity,
          baggageGroupId: bg.id,
          aerolinea: bg.airline,
          ...metrics,
        });
      });
    });

    const planesMap = new Map<string, any>();
    activePlanes.forEach(p => {
      const key = p.routeKey;
      if (planesMap.has(key)) {
        const existing = planesMap.get(key);
        if (!existing.shipments.some((s: any) => s.id === p.baggageGroupId)) {
          existing.shipments.push({ id: p.baggageGroupId, cant: p.qty });
        }
        if (!existing.baggageGroupIds.includes(p.baggageGroupId)) {
          existing.baggageGroupIds.push(p.baggageGroupId);
        }
        existing.qty += p.qty;
      } else {
        planesMap.set(key, {
          ...p,
          shipments: [{ id: p.baggageGroupId, cant: p.qty }],
          baggageGroupIds: [p.baggageGroupId],
        });
      }
    });

    return Array.from(planesMap.values()).map(f => {
      const depTimeStr = getSimDepartureTimeStr(f.departureTime);
      const id = `${f.fromCode}-${f.toCode}-${depTimeStr}`;
      return {
        id,
        key: f.routeKey,
        fromCode: f.fromCode,
        toCode: f.toCode,
        departureTime: formatSimTimestampLocal(f.departureTime, f.fromCode),
        arrivalTime: formatSimTimestampLocal(f.arrivalTime, f.toCode),
        departureRaw: f.departureTime,
        arrivalRaw: f.arrivalTime,
        aerolinea: f.aerolinea,
        currentLoad: f.qty,
        capacity: f.capacity,
        utilization: f.utilization,
        shipments: f.shipments,
        baggageGroupIds: f.baggageGroupIds,
      };
    });
  }, [state.baggageGroups, state.currentTime, state.flightOccupancy, state.flightCapacities, state.cancelledFlights, realTimeAirports, formatSimTimestampLocal, computeSimFlightMetrics]);

  // Update airports with real-time stock data from resumen
  useEffect(() => {
    if (realTimeResumen?.stockActualAlmacenes) {
      setRealTimeAirports(prev => prev.map(a => ({
        ...a,
        currentStock: realTimeResumen.stockActualAlmacenes[a.code] || 0
      })));
    }
  }, [realTimeResumen?.stockActualAlmacenes]);

  // Calculate global warehouse and flight occupancy for tracking mode
  const globalFlightOccupancy = useMemo(() => {
    // Use data from WebSocket resumen if available
    if (realTimeResumen) {
      return realTimeResumen.ocupacionGlobalVuelos || 0;
    }

    let totalFlightLoad = 0;
    let totalFlightCapacity = 0;

    realTimeFlights.forEach(f => {
      const capacity = f.capacidad || f.capacity || 200;
      totalFlightCapacity += capacity;

      let flightLoad = 0;
      realTimePedidos.forEach(p => {
        if (!p.tramos) return;
        const hasMatchingTramo = p.tramos.some(t => {
          if (t.estado !== "EN_VUELO" && t.estado !== "PROGRAMADO") return false;
          const fOrigin = (f.origin || f.origenOaci || "").toUpperCase();
          const fDest = (f.destination || f.destinoOaci || "").toUpperCase();
          if (fOrigin !== t.origenOaci.toUpperCase() || fDest !== t.destinoOaci.toUpperCase()) {
            return false;
          }
          
          let matchTime = false;
          if (f.horaSalida && t.fechaSalida) {
            const parts = f.horaSalida.split(":");
            if (parts.length >= 2) {
              const fHour = parseInt(parts[0], 10);
              const fMinute = parseInt(parts[1], 10);
              const tParts = t.fechaSalida.split(/[T ]/);
              if (tParts.length >= 2) {
                const tTimeParts = tParts[1].split(":");
                if (tTimeParts.length >= 2) {
                  const tHour = parseInt(tTimeParts[0], 10);
                  const tMinute = parseInt(tTimeParts[1], 10);
                  matchTime = fHour === tHour && Math.abs(fMinute - tMinute) < 15;
                }
              }
            }
          }
          return matchTime;
        });
        if (hasMatchingTramo) {
          flightLoad += p.cantidadMaletas;
        }
      });
      totalFlightLoad += flightLoad;
    });

    return computeUtilizationPercent(totalFlightLoad, totalFlightCapacity);
  }, [realTimeResumen, realTimePedidos, realTimeFlights]);

  const globalWarehouseOccupancy = useMemo(() => {
    // Use data from WebSocket resumen if available
    if (realTimeResumen) {
      return realTimeResumen.ocupacionGlobalAlmacenes || 0;
    }

    // Fallback to local calculation
    let totalWarehouseStock = 0;
    let totalWarehouseCapacity = 0;
    realTimeAirports.forEach(a => {
      totalWarehouseStock += a.currentStock || 0;
      totalWarehouseCapacity += a.warehouseCapacity || 0;
    });
    return computeUtilizationPercent(totalWarehouseStock, totalWarehouseCapacity);
  }, [realTimeResumen, realTimeAirports]);

  // ──────────────────────────────────────────────────────────────
  // Warehouse items — Tracking mode (RT)
  // ──────────────────────────────────────────────────────────────
  const rtWarehouseItems = useMemo((): WarehouseItem[] => {
    return realTimeAirports
      .filter((a: any) => (a.warehouseCapacity ?? 0) > 0)
      .map((a: any) => {
        const capacity     = a.warehouseCapacity ?? 0;
        const currentStock = a.currentStock ?? 0;
        const utilization  = capacity > 0 ? (currentStock / capacity) * 100 : 0;

        const shipmentsInWarehouse: WarehouseShipmentItem[] = realTimePedidos
          .filter((p: any) => {
            let currentLocation = p.origenOaci;
            const tramos: any[] = p.tramos || [];
            let isFlying = false;
            for (const t of tramos) {
              if (t.estado === "COMPLETADO") {
                currentLocation = t.destinoOaci;
              } else if (t.estado === "EN_VUELO") {
                isFlying = true;
                break;
              } else if (t.estado === "PROGRAMADO") {
                currentLocation = t.origenOaci;
                break;
              }
            }
            if (isFlying) return false;

            // Si está en el almacén de destino final, verificar si ya pasaron 15 minutos desde su llegada
            if (tramos.length > 0) {
              const lastTramo = tramos[tramos.length - 1];
              if (lastTramo.estado === "COMPLETADO" && lastTramo.destinoOaci === a.code) {
                if (lastTramo.fechaLlegada) {
                  const arrivalTimeMs = new Date(lastTramo.fechaLlegada.endsWith('Z') ? lastTramo.fechaLlegada : lastTramo.fechaLlegada + 'Z').getTime();
                  const nowMs = new Date().getTime();
                  if (nowMs >= arrivalTimeMs + 15 * 60 * 1000) {
                    return false;
                  }
                  return true;
                }
              }
            }

            if (p.estado === "ENTREGADO") return false;
            return currentLocation === a.code;
          })
          .map((p: any) => {
            const tramos: any[] = p.tramos || [];
            let arrivedAt: string | null = null;
            for (let i = tramos.length - 1; i >= 0; i--) {
              if (tramos[i].destinoOaci === a.code && tramos[i].estado === "COMPLETADO") {
                arrivedAt = tramos[i].fechaLlegada || null;
                break;
              }
            }
            let flightDeparture: string | null = null;
            for (const tramo of tramos) {
              if (tramo.origenOaci === a.code && tramo.estado === "PROGRAMADO") {
                flightDeparture = tramo.fechaSalida || null;
                break;
              }
            }
            return {
              id: p.id,
              cant: p.cantidadMaletas,
              arrivedAt,
              flightDeparture,
              isFinalDestination: p.destinoOaci === a.code,
            } as WarehouseShipmentItem;
          });

        return {
          code: a.code,
          cityName: a.city ?? a.code,
          gmt: a.gmt ?? 0,
          capacity,
          currentStock,
          utilization,
          shipments: shipmentsInWarehouse,
        } as WarehouseItem;
      });
  }, [realTimeAirports, realTimePedidos]);

  // ──────────────────────────────────────────────────────────────
  // Warehouse items — Simulation mode
  // ──────────────────────────────────────────────────────────────
  const simWarehouseItems = useMemo((): WarehouseItem[] => {
    const { airports, baggageGroups, currentTime } = state;

    return Object.values(airports)
      .filter(ap => (ap.capacity ?? 0) > 0)
      .map(ap => {
        const capacity     = ap.capacity ?? 0;
        const currentStock = ap.currentStock ?? 0;
        const utilization  = capacity > 0 ? (currentStock / capacity) * 100 : 0;

        // Find city name and GMT from realTimeAirports
        const rtAp = realTimeAirports.find((a: any) => a.code === ap.code);
        const cityName = rtAp?.city ?? ap.code;
        const gmt      = rtAp?.gmt  ?? 0;

        // Shipments "waiting" at this airport in the simulation
        const shipmentsInWarehouse: WarehouseShipmentItem[] = baggageGroups
          .filter(bg => {
            // Si el envío aún no ha sido registrado en el sistema, no lo mostramos
            if (currentTime < bg.registeredAt) {
              return false;
            }
            
            // Si no tiene ruta, está varado en el origen
            if (!bg.route || bg.route.length === 0) {
              if (bg.status === "delivered") return false;
              return bg.origin === ap.code;
            }
            
            // Si todavía no sale su primer vuelo, está en el origen
            if (currentTime < bg.route[0].departureTime) {
              if (bg.status === "delivered") return false;
              return bg.origin === ap.code;
            }
            
            // Si ya llegó a su destino final
            const lastLeg = bg.route[bg.route.length - 1];
            if (currentTime >= lastLeg.arrivalTime) {
              // En simulación, si llegó a su destino y está en la bodega, lo contamos
              // Pero solo si no han pasado más de 15 minutos (900,000 ms) desde la llegada, ya que a los 15 min se entrega al cliente
              if (currentTime >= lastLeg.arrivalTime + 15 * 60 * 1000) {
                return false;
              }
              return lastLeg.to === ap.code;
            }
            
            if (bg.status === "delivered") return false;

            // Entre vuelos o en vuelo
            for (let i = 0; i < bg.route.length; i++) {
              const leg = bg.route[i];
              // En vuelo
              if (currentTime >= leg.departureTime && currentTime < leg.arrivalTime) {
                return false;
              }
              // Esperando conexión
              if (i < bg.route.length - 1) {
                const nextLeg = bg.route[i + 1];
                if (currentTime >= leg.arrivalTime && currentTime < nextLeg.departureTime) {
                  return leg.to === ap.code;
                }
              }
            }
            return false;
          })
          .map(bg => {
            // For simulation, arrivedAt is the arrival time of the last completed leg
            let arrivedAtMs: number | null = null;
            for (let i = bg.currentLegIndex - 1; i >= 0; i--) {
              const leg = bg.route[i];
              if (leg && leg.to === ap.code) {
                arrivedAtMs = leg.arrivalTime;
                break;
              }
            }
            // flightDeparture: next scheduled leg from this airport
            let flightDepartureMs: number | null = null;
            for (let i = bg.currentLegIndex; i < bg.route.length; i++) {
              const leg = bg.route[i];
              if (leg && leg.from === ap.code && leg.departureTime > currentTime) {
                flightDepartureMs = leg.departureTime;
                break;
              }
            }

            // Convert ms timestamps to ISO strings for the panel formatter
            const toIso = (ms: number | null): string | null => {
              if (ms === null) return null;
              return new Date(ms).toISOString();
            };

            return {
              id: bg.id,
              cant: bg.quantity,
              arrivedAt: toIso(arrivedAtMs),
              flightDeparture: toIso(flightDepartureMs),
              isFinalDestination: bg.destination === ap.code,
            } as WarehouseShipmentItem;
          });

        return {
          code: ap.code,
          cityName,
          gmt,
          capacity,
          currentStock,
          utilization,
          shipments: shipmentsInWarehouse,
        } as WarehouseItem;
      });
  }, [state.airports, state.baggageGroups, state.currentTime, realTimeAirports]);

  /** Detener: pausa (reanudable tras Cerrar) y abre Highlights. */
  const handleStopSimulation = useCallback(async () => {
    if (state.waitingForFirstBlock || state.hasStarted) {
      const finished = hasReachedWeeklySimEnd(state);
      await pauseSimulation(finished);
    }
    setShowHighlights(true);
  }, [state, pauseSimulation]);

  // Al completar sim: pausar y mostrar Highlights (una sola vez)
  useEffect(() => {
    if (!state.hasStarted || weeklyEndHandledRef.current) return;
    
    let isEnd = false;
    if (state.scenario === "collapse") {
       isEnd = hasReachedCollapseSimEnd(state);
    } else {
       isEnd = hasReachedWeeklySimEnd(state);
    }

    if (isEnd) {
      weeklyEndHandledRef.current = true;
      void handleStopSimulation();
    }
  }, [
    state.currentTime,
    state.startTime,
    state.hasStarted,
    state.stopped,
    state.scenario,
    state.collapseVisualStartTime,
    handleStopSimulation,
  ]);

  // Detect collapsed shipments and show highlights automatically when clock reaches first collapse time
  useEffect(() => {
    if (
      state.collapsedShipmentsDetected &&
      state.firstCollapsedShipmentTime &&
      state.currentTime >= state.firstCollapsedShipmentTime &&
      !state.running &&
      !showHighlights &&
      !collapseHandledRef.current
    ) {
      collapseHandledRef.current = true;
      setShowHighlights(true);
    }
  }, [state.collapsedShipmentsDetected, state.firstCollapsedShipmentTime, state.currentTime, state.running, showHighlights]);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 4);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll]);

  // Timeline: 6 calendar days anchored to state.startTime
  const totalDays = 6;
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  // Base start time for the timeline (used for labels and coloring)
  const baseStartTime = state.hasStarted
    ? state.startTime
    : (pendingStartDate ? pendingStartDate.getTime() : (() => { const td = new Date(); return Date.UTC(td.getFullYear(), td.getMonth(), td.getDate(), 0, 0, 0); })());

  // Determine "current time" for timeline rendering (use startTime before simulation starts)
  const timelineNow = state.hasStarted ? state.currentTime : baseStartTime;

  // Calendar-day helpers: compute the UTC day-of-year for baseStartTime and timelineNow
  const startDate = new Date(baseStartTime);
  const nowDate = new Date(timelineNow);
  // Day offset (0-based) from the start date's calendar day
  const startDayFloor = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const nowDayFloor = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  const calendarDayOffset = Math.floor((nowDayFloor - startDayFloor) / 86400000); // 0 on first day
  const currentCalDay = calendarDayOffset + 1; // 1-based
  const currentHourFraction = (nowDate.getUTCHours() + nowDate.getUTCMinutes() / 60) / 24;

  // Active flights: count unique flight legs currently in-flight across all baggageGroups
  const activeFlightsCount = (() => {
    const seen = new Set<string>();
    for (const bg of state.baggageGroups) {
      if (!bg.route) continue;
      for (const leg of bg.route) {
        if (state.currentTime >= leg.departureTime && state.currentTime < leg.arrivalTime) {
          const key = `${leg.from}-${leg.to}-${leg.departureTime}`;
          seen.add(key);
        }
      }
    }
    return seen.size;
  })();

  // Theme-aware class helpers
  const panelBg = isDark
    ? "bg-[#0a0f1eee] border-[#1a2744]"
    : "bg-white/90 border-[#cbd5e1]";
  const panelText = isDark ? "text-white" : "text-[#0f172a]";
  const subText = isDark ? "text-white/80" : "text-[#334155]";
  const mutedText = isDark ? "text-white/30" : "text-[#94a3b8]";
  const rootBg = isDark ? "bg-[#080c18]" : "bg-[#eef2f7]";

  const exportResults = (format: "json" | "csv") => {
    const data = {
      scenario: state.scenario,
      day: state.day,
      hour: state.hour,
      collapsed: state.collapsed,
      collapseReason: state.collapseReason,
      kpis: {
        totalRegistered: state.stats.totalRegistered,
        totalDelivered: state.stats.totalDelivered,
        totalInTransit: state.stats.totalInTransit,
        totalWaiting: state.stats.totalWaiting,
        totalDelayed: state.stats.totalDelayed,
        totalFailed: state.stats.totalFailed,
        onTimeRate: state.stats.onTimeRate,
        avgDeliveryTime: state.stats.avgDeliveryTime,
        warehouseUtilization: state.stats.warehouseUtilization,
        flightUtilization: state.stats.flightUtilization,
      },
    };
    let blob: Blob;
    let filename: string;
    if (format === "json") {
      blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      filename = `suitchase_sim_${state.scenario}_${Date.now()}.json`;
    } else {
      const headers = Object.keys(data.kpis).join(",");
      const values = Object.values(data.kpis).join(",");
      const csv = `scenario,day,hour,collapsed,collapseReason\n${data.scenario},${data.day},${data.hour},${data.collapsed},"${data.collapseReason}"\n\n${headers}\n${values}`;
      blob = new Blob([csv], { type: "text/csv" });
      filename = `suitchase_sim_${state.scenario}_${Date.now()}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`h-[calc(100vh-3rem)] flex flex-col -m-4 relative transition-colors duration-200 ${rootBg}`}>
      {/* Barra de título */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center py-3 pointer-events-none">
        <h1 className={`text-[18px] tracking-wider ${isDark ? "text-cyan-400" : "text-blue-800 font-bold"}`} style={{ textShadow: isDark ? "0 0 20px #00e5ff60" : "none" }}>
          Panel de Simulación Logística Global
        </h1>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Panel izquierdo - solo visible en modo simulación */}
        {viewMode === "simulation" && (
          <div className="absolute left-4 top-2 bottom-4 z-10 w-56 pointer-events-auto flex flex-col">
            {/* Fade top */}
            {canScrollUp && (
              <div className={`absolute top-0 left-0 right-0 h-8 z-10 pointer-events-none rounded-t-xl ${isDark ? "bg-gradient-to-b from-[#1a2340ee] to-transparent" : "bg-gradient-to-b from-[#c8d0dcea] to-transparent"}`} />
            )}
            <div
              ref={scrollRef}
              onScroll={checkScroll}
              className="flex-1 flex flex-col gap-3 overflow-y-auto hide-scrollbar"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {/* Spacer top for centering */}
              <div className="shrink-0 mt-auto" />
              {/* Estado */}
              <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
                <h4 className={`text-[12px] mb-2 ${panelText}`}>Estado</h4>
                <OccupancyLegend
                  isDark={isDark}
                  subText={subText}
                  filters={occupancyFilters}
                  onFiltersChange={setOccupancyFilters}
                />
              </div>

              {/* Línea de tiempo */}
              {viewMode === "simulation" && state.scenario !== "collapse" && (
                <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
                  <div className={`text-[14px] font-semibold mb-3 ${panelText}`}>
                    Simulación {state.scenario === "weekly" ? "5 Días" : "1 Día"}
                  </div>
                  <div className="space-y-1">
                    {days.map(d => {
                      const isActive = currentCalDay === d;
                      const isPast = currentCalDay > d;

                      // timestamp for this day's label
                      const dayTs = startDayFloor + (d - 1) * 86400000;
                      const timeStr = isActive
                        ? ` ${String(nowDate.getUTCHours()).padStart(2, "0")}:${String(nowDate.getUTCMinutes()).padStart(2, "0")}`
                        : "";
                      return (
                        <div key={d} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? (isDark ? "bg-cyan-400 animate-pulse" : "bg-blue-600 animate-pulse") : isPast ? (isDark ? "bg-cyan-400" : "bg-blue-600") : isDark ? "bg-[#1e293b]" : "bg-[#cbd5e1]"
                            }`} />
                          <div className={`flex-1 h-[3px] rounded-full ${isDark ? "bg-[#1e293b]" : "bg-[#cbd5e1]"}`}>
                            {(isActive || isPast) && <div className={`h-full rounded-full ${isDark ? "bg-cyan-400" : "bg-blue-500"}`} style={{ width: isActive ? `${currentHourFraction * 100}%` : "100%" }} />}
                          </div>
                          <span className={`text-[12px] ${isActive ? (isDark ? "text-cyan-400 font-semibold" : "text-blue-700 font-semibold") : isPast ? isDark ? "text-white/60" : "text-[#475569]" : mutedText}`}>
                            {formatTimestampShort(dayTs)}{timeStr}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tarjetas de estadísticas */}
              <div className="space-y-2">
                <StatCard isDark={isDark} icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Vuelos en Tránsito" value={activeFlightsCount.toLocaleString()} />
                <StatCard isDark={isDark} icon={<Package className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Total Envíos Acumulados" value={state.stats.totalRegistered.toLocaleString()} />
                <StatCard 
                  isDark={isDark} 
                  icon={<CheckCircle className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} 
                  label="Porcentaje de Consumo de SLA" 
                  value={`${state.stats.onTimeRate.toFixed(1)}%`}
                />
                <StatCard 
                  isDark={isDark} 
                  icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} 
                  label="Ocupación Global de Vuelos" 
                  value={`${state.stats.flightUtilization.toFixed(1)}%`}
                  valueColor={getOccupancyColor(state.stats.flightUtilization)}
                />
                <StatCard 
                  isDark={isDark} 
                  icon={<Warehouse className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} 
                  label="Ocupación Global de Almacenes" 
                  value={`${state.stats.warehouseUtilization.toFixed(1)}%`}
                  valueColor={getOccupancyColor(state.stats.warehouseUtilization)}
                />
              </div>

              {/* Controles */}
              <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
                <div className="flex justify-center items-center gap-2 mb-2">
                  <button
                    onClick={() => {
                      if (!state.hasStarted) {
                        if (state.scenario === "collapse") {
                          startCollapse(pendingStartDate || new Date());
                        } else {
                          start(pendingStartDate);
                        }
                      } else if (!state.stopped) {
                        togglePause();
                      }
                    }}
                    className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${isDark ? "bg-cyan-500/20 border-cyan-500/40 hover:bg-cyan-500/30" : "bg-blue-600/10 border-blue-600/30 hover:bg-blue-600/20"
                      }`}
                  >
                    {state.running ? <Pause className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} /> : <Play className={`w-5 h-5 ml-0.5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />}
                  </button>
                  <button
                    onClick={() => void handleStopSimulation()}
                    disabled={!state.hasStarted && !state.waitingForFirstBlock}
                    className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Square className="w-3 h-3 text-red-400" />
                  </button>
                </div>
                {/* Export buttons */}
                {state.scenario !== "weekly" && (
                  <div className="flex items-center gap-1 mb-2">
                    <button
                      onClick={() => exportResults("json")}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[9px] border transition-colors ${isDark ? "border-[#1a2744] text-white/60 hover:text-cyan-400 hover:border-cyan-500/30" : "border-[#cbd5e1] text-[#64748b] hover:text-blue-700 hover:border-blue-400"}`}
                    >
                      <Download className="w-3 h-3" /> JSON
                    </button>
                    <button
                      onClick={() => exportResults("csv")}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[9px] border transition-colors ${isDark ? "border-[#1a2744] text-white/60 hover:text-cyan-400 hover:border-cyan-500/30" : "border-[#cbd5e1] text-[#64748b] hover:text-blue-700 hover:border-blue-400"}`}
                    >
                      <Download className="w-3 h-3" /> CSV
                    </button>
                  </div>
                )}
              </div>

              {/* Escenarios */}
              <div className={`border rounded-xl p-2 backdrop-blur-sm space-y-1 ${panelBg}`}>
                <h4 className={`text-[11px] mb-1 px-1 font-semibold ${panelText}`}>Escenarios</h4>
                {([
                  { key: "tracking", label: "Operaciones Día a Día" },
                  { key: "weekly", label: "Simulación de 5 días" },
                  { key: "collapse", label: "Simulación Hasta el Colapso" },
                ] as const).map(s => (
                  <button
                    key={s.key}
                    onClick={() => {
                      if (s.key === "tracking") {
                        setViewMode("tracking");
                        setScenario("tracking");
                      } else {
                        setViewMode("simulation");
                        setScenario(s.key);
                      }
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[10px] transition-colors ${(s.key === "tracking" ? viewMode === "tracking" : viewMode === "simulation" && state.scenario === s.key)
                      ? isDark ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20" : "bg-blue-600/10 text-blue-700 border border-blue-600/20"
                      : `${subText} border border-transparent ${isDark ? "hover:bg-[#0f172a] hover:text-cyan-500" : "hover:bg-[#dde6f0] hover:text-blue-700"}`
                      }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Spacer bottom for centering */}
              <div className="shrink-0 mb-auto" />
            </div>
            {/* Fade bottom */}
            {canScrollDown && (
              <div className={`absolute bottom-0 left-0 right-0 h-8 z-10 pointer-events-none rounded-b-xl ${isDark ? "bg-gradient-to-t from-[#1a2340ee] to-transparent" : "bg-gradient-to-t from-[#c8d0dcea] to-transparent"}`} />
            )}
          </div>
        )}

        {/* Selector de modo flotante en tracking */}
        {viewMode === "tracking" && (
          <div className="absolute left-4 top-2 bottom-4 z-30 pointer-events-auto w-56 flex flex-col">
            <div className="flex-1 flex flex-col gap-3 overflow-y-auto hide-scrollbar" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              <div className="shrink-0 mt-auto" />
              {/* Ocupación de Aeropuertos */}
              <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
                <h4 className={`text-[11px] font-semibold mb-2 ${panelText}`}>Estado</h4>
                <OccupancyLegend
                  isDark={isDark}
                  subText={subText}
                  filters={occupancyFilters}
                  onFiltersChange={setOccupancyFilters}
                />
              </div>

              {/* Stats */}
              <div className="space-y-2">
                <StatCard isDark={isDark} icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Vuelos En Tránsito" value={realTimeResumen?.enRuta ?? 0} />
                <StatCard isDark={isDark} icon={<Package className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Envíos sin vuelos asignados" value={realTimeResumen?.pendientes ?? 0} />
                <StatCard isDark={isDark} icon={<Package className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Envíos con vuelos asignados" value={realTimeResumen?.planificados ?? 0} />
                <StatCard 
                  isDark={isDark} 
                  icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} 
                  label="Ocupación Global de Vuelos" 
                  value={`${globalFlightOccupancy.toFixed(1)}%`}
                  valueColor={getOccupancyColor(globalFlightOccupancy)}
                />
                <StatCard 
                  isDark={isDark} 
                  icon={<Warehouse className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} 
                  label="Ocupación Global de Almacenes" 
                  value={`${globalWarehouseOccupancy.toFixed(1)}%`}
                  valueColor={getOccupancyColor(globalWarehouseOccupancy)}
                />
              </div>

              {/* Escenarios */}
              <div className={`border rounded-xl p-2 backdrop-blur-sm space-y-1 ${panelBg}`}>
                <h4 className={`text-[11px] mb-1 px-1 font-semibold ${panelText}`}>Escenarios</h4>
                {([
                  { key: "tracking", label: "Operaciones Día a Día" },
                  { key: "weekly", label: "Simulación de 5 días" },
                  { key: "collapse", label: "Simulación Hasta el Colapso" },
                ] as const).map(s => (
                  <button
                    key={s.key}
                    onClick={() => {
                      if (s.key === "tracking") {
                        setViewMode("tracking");
                        setScenario("tracking");
                      } else {
                        setViewMode("simulation");
                        setScenario(s.key);
                      }
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[10px] transition-colors ${(s.key === "tracking" ? viewMode === "tracking" : viewMode === "simulation" && state.scenario === s.key)
                      ? isDark ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20" : "bg-blue-600/10 text-blue-700 border border-blue-600/20"
                      : `${subText} border border-transparent ${isDark ? "hover:bg-[#0f172a] hover:text-cyan-500" : "hover:bg-[#dde6f0] hover:text-blue-700"}`
                      }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="shrink-0 mb-auto" />
            </div>
          </div>
        )}

        {/* Mapa / Tracking view */}
        {viewMode === "tracking" ? (
          <div className="flex-grow flex relative overflow-hidden h-full w-full">
            {/* RealTime Map */}
            <div className="flex-1 h-full w-full">
              <RealTimeMap
                pedidos={realTimePedidos}
                selectedPedido={selectedRealTimePedido}
                onSelectPedido={setSelectedRealTimePedido}
                airportsList={realTimeAirports}
                flightsList={realTimeFlights}
                selectedFlightKey={selectedFlightKey}
                onSelectFlight={(pedidoIds, key) => {
                  setSelectedFlightPedidoIds(pedidoIds);
                  setSelectedFlightKey(key);
                  if (key) {
                    setShowRTVuelos(true);
                  }
                }}
                filters={occupancyFilters}
                selectedAirportCode={selectedRTWarehouseCode}
                onSelectAirport={(code) => {
                  setSelectedRTWarehouseCode(code);
                  if (code) setShowRTAlmacenes(true);
                }}
              />
            </div>
            {/* RealTime Right Panel */}
            {showRealTimeRightPanel && (
              <div className="absolute right-4 top-14 bottom-4 z-10 w-92 flex flex-col gap-2 pointer-events-none">
                
                {/* Contenedor 1: Envíos */}
                <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
                  showRTEnvios ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
                } ${panelBg}`}>
                  <button
                    onClick={() => {
                      setShowRTEnvios(!showRTEnvios);
                      if (!showRTEnvios) { setShowRTVuelos(false); setShowRTAlmacenes(false); }
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                      showRTEnvios ? `border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}` : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Package className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                      <span className={`text-[13px] ${isDark ? "text-white" : "text-[#111827]"}`}>Monitoreo de Envíos</span>
                    </div>
                    {showRTEnvios ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showRTEnvios && (
                    <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                      {/* Búsqueda */}
                      <div className={`px-3 py-2 border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}`}>
                        <div className="relative">
                          <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${isDark ? "text-white/40" : "text-[#9ca3af]"}`} />
                          <input
                            placeholder="Buscar ID, origen, destino..."
                            value={realTimeSearch}
                            onChange={e => {
                              setRealTimeSearch(e.target.value);
                              setSelectedRealTimePedido(null);
                              setSelectedFlightPedidoIds(null);
                              setSelectedFlightKey(null);
                            }}
                            className={`w-full rounded-lg text-[11px] pl-7 pr-7 py-1.5 border transition-colors focus:outline-none ${
                              isDark ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30" : "bg-white border-[#cbd5e1] text-[#111827] placeholder:text-[#9ca3af]"
                            }`}
                          />
                          {realTimeSearch && (
                            <button
                              onClick={() => {
                                setRealTimeSearch("");
                                setSelectedRealTimePedido(null);
                                setSelectedFlightPedidoIds(null);
                                setSelectedFlightKey(null);
                              }}
                              className={`absolute right-2 top-1/2 -translate-y-1/2 ${isDark ? "text-white/40" : "text-[#9ca3af]"}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Indicador de filtro de vuelo */}
                      {selectedFlightKey && (
                        <div className={`mx-3 my-2 p-2 rounded-lg flex items-center justify-between text-[10px] shrink-0 ${
                          isDark ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-400" : "bg-blue-50 border border-blue-200 text-blue-800"
                        }`}>
                          <span className="truncate">
                            Filtrando por vuelo: {activeRTFlights.find(f => f.key === selectedFlightKey)?.id || selectedFlightKey}
                          </span>
                          <button
                            onClick={() => {
                              setSelectedFlightKey(null);
                              setSelectedFlightPedidoIds(null);
                            }}
                            className="ml-2 font-bold hover:underline shrink-0"
                          >
                            Ver todos
                          </button>
                        </div>
                      )}

                      {/* Detalle del pedido seleccionado */}
                      {selectedRealTimePedido && (
                        <div className={`px-3 py-2 border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"} ${isDark ? "bg-[#0f172a]" : "bg-[#dde3ea]"}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-[12px] font-bold ${isDark ? "text-white" : "text-[#0f172a]"}`}>{selectedRealTimePedido.id}</span>
                            {(() => {
                              const sc = statusConfigRT[selectedRealTimePedido.estado] || statusConfigRT.PENDIENTE;
                              return (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 ${isDark ? sc.bg : sc.lightBg} ${isDark ? sc.color : sc.lightColor}`}>
                                  {sc.icon} <span className="ml-1">{sc.label}</span>
                                </span>
                              );
                            })()}
                          </div>
                          <div className={`text-[10px] mb-2 ${isDark ? "text-white/70" : "text-[#374151]"}`}>
                            {selectedRealTimePedido.nombreAerolinea} | {selectedRealTimePedido.cantidadMaletas} maletas
                          </div>

                          {/* Ruta / Línea de tiempo con huso horario por aeropuerto */}
                          {(() => {
                            const tramos: any[] = selectedRealTimePedido.tramos || [];
                            const fmtLocalTramo = (isoStr: string, gmtOffset: number) => {
                              if (!isoStr) return "—";
                              try {
                                const utc = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z';
                                const ms = new Date(utc).getTime() + gmtOffset * 3600_000;
                                const d = new Date(ms);
                                return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
                              } catch { return "—"; }
                            };
                            const getGmtTramo = (oaci: string) => realTimeAirports.find((a: any) => a.code === oaci)?.gmt ?? 0;
                            const gmtLabel = (g: number) => `UTC${g >= 0 ? `+${g}` : g}`;
                            const registroAirport = selectedRealTimePedido.operarioOaci || selectedRealTimePedido.origenOaci;
                            const registroGmt = getGmtTramo(registroAirport);

                            return (
                              <div className="space-y-0 mt-2 max-h-80 overflow-y-auto">
                                {/* Nodo origen */}
                                <div className="flex items-start gap-2">
                                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} />
                                  <div className="flex-1">
                                    <div className={`text-[10px] font-semibold ${isDark ? "text-white" : "text-[#111827]"}`}>
                                      {realTimeAirports.find(a => a.code === selectedRealTimePedido.origenOaci)?.city || selectedRealTimePedido.origenOaci} ({selectedRealTimePedido.origenOaci})
                                    </div>
                                    <div className={`text-[9px] ${isDark ? "text-white/50" : "text-[#6b7280]"}`}>
                                      Registro: {fmtLocalTramo(selectedRealTimePedido.fechaHoraRegistro, registroGmt)} {gmtLabel(registroGmt)}
                                    </div>
                                    {tramos.length > 0 && (
                                      <div className={`text-[9px] ${isDark ? "text-cyan-400/80" : "text-cyan-700"}`}>
                                        Salida: {fmtLocalTramo(tramos[0].fechaSalida, getGmtTramo(tramos[0].origenOaci))} {gmtLabel(getGmtTramo(tramos[0].origenOaci))}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Nodos intermedios y final */}
                                {tramos.map((leg: any, i: number) => {
                                  const isCompleted = leg.estado === "COMPLETADO";
                                  const isCurrent = leg.estado === "EN_VUELO";
                                  const isPending = leg.estado === "PROGRAMADO" || leg.estado === "CANCELADO";
                                  const isCancelled = leg.estado === "CANCELADO";
                                  const isLast = i === tramos.length - 1;
                                  const arriGmt = getGmtTramo(leg.destinoOaci);
                                  const nextLeg = !isLast ? tramos[i + 1] : null;
                                  return (
                                    <React.Fragment key={i}>
                                      <div className={`ml-[4px] w-[2px] h-3.5 ${isDark ? "bg-[#1e293b]" : "bg-[#c8d0d8]"} relative`}>
                                        {(isCompleted || isCurrent) && (
                                          <div className="absolute inset-0 bg-cyan-500" style={{ height: isCurrent ? "50%" : "100%" }} />
                                        )}
                                      </div>
                                      <div className="flex items-start gap-2">
                                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isCancelled ? "bg-red-500/50" :
                                          isCompleted ? "bg-green-500" :
                                          isCurrent ? "bg-cyan-500 animate-pulse" : (isDark ? "bg-[#334155]" : "bg-[#a0aec0]")
                                        }`} />
                                        <div className="flex-1">
                                          <div className={`text-[10px] font-semibold ${isCancelled ? (isDark ? "text-red-400/70" : "text-red-600/70") : (isDark ? "text-white" : "text-[#111827]")
                                          }`}>
                                            {realTimeAirports.find(a => a.code === leg.destinoOaci)?.city || leg.destinoOaci} ({leg.destinoOaci})
                                            {isCancelled && <span className={`ml-1 text-[9px] ${isDark ? "text-red-400" : "text-red-600"}`}>[Cancelado]</span>}
                                          </div>
                                          {isCurrent && (
                                            <div className={`text-[9px] font-medium ${isDark ? "text-cyan-400" : "text-cyan-700"}`}>
                                              ✈ En vuelo ahora
                                            </div>
                                          )}
                                          <div className={`text-[9px] ${isDark ? "text-white/50" : "text-[#6b7280]"}`}>
                                            Llegada: {fmtLocalTramo(leg.fechaLlegada, arriGmt)} {gmtLabel(arriGmt)}
                                          </div>
                                          {!isLast && nextLeg && (
                                            <div className={`text-[9px] ${isDark ? "text-cyan-400/80" : "text-cyan-700"}`}>
                                              Salida: {fmtLocalTramo(nextLeg.fechaSalida, arriGmt)} {gmtLabel(arriGmt)}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </React.Fragment>
                                  );
                                })}

                                {tramos.length === 0 && (
                                  <div className={`pl-5 text-[10px] py-2 ${isDark ? "text-white/40" : "text-[#9ca3af]"}`}>Sin ruta planificada</div>
                                )}
                              </div>
                            );
                          })()}

                          <button
                            onClick={() => setSelectedRealTimePedido(null)}
                            className={`mt-2.5 text-[10px] transition-colors font-medium ${isDark ? "text-cyan-500 hover:text-cyan-400" : "text-blue-700 hover:text-blue-800"}`}
                          >
                            Cerrar detalle
                          </button>
                        </div>
                      )}

                      {/* Lista de Pedidos */}
                      <ScrollArea className="flex-1 min-h-0">
                        <div className="px-2 py-1">
                          {(() => {
                            const filteredRT = realTimePedidos.filter(p => {
                              if (selectedFlightPedidoIds && !selectedFlightPedidoIds.includes(p.id)) return false;
                              if (!realTimeSearch) return true;
                              const s = realTimeSearch.toLowerCase();
                              return p.id.toLowerCase().includes(s) ||
                                p.origenOaci.toLowerCase().includes(s) ||
                                p.destinoOaci.toLowerCase().includes(s) ||
                                p.nombreAerolinea.toLowerCase().includes(s);
                            });

                            if (filteredRT.length === 0) {
                              return (
                                <div className={`text-[11px] text-center py-12 ${isDark ? "text-white/40" : "text-[#9ca3af]"}`}>
                                  No hay pedidos activos en este momento.
                                </div>
                              );
                            }

                            const totalRTPages = Math.ceil(filteredRT.length / rtPedidosPageSize);
                            const paginatedRT = filteredRT.slice((rtPedidosPage - 1) * rtPedidosPageSize, rtPedidosPage * rtPedidosPageSize);

                            return (
                              <>
                                <div className="space-y-1">
                                  {paginatedRT.map(p => {
                                    const s = statusConfigRT[p.estado] || statusConfigRT.PENDIENTE;
                                    const isSelected = selectedRealTimePedido?.id === p.id;
                                    return (
                                      <button
                                        key={p.id}
                                        onClick={() => setSelectedRealTimePedido(isSelected ? null : p)}
                                        className={`w-full text-left px-2 py-2 rounded-md flex items-center gap-2 transition-colors ${
                                          isSelected ? (isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-blue-600/10 border border-blue-600/30") : `${isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]"} border border-transparent`
                                        }`}
                                      >
                                        <div className={`shrink-0 ${s.color}`}>{s.icon}</div>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-1.5">
                                            <span className={`text-[10.5px] font-semibold ${isDark ? "text-white" : "text-[#0f172a]"}`}>{p.id}</span>
                                            <span className={`text-[9px] ${isDark ? "text-white/40" : "text-[#9ca3af]"}`}>x{p.cantidadMaletas}</span>
                                          </div>
                                          <div className={`text-[9px] truncate ${isDark ? "text-white/70" : "text-[#374151]"}`}>
                                            {p.origenOaci} <ChevronRight className="w-2.5 h-2.5 inline" /> {p.destinoOaci}
                                          </div>
                                          <div className={`text-[8.5px] ${isDark ? "text-white/50" : "text-[#6b7280]"} truncate`}>
                                            {p.nombreAerolinea}
                                          </div>
                                        </div>
                                        <span className={`text-[8.5px] px-1.5 py-0.5 rounded-full ${s.bg} ${s.color} font-medium`}>
                                          {s.label}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                                
                                {totalRTPages > 1 && (
                                  <div className={`mt-2 px-2 py-1.5 border-t ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"} flex items-center justify-between text-[9.5px]`}>
                                    <button
                                      onClick={() => setRtPedidosPage(prev => Math.max(prev - 1, 1))}
                                      disabled={rtPedidosPage === 1}
                                      className={`px-1.5 py-0.5 rounded border transition-colors ${
                                        rtPedidosPage === 1 ? "opacity-35 cursor-not-allowed border-transparent" : isDark ? "border-[#1e293b] text-cyan-400 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-blue-700 hover:bg-slate-100"
                                      }`}
                                    >
                                      Anterior
                                    </button>
                                    <span className={isDark ? "text-white/50" : "text-[#6b7280]"}>
                                      Página <span className={`font-semibold ${isDark ? "text-white" : "text-[#111827]"}`}>{rtPedidosPage}</span> de <span className={`font-semibold ${isDark ? "text-white" : "text-[#111827]"}`}>{totalRTPages}</span> ({filteredRT.length} envíos)
                                    </span>
                                    <button
                                      onClick={() => setRtPedidosPage(prev => Math.min(prev + 1, totalRTPages))}
                                      disabled={rtPedidosPage === totalRTPages}
                                      className={`px-1.5 py-0.5 rounded border transition-colors ${
                                        rtPedidosPage === totalRTPages ? "opacity-35 cursor-not-allowed border-transparent" : isDark ? "border-[#1e293b] text-cyan-400 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-blue-700 hover:bg-slate-100"
                                      }`}
                                    >
                                      Siguiente
                                    </button>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>

                {/* Contenedor 2: Vuelos */}
                <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
                  showRTVuelos ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
                } ${panelBg}`}>
                  <button
                    onClick={() => {
                      setShowRTVuelos(!showRTVuelos);
                      if (!showRTVuelos) { setShowRTEnvios(false); setShowRTAlmacenes(false); }
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                      showRTVuelos ? `border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}` : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Plane className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                      <span className={`text-[13px] ${isDark ? "text-white" : "text-[#111827]"}`}>Monitoreo de Vuelos</span>
                    </div>
                    {showRTVuelos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showRTVuelos && (
                    <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                      <FlightMonitoringPanel
                        flights={activeRTFlights}
                        isDark={isDark}
                        selectedFlightKey={selectedFlightKey}
                        onSelectFlightOnMap={(pedidoIds, key) => {
                          setSelectedFlightPedidoIds(pedidoIds);
                          setSelectedFlightKey(key);
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Contenedor 3: Almacenes (tracking mode) */}
                <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
                  showRTAlmacenes ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
                } ${panelBg}`}>
                  <button
                    onClick={() => {
                      setShowRTAlmacenes(!showRTAlmacenes);
                      if (!showRTAlmacenes) { setShowRTEnvios(false); setShowRTVuelos(false); }
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                      showRTAlmacenes ? `border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}` : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Warehouse className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                      <span className={`text-[13px] ${isDark ? "text-white" : "text-[#111827]"}`}>Monitoreo de Almacenes</span>
                    </div>
                    {showRTAlmacenes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showRTAlmacenes && (
                    <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                      <WarehouseMonitoringPanel
                        warehouses={rtWarehouseItems}
                        isDark={isDark}
                        selectedCode={selectedRTWarehouseCode}
                        onDeselect={() => setSelectedRTWarehouseCode(null)}
                      />
                    </div>
                  )}
                </div>

              </div>
            )}

            <button
              onClick={() => setShowRealTimeRightPanel(!showRealTimeRightPanel)}
              className={`absolute right-4 top-3 z-20 px-2.5 py-1 border rounded-lg text-[10px] transition-colors ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`}
            >
              {showRealTimeRightPanel ? "Ocultar" : "Monitoreo"}
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1">
              <SimulationMap
                selectedBaggage={selectedBaggage}
                onSelectBaggage={setSelectedBaggage}
                selectedFlightKey={selectedSimFlightKey}
                onSelectFlight={(baggageIds, key) => {
                  setSelectedSimFlightBaggageIds(baggageIds);
                  setSelectedSimFlightKey(key);
                  if (key) {
                    setShowSimVuelos(true);
                  }
                }}
                filters={occupancyFilters}
                selectedAirportCode={selectedSimWarehouseCode}
                onSelectAirport={(code) => {
                  setSelectedSimWarehouseCode(code);
                  if (code) setShowSimAlmacenes(true);
                }}
              />
            </div>

            {/* Panel derecho - Tracking & Cancelación */}
            {showTracking && (
              <div className="absolute right-4 top-14 bottom-4 z-10 w-92 flex flex-col gap-2 pointer-events-none">
                
                {/* Contenedor 1: Envíos */}
                <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
                  showSimEnvios ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
                } ${panelBg}`}>
                  <button
                    onClick={() => {
                      setShowSimEnvios(!showSimEnvios);
                      if (!showSimEnvios) { setShowSimVuelos(false); setShowSimAlmacenes(false); }
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                      showSimEnvios ? `border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}` : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Package className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                      <span className={`text-[13px] ${isDark ? "text-white" : "text-[#111827]"}`}>Monitoreo de Envíos</span>
                    </div>
                    {showSimEnvios ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showSimEnvios && (
                    <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                      <BaggageTracking
                        selectedBaggage={selectedBaggage}
                        onSelectBaggage={setSelectedBaggage}
                        selectedFlightBaggageIds={selectedSimFlightBaggageIds}
                        selectedFlightKey={selectedSimFlightKey}
                        onClearFlightFilter={() => {
                          setSelectedSimFlightKey(null);
                          setSelectedSimFlightBaggageIds(null);
                        }}
                        hideHeader={true}
                      />
                    </div>
                  )}
                </div>

                {/* Contenedor 2: Vuelos */}
                <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
                  showSimVuelos ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
                } ${panelBg}`}>
                  <button
                    onClick={() => {
                      setShowSimVuelos(!showSimVuelos);
                      if (!showSimVuelos) { setShowSimEnvios(false); setShowSimAlmacenes(false); }
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                      showSimVuelos ? `border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}` : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Plane className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                      <span className={`text-[13px] ${isDark ? "text-white" : "text-[#111827]"}`}>Monitoreo de Vuelos</span>
                    </div>
                    {showSimVuelos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showSimVuelos && (
                    <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                      <FlightMonitoringPanel
                        flights={activeSimFlights}
                        isDark={isDark}
                        selectedFlightKey={selectedSimFlightKey}
                        onSelectFlightOnMap={(baggageIds, key) => {
                          setSelectedSimFlightBaggageIds(baggageIds);
                          setSelectedSimFlightKey(key);
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Contenedor 3: Almacenes (simulation mode) */}
                <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
                  showSimAlmacenes ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
                } ${panelBg}`}>
                  <button
                    onClick={() => {
                      setShowSimAlmacenes(!showSimAlmacenes);
                      if (!showSimAlmacenes) { setShowSimEnvios(false); setShowSimVuelos(false); }
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                      showSimAlmacenes ? `border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}` : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Warehouse className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                      <span className={`text-[13px] ${isDark ? "text-white" : "text-[#111827]"}`}>Monitoreo de Almacenes</span>
                    </div>
                    {showSimAlmacenes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showSimAlmacenes && (
                    <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                      <WarehouseMonitoringPanel
                        warehouses={simWarehouseItems}
                        isDark={isDark}
                        selectedCode={selectedSimWarehouseCode}
                        onDeselect={() => setSelectedSimWarehouseCode(null)}
                      />
                    </div>
                  )}
                </div>

                {/* Cancelación */}
                {state.scenario !== "collapse" && (
                  <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
                    showCancelaciones ? "flex-grow flex-1 min-h-[150px]" : "h-10 shrink-0"
                  } ${panelBg}`}>
                    <button
                      onClick={() => {
                        setShowCancelaciones(!showCancelaciones);
                        if (!showCancelaciones) {
                          // Allow collapse
                        } else {
                          // Collapse others to give space
                          setShowSimEnvios(false);
                          setShowSimVuelos(false);
                        }
                      }}
                      className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                        showCancelaciones ? `border-b ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}` : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`w-4 h-4 ${isDark ? "text-red-400" : "text-red-700"}`} />
                        <span className={`text-[13px] ${isDark ? "text-white" : "text-[#111827]"}`}>Cancelación de Vuelos</span>
                      </div>
                      {showCancelaciones ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showCancelaciones && (
                      <div className="flex-grow flex flex-col min-h-0 overflow-y-auto">
                        <FlightCancellationCard />
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}

            <button
              onClick={() => setShowTracking(!showTracking)}
              className={`absolute right-4 top-3 z-20 px-2 py-1 border rounded-lg text-[10px] transition-colors ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`}
            >
              {showTracking ? "Ocultar" : "Monitoreo"}
            </button>
          </>
        )}
      </div>

      {/* Initial waiting popup — shown while backend computes first block */}
      {state.waitingForFirstBlock && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className={`border rounded-2xl w-full max-w-md mx-4 overflow-hidden ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]"}`}>
            {/* Header */}
            <div className={`flex items-center gap-3 px-6 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <div className={`w-5 h-5 rounded-full border-2 border-t-transparent animate-spin ${isDark ? "border-cyan-400" : "border-blue-600"}`} />
              <h2 className={`text-[16px] font-medium ${isDark ? "text-[#e2e8f0]" : "text-[#0f172a]"}`}>
                Preparando simulación...
              </h2>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-4">
              <p className={`text-[13px] ${isDark ? "text-[#94a3b8]" : "text-[#475569]"}`}>
                El sistema está calculando la planificación inicial del primer bloque de datos.
                La simulación comenzará automáticamente cuando esté lista.
              </p>

              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[11px] ${isDark ? "text-[#64748b]" : "text-[#94a3b8]"}`}>
                    Progreso de espera
                  </span>
                  <span className={`text-[12px] font-mono ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                    {waitCountdown}s restantes
                  </span>
                </div>
                <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-linear ${isDark ? "bg-gradient-to-r from-cyan-600 to-cyan-400" : "bg-gradient-to-r from-blue-500 to-blue-400"}`}
                    style={{ width: `${((INITIAL_WAIT_SECONDS - waitCountdown) / INITIAL_WAIT_SECONDS) * 100}%` }}
                  />
                </div>
              </div>

              {/* Info box */}
              <div className={`rounded-xl p-3 border ${isDark ? "border-[#1e293b] bg-[#1e293b]/50" : "border-[#e2e8f0] bg-[#f8fafc]"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Clock className={`w-3.5 h-3.5 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                  <span className={`text-[11px] font-medium ${isDark ? "text-[#e2e8f0]" : "text-[#0f172a]"}`}>
                    Parámetros de simulación
                  </span>
                </div>
                <div className={`text-[10px] space-y-0.5 ${isDark ? "text-[#94a3b8]" : "text-[#64748b]"}`}>
                  <div>Ventana de consumo: 4 horas simuladas cada 2 minutos reales</div>
                  <div>Velocidad: 2 minutos simulados por cada segundo real</div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={`flex items-center justify-end px-6 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button
                onClick={cancelSimulation}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${isDark ? "text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b]" : "text-[#64748b] hover:text-[#0f172a] hover:bg-[#f1f5f9]"}`}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapse pre-heating popup */}
      {state.collapsePrePhase && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className={`border rounded-2xl w-full max-w-md mx-4 overflow-hidden ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]"}`}>
            {/* Header */}
            <div className={`flex items-center gap-3 px-6 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <div className={`w-5 h-5 rounded-full border-2 border-t-transparent animate-spin ${isDark ? "border-cyan-400" : "border-blue-600"}`} />
              <h2 className={`text-[16px] font-medium ${isDark ? "text-[#e2e8f0]" : "text-[#0f172a]"}`}>
                Preparando simulación hasta el colapso...
              </h2>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-4">
              <p className={`text-[13px] ${isDark ? "text-[#94a3b8]" : "text-[#475569]"}`}>
                Calculando operaciones de los 5 días previos a la fecha inicial... ({state.collapsePreBlocksReceived || 0} / {state.collapsePreBlocks || 25})
              </p>

              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[11px] ${isDark ? "text-[#64748b]" : "text-[#94a3b8]"}`}>
                    Progreso de bloques
                  </span>
                  <span className={`text-[12px] font-mono ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                    {Math.round(((state.collapsePreBlocksReceived || 0) / (state.collapsePreBlocks || 25)) * 100)}%
                  </span>
                </div>
                <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-300 ease-out ${isDark ? "bg-gradient-to-r from-cyan-600 to-cyan-400" : "bg-gradient-to-r from-blue-500 to-blue-400"}`}
                    style={{ width: `${((state.collapsePreBlocksReceived || 0) / (state.collapsePreBlocks || 25)) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={`flex items-center justify-end px-6 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button
                onClick={cancelSimulation}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${isDark ? "text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b]" : "text-[#64748b] hover:text-[#0f172a] hover:bg-[#f1f5f9]"}`}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Highlights overlay (RF70) — al terminar, detener o colapsar; Cerrar solo oculta el panel */}
      {showHighlights && (
        <HighlightsPanel
          state={state}
          isDark={isDark}
          onClose={() => {
            setShowHighlights(false);
            setCollapseOverlayDismissed(true);
          }}
          onReset={() => {
            setShowHighlights(false);
            weeklyEndHandledRef.current = false;
            collapseHandledRef.current = false;
            setCollapseOverlayDismissed(false);
            void reset();
          }}
        />
      )}

      {/* Fast Forward — waiting popup (read-only mode while fast-forwarding) */}
      {state.fastForwardState === "running" && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className={`border rounded-xl w-full max-w-sm mx-4 p-5 ${isDark ? "bg-[#0f172a] border-[#334155]" : "bg-white border-[#cbd5e1]"}`}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-4 h-4 rounded-full border-2 border-t-transparent animate-spin ${isDark ? "border-cyan-400" : "border-blue-600"}`} />
              <h3 className={`text-[16px] font-medium ${isDark ? "text-[#e2e8f0]" : "text-[#0f172a]"}`}>
                Acelerando simulación x10
              </h3>
            </div>
            <p className={`text-[13px] mb-2 ${isDark ? "text-[#94a3b8]" : "text-[#475569]"}`}>
              Esperando a llegar a la fecha {state.targetDateStr}
            </p>
            <p className={`text-[11px] mb-5 ${isDark ? "text-[#64748b]" : "text-[#94a3b8]"}`}>
              Día actual: {state.day} · La simulación está en modo solo lectura mientras avanza.
            </p>
            <div className="flex justify-end">
              <button
                onClick={cancelFastForward}
                className={`px-4 py-2 text-[12px] border rounded-lg ${isDark ? "border-[#334155] text-[#94a3b8] hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]"}`}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fast Forward — reached popup (paused, ready to continue) */}
      {state.fastForwardState === "reached" && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className={`border rounded-xl w-full max-w-sm mx-4 p-5 ${isDark ? "bg-[#0f172a] border-[#334155]" : "bg-white border-[#cbd5e1]"}`}>
            <h3 className={`text-[16px] font-medium mb-3 ${isDark ? "text-[#e2e8f0]" : "text-[#0f172a]"}`}>
              Comenzar a partir de la fecha {state.targetDateStr}
            </h3>
            <p className={`text-[13px] mb-6 ${isDark ? "text-[#94a3b8]" : "text-[#475569]"}`}>
              La simulación está pausada y lista para comenzar.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelFastForward}
                className={`px-4 py-2 text-[12px] border rounded-lg ${isDark ? "border-[#334155] text-[#94a3b8] hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]"}`}
              >
                Cancelar
              </button>
              <button
                onClick={confirmFastForward}
                className={`px-4 py-2 text-[12px] rounded-lg text-white ${isDark ? "bg-cyan-600 hover:bg-cyan-700" : "bg-blue-600 hover:bg-blue-700"}`}
              >
                Iniciar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay de colapso - hidden when highlights are shown */}
      {state.collapsed && !showHighlights && !collapseOverlayDismissed && (
        <div className="absolute inset-0 z-30 bg-red-900/20 flex items-center justify-center pointer-events-none">
          <div className="bg-[#0f172aee] border border-red-500/40 rounded-2xl px-8 py-6 text-center max-w-md pointer-events-auto">
            <div className="text-red-400 text-[16px] mb-2">Sistema Colapsado</div>
            <div className="text-[12px] text-white mb-4">{state.collapseReason}</div>
            <div className="flex items-center gap-2 justify-center">
              <button onClick={() => void handleStopSimulation()} className={`px-4 py-2 border rounded-lg text-[12px] ${isDark ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-600/10 border-blue-600/20 text-blue-700 hover:bg-blue-600/20"}`}>
                Ver Highlights
              </button>
              <button onClick={() => { 
                weeklyEndHandledRef.current = false; 
                collapseHandledRef.current = false; 
                setCollapseOverlayDismissed(false);
                void reset(); 
              }} className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-[12px] hover:bg-red-500/30">
                Reiniciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, isDark, valueColor }: { icon: React.ReactNode; label: string; value: string; sub?: string; isDark: boolean; valueColor?: string }) {
  return (
    <div className={`border rounded-xl p-3 backdrop-blur-sm ${isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]"}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className={`text-[10px] ${isDark ? "text-white/80" : "text-[#334155]"}`}>{label}</span>
      </div>
      <div className={`text-[20px] ${isDark ? "text-white" : "text-[#0f172a]"}`} style={{ color: valueColor, textShadow: isDark && !valueColor ? "0 0 10px #00e5ff30" : "none" }}>{value}</div>
      {sub && <div className={`text-[10px] ${isDark ? "text-white/50" : "text-[#64748b]"}`}>{sub}</div>}
    </div>
  );
}


function HighlightsPanel({ state, isDark, onClose, onReset }: {
  state: import("../engine/types").SimulationState;
  isDark: boolean;
  onClose: () => void;
  onReset: () => void;
}) {
  const { stats, airports, baggageGroups, collapsed, collapseReason, day } = state;

  // Get collapsed baggage groups from stats and current baggageGroups
  const collapsedGroupsFromStats = new Set(stats.collapsedBaggageGroups);
  const collapsedBaggageGroups = baggageGroups.filter(bg => collapsedGroupsFromStats.has(bg.id) || bg.status === "failed");

  const cardBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const textPrimary = isDark ? "text-white" : "text-[#0f172a]";
  const textSecondary = isDark ? "text-[#94a3b8]" : "text-[#64748b]";

  return (
    <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center pointer-events-none">
      <div className={`border rounded-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto pointer-events-auto ${cardBg}`}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <div className="flex items-center gap-2">
            <Trophy className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
            <h2 className={`text-[16px] ${textPrimary}`}>Highlights de Simulación</h2>
            {state.scenario === "collapse" && (state.collapsedShipmentsDetected || state.collapsed) && (
              <span className={`text-[10px] ml-2 px-2 py-0.5 rounded-full ${isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"}`}>
                Colapso
              </span>
            )}
            {state.currentBlock !== undefined && (
              <span className={`text-[10px] ml-2 px-2 py-0.5 rounded-full border ${isDark ? "bg-[#1e293b] border-[#334155] text-[#94a3b8]" : "bg-[#f1f5f9] border-[#cbd5e1] text-[#64748b]"}`}>
                Bloque: {state.currentBlock}
              </span>
            )}
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-white/60" : "hover:bg-[#e2e8f0] text-[#64748b]"}`}>
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* KPI Summary - Last Block Statistics */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Envíos procesados", value: stats.totalBaggageProcessed, icon: <Package className="w-4 h-4 text-blue-400" />, color: "bg-blue-500/15" },
              { label: "Maletas procesadas", value: stats.totalBaggageQuantity, icon: <Warehouse className="w-4 h-4 text-cyan-400" />, color: "bg-cyan-500/15" },
              { label: "Envíos a tiempo", value: stats.totalBaggageOnTime, icon: <CheckCircle className="w-4 h-4 text-green-400" />, color: "bg-green-500/15" },
              { label: "Envíos en colapso", value: stats.totalBaggageCollapsed, icon: <AlertTriangle className="w-4 h-4 text-red-400" />, color: "bg-red-500/15" },
            ].map(k => (
              <div key={k.label} className={`rounded-xl p-3 border ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${k.color}`}>{k.icon}</div>
                <div className={`text-[18px] ${textPrimary}`}>{k.value.toLocaleString()}</div>
                <div className={`text-[10px] ${textSecondary}`}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Collapsed Shipments */}
          {collapsedBaggageGroups.length > 0 && (
            <div>
              <h3 className={`text-[12px] mb-2 flex items-center gap-1.5 ${textPrimary}`}>
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> Envíos en Colapso ({collapsedBaggageGroups.length})
              </h3>
              <div className={`rounded-lg p-2 space-y-1 max-h-24 overflow-y-auto ${isDark ? "bg-[#1e293b]/50" : "bg-[#f1f5f9]"}`}>
                {collapsedBaggageGroups.slice(0, 10).map(bg => (
                  <div key={bg.id} className={`text-[10px] flex items-center gap-2 ${textSecondary}`}>
                    <span className="text-red-400 font-mono">{bg.id}</span>
                    <span>{bg.origin} → {bg.destination}</span>
                    <span>{bg.quantity} maletas</span>
                  </div>
                ))}
                {collapsedBaggageGroups.length > 10 && <div className={`text-[10px] ${textSecondary}`}>+{collapsedBaggageGroups.length - 10} más...</div>}
              </div>
            </div>
          )}

          {/* Collapse reason if applicable */}
          {collapsed && collapseReason && (
            <div className={`rounded-xl p-3 border border-red-500/30 ${isDark ? "bg-red-500/10" : "bg-red-50"}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-red-400 text-[12px]">Motivo de Colapso</span>
              </div>
              <p className={`text-[11px] ${textSecondary}`}>{collapseReason}</p>
            </div>
          )}
        </div>

        <div className={`flex items-center justify-center gap-2 px-6 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <button onClick={onClose}
            className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}>
            Cerrar
          </button>
          <button onClick={onReset}
            className={`px-4 py-1.5 rounded-lg text-[12px] text-white transition-colors ${isDark ? "bg-cyan-600 hover:bg-cyan-500" : "bg-blue-600 hover:bg-blue-700"}`}>
            Nueva Simulación
          </button>
        </div>
      </div>
    </div>
  );
}