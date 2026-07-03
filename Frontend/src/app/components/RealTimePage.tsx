import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme } from "../context/ThemeContext";
import { RealTimeMap, getRealTimeFlightCapacity } from "./RealTimeMap";
import { RealTimeWebSocketClient } from "../services/realTimeWebSocket";
import { api } from "../services/api";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Search, Package, MapPin, Plane, CheckCircle, AlertTriangle, Clock, ChevronRight, X, Radio, Warehouse, ChevronUp, ChevronDown } from "lucide-react";
import { OccupancyLegend, type OccupancyFilters } from "./OccupancyLegend";
import { computeUtilizationPercent, getOccupancyColor } from "../engine/occupancyStatus";
import { FlightMonitoringPanel, type FlightItem } from "./FlightMonitoringPanel";
import { WarehouseMonitoringPanel, type WarehouseItem, type WarehouseShipmentItem } from "./WarehouseMonitoringPanel";

interface Tramo {
  orden: number;
  origenOaci: string;
  destinoOaci: string;
  fechaSalida: string;
  fechaLlegada: string;
  estado: string;
}

interface Pedido {
  id: string;
  origenOaci: string;
  destinoOaci: string;
  fechaHoraRegistro: string;
  cantidadMaletas: number;
  aerolineaId: number;
  nombreAerolinea: string;
  estado: string;
  totalTramos: number;
  ubicacionActual: string;
  tramos: Tramo[];
}

interface Resumen {
  totalActivos: number;
  pendientes: number;
  planificados: number;
  enRuta: number;
  ultimaActualizacion: string;
  ocupacionGlobalAlmacenes: number;
  ocupacionGlobalVuelos: number;
  stockActualAlmacenes: Record<string, number>;
}

const statusConfig: Record<string, { color: string; bg: string; lightBg: string; lightColor: string; label: string; icon: React.ReactNode }> = {
  PENDIENTE:   { color: "text-amber-500",  bg: "bg-amber-500/20",  lightBg: "bg-amber-100", lightColor: "text-amber-700", label: "Sin vuelo",   icon: <Clock className="w-3 h-3" /> },
  PLANIFICADO: { color: "text-blue-500",   bg: "bg-blue-500/20",   lightBg: "bg-blue-100",  lightColor: "text-blue-800",  label: "Asignado",    icon: <CheckCircle className="w-3 h-3" /> },
  EN_RUTA:     { color: "text-cyan-500",   bg: "bg-cyan-500/20",   lightBg: "bg-cyan-100",  lightColor: "text-cyan-800",  label: "En ruta",     icon: <Plane className="w-3 h-3" /> },
  ENTREGADO:   { color: "text-green-500",  bg: "bg-green-500/20",  lightBg: "bg-green-100", lightColor: "text-green-700", label: "Entregado",   icon: <CheckCircle className="w-3 h-3" /> },
  SIN_RUTA:    { color: "text-red-500",    bg: "bg-red-500/20",    lightBg: "bg-red-100",   lightColor: "text-red-700",   label: "Sin ruta",    icon: <AlertTriangle className="w-3 h-3" /> },
  COLAPSO:     { color: "text-red-500",    bg: "bg-red-500/20",    lightBg: "bg-red-100",   lightColor: "text-red-700",   label: "Colapso",     icon: <AlertTriangle className="w-3 h-3" /> },
};

function formatTimestamp(isoStr: string): string {
  if (!isoStr) return "—";
  try {
    // El backend envía LocalDateTime sin zona horaria (e.g. "2026-06-11T19:00:00").
    // Añadimos 'Z' para que JS lo interprete como UTC y lo muestre en hora local.
    const utc = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z';
    const d = new Date(utc);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day}-${month}-${year} ${hh}:${mm}`;
  } catch (e) {
    return "—";
  }
}

export function RealTimePage() {
  const { isDark } = useTheme();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [airportsList, setAirportsList] = useState<any[]>([]);
  const [flightsList, setFlightsList] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showEnvios, setShowEnvios] = useState(false); // Collapsed on load
  const [showVuelos, setShowVuelos] = useState(false); // Collapsed on load
  const [showAlmacenes, setShowAlmacenes] = useState(false); // Collapsed on load
  const [selectedFlightKey, setSelectedFlightKey] = useState<string | null>(null);
  const [selectedFlightPedidoIds, setSelectedFlightPedidoIds] = useState<string[] | null>(null);
  const [pedidosPage, setPedidosPage] = useState(1);
  const pedidosPageSize = 8;
  const [occupancyFilters, setOccupancyFilters] = useState<OccupancyFilters>({
    empty: { warehouse: true, flight: true },
    normal: { warehouse: true, flight: true },
    moderate: { warehouse: true, flight: true },
    saturated: { warehouse: true, flight: true },
    routes: { intracontinental: true, intercontinental: true },
  });

  // Load initial data
  useEffect(() => {
    // 1.5 Fetch flights
    api.getFlights().then(setFlightsList).catch(console.error);

    // 1. Fetch airports
    api.getAirports().then(data => {
      if (data) {
        setAirportsList(data.map((a: any) => ({
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

    // 2. Fetch real-time orders
    api.getOperacionesRT().then(setPedidos).catch(console.error);

    // 3. Fetch summary KPIs
    api.getResumenRT().then(setResumen).catch(console.error);

    // 4. Setup Websocket client
    const ws = new RealTimeWebSocketClient("ADMIN", undefined, {
      onNuevoPedido: (p) => {
        setPedidos(prev => {
          if (prev.some(x => x.id === p.id)) return prev;
          return [p, ...prev];
        });
      },
      onActualizacion: (r) => {
        setResumen(r);
      },
      onPedidosActualizados: (lista: Pedido[]) => {
        setPedidos(prev => {
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
  }, []);

  const getCity = (code: string) => airportsList.find(a => a.code === code)?.city || code;

  /** Selecciona un pedido y carga su detalle (con tramos) desde el servidor */
  const handleSelectPedido = async (p: Pedido | null) => {
    if (!p) { setSelectedPedido(null); return; }
    // Mostrar inmediatamente con los datos que tenemos (sin tramos tal vez)
    setSelectedPedido(p);
    setDetailLoading(true);
    try {
      const detalle = await api.getDetallePedidoRT(p.id);
      if (detalle) setSelectedPedido(detalle as Pedido);
    } catch { /* mantener el estado local */ }
    finally { setDetailLoading(false); }
  };

  // Update airports with real-time stock data from resumen
  useEffect(() => {
    if (resumen?.stockActualAlmacenes) {
      setAirportsList(prev => prev.map(a => ({
        ...a,
        currentStock: resumen.stockActualAlmacenes[a.code] || 0
      })));
    }
  }, [resumen?.stockActualAlmacenes]);

  // Calculate global warehouse and flight occupancy from WebSocket data
  const globalOccupancy = useMemo(() => {
    // Use data from WebSocket resumen if available
    if (resumen) {
      return {
        flightUtilization: resumen.ocupacionGlobalVuelos || 0,
        warehouseUtilization: resumen.ocupacionGlobalAlmacenes || 0
      };
    }

    // Fallback to local calculation if resumen not available
    let totalWarehouseStock = 0;
    let totalWarehouseCapacity = 0;
    airportsList.forEach(a => {
      totalWarehouseStock += a.currentStock || 0;
      totalWarehouseCapacity += a.warehouseCapacity || 0;
    });
    const warehouseUtilization = computeUtilizationPercent(totalWarehouseStock, totalWarehouseCapacity);

    let totalFlightLoad = 0;
    let totalFlightCapacity = 0;

    flightsList.forEach(f => {
      const capacity = f.capacidad || f.capacity || 200;
      totalFlightCapacity += capacity;

      let flightLoad = 0;
      pedidos.forEach(p => {
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

    const flightUtilization = computeUtilizationPercent(totalFlightLoad, totalFlightCapacity);

    return {
      flightUtilization,
      warehouseUtilization
    };
  }, [resumen, airportsList, pedidos, flightsList]);

  const getGmt = useCallback((oaci: string) => airportsList.find((a: any) => a.code === oaci)?.gmt ?? 0, [airportsList]);

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

  const activeFlights = useMemo(() => {
    const flightsMap = new Map<string, any>();

    pedidos.forEach(p => {
      if (!p.tramos) return;
      p.tramos.forEach(leg => {
        if (leg.estado !== "EN_VUELO") return;

        const from = airportsList.find((a) => a.code === leg.origenOaci);
        const to = airportsList.find((a) => a.code === leg.destinoOaci);
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
      const capacity = getRealTimeFlightCapacity(f.fromCode, f.toCode, f.fechaSalida, airportsList, flightsList || []);
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
  }, [pedidos, flightsList, airportsList, getGmt]);

  // ──────────────────────────────────────────────────────────────
  // Warehouse items: derived from airportsList + pedidos
  // ──────────────────────────────────────────────────────────────
  const warehouseItems = useMemo((): WarehouseItem[] => {
    return airportsList
      .filter(a => (a.warehouseCapacity ?? 0) > 0)
      .map(a => {
        const capacity    = a.warehouseCapacity ?? 0;
        const currentStock = a.currentStock ?? 0;
        const utilization = capacity > 0 ? (currentStock / capacity) * 100 : 0;

        // Collect shipments currently stored in this warehouse.
        // A shipment is in a warehouse when its ubicacionActual matches the airport code
        // and its state is PENDIENTE or PLANIFICADO (not yet in transit).
        const shipmentsInWarehouse: WarehouseShipmentItem[] = pedidos
          .filter(p => {
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
          .map(p => {
            const tramos: any[] = p.tramos || [];

            // Hour the shipment arrived at this warehouse:
            // Look for the most recent COMPLETADO tramo whose destino is this airport.
            let arrivedAt: string | null = null;
            for (let i = tramos.length - 1; i >= 0; i--) {
              if (tramos[i].destinoOaci === a.code && tramos[i].estado === "COMPLETADO") {
                arrivedAt = tramos[i].fechaLlegada || null;
                break;
              }
            }

            // Hour the next flight departs from this warehouse:
            // Find the first PROGRAMADO tramo whose origen is this airport.
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
  }, [airportsList, pedidos]);

  const filtered = useMemo(() => {
    let result = pedidos;
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(p =>
        p.id.toLowerCase().includes(s) ||
        p.origenOaci.toLowerCase().includes(s) ||
        p.destinoOaci.toLowerCase().includes(s) ||
        p.nombreAerolinea.toLowerCase().includes(s)
      );
    }
    if (selectedFlightPedidoIds) {
      result = result.filter(p => selectedFlightPedidoIds.includes(p.id));
    }
    return result;
  }, [pedidos, search, selectedFlightPedidoIds]);

  // Reset page when search or flight filter changes
  useEffect(() => {
    setPedidosPage(1);
  }, [search, selectedFlightKey]);

  const totalPedidosPages = Math.ceil(filtered.length / pedidosPageSize);

  const paginatedPedidos = useMemo(() => {
    const startIndex = (pedidosPage - 1) * pedidosPageSize;
    return filtered.slice(startIndex, startIndex + pedidosPageSize);
  }, [filtered, pedidosPage, pedidosPageSize]);

  // Jump page if selectedPedido is set
  useEffect(() => {
    if (selectedPedido) {
      const idx = filtered.findIndex(p => p.id === selectedPedido.id);
      if (idx !== -1) {
        const pageOfPedido = Math.floor(idx / pedidosPageSize) + 1;
        setPedidosPage(pageOfPedido);
      }
    }
  }, [selectedPedido, filtered]);

  const rootBg = isDark ? "bg-[#080c18]" : "bg-[#eef2f7]";
  const panelBg = isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]";
  const titleCls = isDark ? "text-white" : "text-[#111827]";
  const subCls = isDark ? "text-white/70" : "text-[#374151]";
  const mutedCls = isDark ? "text-white/50" : "text-[#6b7280]";
  const dimCls = isDark ? "text-white/40" : "text-[#9ca3af]";
  const headerBorder = isDark ? "border-[#1e293b]" : "border-[#c8d0d8]";
  const searchBg = isDark ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30" : "bg-white border-[#c8d0d8] text-[#111827] placeholder:text-[#9ca3af]";
  const searchIcon = isDark ? "text-white/40" : "text-[#9ca3af]";
  const detailBg = isDark ? "bg-[#0f172a]" : "bg-[#dde3ea]";
  const trackLineBg = isDark ? "bg-[#1e293b]" : "bg-[#c8d0d8]";
  const dotInactive = isDark ? "bg-[#334155]" : "bg-[#a0aec0]";
  const hoverRow = isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]";

  const vuelosEnTransitoCount = useMemo(() => {
    const uniqueFlights = new Set<string>();
    pedidos.forEach(p => {
      if (!p.tramos) return;
      p.tramos.forEach(leg => {
        if (leg.estado === "EN_VUELO") {
          const flightKey = `${leg.origenOaci}-${leg.destinoOaci}-${leg.fechaSalida}`;
          uniqueFlights.add(flightKey);
        }
      });
    });
    return uniqueFlights.size;
  }, [pedidos]);

  const sc = selectedPedido ? statusConfig[selectedPedido.estado] : null;

  return (
    <div className={`h-[calc(100vh-3rem)] -m-4 flex flex-col relative transition-colors duration-200 ${rootBg}`}>
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center py-3 pointer-events-none">
        <h1 className={`text-[18px] tracking-wider flex items-center gap-2 ${isDark ? "text-cyan-400" : "text-blue-800 font-bold"}`} style={{ textShadow: isDark ? "0 0 20px #00e5ff60" : "none" }}>
          <Radio className="w-5 h-5 animate-pulse text-red-500" /> Operaciones Día a Día
        </h1>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Panel izquierdo - Stats y Leyenda */}
        <div className="absolute left-4 top-14 bottom-4 z-10 w-52 pointer-events-auto flex flex-col gap-3 overflow-y-auto hide-scrollbar" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          
          {/* Leyenda de Estados */}
          <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
            <h4 className={`text-[11px] font-semibold mb-2 ${titleCls}`}>Almacenes y Vuelos</h4>
            <OccupancyLegend
              isDark={isDark}
              subText={subCls}
              showFlightRoutes={true}
              borderClass={headerBorder}
              filters={occupancyFilters}
              onFiltersChange={setOccupancyFilters}
            />
          </div>

          {/* KPIs Globales */}
          <div className="space-y-2">
            <StatCard isDark={isDark} label="Vuelos En Tránsito" value={vuelosEnTransitoCount} colorClass="text-cyan-500" />
            <StatCard isDark={isDark} label="Envíos sin vuelos asignados" value={resumen?.pendientes ?? 0} colorClass="text-amber-500" />
            <StatCard isDark={isDark} label="Envíos con vuelos asignados" value={resumen?.planificados ?? 0} colorClass="text-blue-500" />
            <StatCard 
              isDark={isDark} 
              label="Ocupación Global de Vuelos" 
              value={parseFloat(globalOccupancy.flightUtilization.toFixed(1))}
              valueColor={getOccupancyColor(globalOccupancy.flightUtilization)}
            />
            <StatCard 
              isDark={isDark} 
              label="Ocupación Global de Almacenes" 
              value={parseFloat(globalOccupancy.warehouseUtilization.toFixed(1))}
              valueColor={getOccupancyColor(globalOccupancy.warehouseUtilization)}
            />
          </div>
        </div>

        {/* Mapa central */}
        <div className="flex-1">
          <RealTimeMap
            pedidos={pedidos}
            selectedPedido={selectedPedido}
            onSelectPedido={setSelectedPedido}
            airportsList={airportsList}
            flightsList={flightsList}
            filters={occupancyFilters}
            selectedFlightKey={selectedFlightKey}
            onSelectFlight={(pedidoIds, key) => {
              setSelectedFlightPedidoIds(pedidoIds);
              setSelectedFlightKey(key);
              if (key) {
                setShowVuelos(true);
              }
            }}
          />
        </div>

        {/* Panel derecho - Rastreo y búsqueda */}
        {showRightPanel && (
          <div className="absolute right-4 top-14 bottom-4 z-10 w-92 flex flex-col gap-2 pointer-events-none">
            
            {/* Contenedor 1: Envíos */}
            <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
              showEnvios ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
            } ${panelBg}`}>
              <button
                onClick={() => {
                  setShowEnvios(!showEnvios);
                  if (!showEnvios) { setShowVuelos(false); setShowAlmacenes(false); }
                }}
                className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                  showEnvios ? `border-b ${headerBorder}` : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Package className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                  <span className={titleCls}>Monitoreo de Envíos</span>
                </div>
                {showEnvios ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showEnvios && (
                <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                  {/* Búsqueda */}
                  <div className={`px-3 py-2 border-b ${headerBorder}`}>
                    <div className="relative">
                      <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${searchIcon}`} />
                      <Input
                        placeholder="Buscar ID, origen, destino..."
                        value={search}
                        onChange={e => { setSearch(e.target.value); setSelectedPedido(null); }}
                        className={`pl-7 h-7 text-[11px] ${searchBg}`}
                      />
                      {search && (
                        <button onClick={() => { setSearch(""); setSelectedPedido(null); }} className={`absolute right-2 top-1/2 -translate-y-1/2 ${dimCls}`}>
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
                        Filtrando por vuelo: {activeFlights.find(f => f.key === selectedFlightKey)?.id || selectedFlightKey}
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
                  {selectedPedido && sc && (
                    <div className={`px-3 py-2 border-b ${headerBorder} ${detailBg}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[12px] font-bold ${titleCls}`}>{selectedPedido.id}</span>
                        <div className="flex items-center gap-1.5">
                          {detailLoading && (
                            <span className={`w-3 h-3 rounded-full border-2 border-t-transparent animate-spin ${
                              isDark ? "border-cyan-400" : "border-blue-600"
                            }`} />
                          )}
                          <Badge className={`text-[9px] ${isDark ? sc.bg : sc.lightBg} ${isDark ? sc.color : sc.lightColor}`}>
                            {sc.icon} <span className="ml-1">{sc.label}</span>
                          </Badge>
                        </div>
                      </div>
                      <div className={`text-[10px] mb-2 ${subCls}`}>
                        {selectedPedido.nombreAerolinea} | {selectedPedido.cantidadMaletas} maletas
                      </div>

                      {/* Ruta / Línea de tiempo con huso horario por aeropuerto */}
                      {(() => {
                        const tramos = selectedPedido.tramos || [];
                        const fmtLocalTramo = (isoStr: string, gmtOffset: number) => {
                          if (!isoStr) return "—";
                          try {
                            const utc = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z';
                            const ms = new Date(utc).getTime() + gmtOffset * 3600_000;
                            const d = new Date(ms);
                            return `${String(d.getUTCDate()).padStart(2,"0")}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
                          } catch { return "—"; }
                        };
                        const getGmtTramo = (oaci: string) => airportsList.find((a: any) => a.code === oaci)?.gmt ?? 0;
                        const gmtLabel = (g: number) => `UTC${g >= 0 ? `+${g}` : g}`;
                        const registroAirport = selectedPedido.operarioOaci || selectedPedido.origenOaci;
                        const registroGmt = getGmtTramo(registroAirport);

                        return (
                          <div className="space-y-0 mt-2 max-h-80 overflow-y-auto">
                            {/* Nodo origen */}
                            <div className="flex items-start gap-2">
                              <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} />
                              <div className="flex-1">
                                <div className={`text-[10px] font-semibold ${titleCls}`}>
                                  {getCity(selectedPedido.origenOaci)} ({selectedPedido.origenOaci})
                                </div>
                                <div className={`text-[9px] ${mutedCls}`}>
                                  Registro: {fmtLocalTramo(selectedPedido.fechaHoraRegistro, registroGmt)} {gmtLabel(registroGmt)}
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
                              const isCurrent   = leg.estado === "EN_VUELO";
                              const isPending   = leg.estado === "PROGRAMADO" || leg.estado === "CANCELADO";
                              const isCancelled = leg.estado === "CANCELADO";
                              const isLast = i === tramos.length - 1;
                              const arriGmt = getGmtTramo(leg.destinoOaci);
                              const nextLeg = !isLast ? tramos[i + 1] : null;
                              return (
                                <React.Fragment key={i}>
                                  <div className={`ml-[4px] w-[2px] h-3.5 ${trackLineBg} relative`}>
                                    {(isCompleted || isCurrent) && (
                                      <div className="absolute inset-0 bg-cyan-500" style={{ height: isCurrent ? "50%" : "100%" }} />
                                    )}
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${
                                      isCancelled ? "bg-red-500/50" :
                                      isCompleted ? "bg-green-500" :
                                      isCurrent   ? "bg-cyan-500 animate-pulse" : dotInactive
                                    }`} />
                                    <div className="flex-1">
                                      <div className={`text-[10px] font-semibold ${
                                        isCancelled ? (isDark ? "text-red-400/70" : "text-red-600/70") : titleCls
                                      }`}>
                                        {getCity(leg.destinoOaci)} ({leg.destinoOaci})
                                        {isCancelled && <span className={`ml-1 text-[9px] ${isDark ? "text-red-400" : "text-red-600"}`}>[Cancelado]</span>}
                                      </div>
                                      {isCurrent && (
                                        <div className={`text-[9px] font-medium ${isDark ? "text-cyan-400" : "text-cyan-700"}`}>
                                          ✈ En vuelo ahora
                                        </div>
                                      )}
                                      <div className={`text-[9px] ${mutedCls}`}>
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
                              <div className={`pl-5 text-[10px] py-2 ${dimCls}`}>Sin ruta planificada</div>
                            )}
                          </div>
                        );
                      })()}

                      <button
                        onClick={() => setSelectedPedido(null)}
                        className={`mt-2.5 text-[10px] transition-colors font-medium ${isDark ? "text-cyan-500 hover:text-cyan-400" : "text-blue-700 hover:text-blue-800"}`}
                      >
                        Cerrar detalle
                      </button>
                    </div>
                  )}

                  {/* Lista de Pedidos */}
                  <ScrollArea className="flex-1">
                    <div className="px-2 py-1">
                      {paginatedPedidos.map(p => {
                        const s = statusConfig[p.estado] || statusConfig.PENDIENTE;
                        const isSelected = selectedPedido?.id === p.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => handleSelectPedido(isSelected ? null : p)}
                            className={`w-full text-left px-2 py-2 rounded-md mb-1 flex items-center gap-2 transition-colors ${
                              isSelected ? (isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-blue-600/10 border border-blue-600/30") : `${hoverRow} border border-transparent`
                            }`}
                          >
                            <div className={`shrink-0 ${s.color}`}>{s.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[10.5px] font-semibold ${titleCls}`}>{p.id}</span>
                                <span className={`text-[9px] ${dimCls}`}>x{p.cantidadMaletas}</span>
                              </div>
                              <div className={`text-[9px] truncate ${subCls}`}>
                                {p.origenOaci} <ChevronRight className="w-2.5 h-2.5 inline" /> {p.destinoOaci}
                              </div>
                              <div className={`text-[8.5px] ${mutedCls} truncate`}>
                                {p.nombreAerolinea}
                              </div>
                            </div>
                            <span className={`text-[8.5px] px-1.5 py-0.5 rounded-full ${s.bg} ${s.color} font-medium`}>
                              {s.label}
                            </span>
                          </button>
                        );
                      })}
                      {filtered.length === 0 && (
                        <div className={`text-[11px] text-center py-12 ${dimCls}`}>
                          No hay pedidos activos en este momento.
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  {/* Controles de Paginación */}
                  {totalPedidosPages > 1 && (
                    <div className={`px-3 py-2 border-t ${headerBorder} bg-black/5 flex items-center justify-between shrink-0 text-[10px]`}>
                      <button
                        onClick={() => setPedidosPage(prev => Math.max(prev - 1, 1))}
                        disabled={pedidosPage === 1}
                        className={`px-2 py-1 rounded border transition-colors font-medium ${
                          pedidosPage === 1
                            ? "opacity-40 cursor-not-allowed border-transparent"
                            : isDark
                              ? "border-[#1e293b] text-cyan-400 hover:bg-[#1e293b]/50"
                              : "border-[#cbd5e1] text-blue-700 hover:bg-slate-100"
                        }`}
                      >
                        Anterior
                      </button>
                      <span className={mutedCls}>
                        Página <span className={`font-semibold ${titleCls}`}>{pedidosPage}</span> de <span className={`font-semibold ${titleCls}`}>{totalPedidosPages}</span> ({filtered.length} envíos)
                      </span>
                      <button
                        onClick={() => setPedidosPage(prev => Math.min(prev + 1, totalPedidosPages))}
                        disabled={pedidosPage === totalPedidosPages}
                        className={`px-2 py-1 rounded border transition-colors font-medium ${
                          pedidosPage === totalPedidosPages
                            ? "opacity-40 cursor-not-allowed border-transparent"
                            : isDark
                              ? "border-[#1e293b] text-cyan-400 hover:bg-[#1e293b]/50"
                              : "border-[#cbd5e1] text-blue-700 hover:bg-slate-100"
                        }`}
                      >
                        Siguiente
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contenedor 2: Vuelos */}
            <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
              showVuelos ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
            } ${panelBg}`}>
              <button
                onClick={() => {
                  setShowVuelos(!showVuelos);
                  if (!showVuelos) { setShowEnvios(false); setShowAlmacenes(false); }
                }}
                className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                  showVuelos ? `border-b ${headerBorder}` : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Plane className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                  <span className={titleCls}>Monitoreo de Vuelos</span>
                </div>
                {showVuelos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showVuelos && (
                <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                  <FlightMonitoringPanel
                    flights={activeFlights}
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

            {/* Contenedor 3: Almacenes */}
            <div className={`flex flex-col border rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 pointer-events-auto ${
              showAlmacenes ? "flex-1 min-h-[150px]" : "h-10 shrink-0"
            } ${panelBg}`}>
              <button
                onClick={() => {
                  setShowAlmacenes(!showAlmacenes);
                  if (!showAlmacenes) { setShowEnvios(false); setShowVuelos(false); }
                }}
                className={`flex items-center justify-between w-full px-3 py-2.5 font-semibold text-[12px] hover:bg-black/5 shrink-0 ${
                  showAlmacenes ? `border-b ${headerBorder}` : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Warehouse className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
                  <span className={titleCls}>Monitoreo de Almacenes</span>
                </div>
                {showAlmacenes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAlmacenes && (
                <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                  <WarehouseMonitoringPanel
                    warehouses={warehouseItems}
                    isDark={isDark}
                  />
                </div>
              )}
            </div>

          </div>
        )}

        <button
          onClick={() => setShowRightPanel(!showRightPanel)}
          className={`absolute right-4 top-3 z-20 px-2.5 py-1 border rounded-lg text-[10px] transition-colors ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`}
        >
          {showRightPanel ? "Ocultar" : "Monitoreo"}
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, colorClass = "", isDark, valueColor }: { label: string; value: number; colorClass?: string; isDark: boolean; valueColor?: string }) {
  return (
    <div className={`border rounded-xl p-2.5 backdrop-blur-sm ${isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]"}`}>
      <span className={`text-[9px] ${isDark ? "text-white/80" : "text-[#334155]"}`}>{label}</span>
      <div className={`text-[18px] font-bold mt-0.5 ${colorClass} ${isDark && !valueColor && colorClass === "" ? "text-white" : ""}`} style={{ color: valueColor }}>{value}</div>
    </div>
  );
}
