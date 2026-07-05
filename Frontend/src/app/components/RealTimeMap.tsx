import React, { useMemo, useState, useEffect } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup, Line } from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import { useMapSettings } from "../context/MapSettingsContext";
import { MapSettingsPanel } from "./MapSettingsPanel";
import { useTheme } from "../context/ThemeContext";
import {
  getOccupancyColor,
  getOccupancyPlaneStroke,
  getOccupancyTextClass,
  computeUtilizationPercent,
  getOccupancyLevel,
} from "../engine/occupancyStatus";
import type { OccupancyFilters } from "./OccupancyLegend";

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

interface Airport {
  code: string;
  city: string;
  country: string;
  continent: string;
  timezone: string;
  lat: number;
  lng: number;
  warehouseCapacity: number;
  currentStock: number;
  gmt?: number;
}

interface RealTimeMapProps {
  pedidos: Pedido[];
  selectedPedido: Pedido | null;
  onSelectPedido: (p: Pedido | null) => void;
  airportsList: Airport[];
  onSelectFlight?: (pedidoIds: string[] | null, flightKey: string | null) => void;
  selectedFlightKey?: string | null;
  flightsList?: any[];
  filters?: OccupancyFilters;
  selectedAirportCode?: string | null;
  onSelectAirport?: (code: string | null) => void;
}

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const PLANE_SCALE = 0.60;
const WAREHOUSE_SCALE = 0.80;

function PlaneIcon({ color, stroke }: { color: string; stroke: string }) {
  return (
    <path
      d="M0,-8 C0.8,-7.5 1.2,-6 1.2,-4 L1.2,-1.5 L7,3 L7,4.2 L1.2,1.5 L1.2,4.5 L3.2,6.2 L3.2,7.2 L0,6 L-3.2,7.2 L-3.2,6.2 L-1.2,4.5 L-1.2,1.5 L-7,4.2 L-7,3 L-1.2,-1.5 L-1.2,-4 C-1.2,-6 -0.8,-7.5 0,-8 Z"
      fill={color}
      stroke={stroke}
      strokeWidth={0.35}
      strokeLinejoin="round"
    />
  );
}

function interpolateGreatCircle(lat1: number, lng1: number, lat2: number, lng2: number, t: number) {
  const d2r = Math.PI / 180;
  const r2d = 180 / Math.PI;

  const lat1R = lat1 * d2r;
  const lng1R = lng1 * d2r;
  const lat2R = lat2 * d2r;
  const lng2R = lng2 * d2r;

  const dLng = lng2R - lng1R;
  const dLat = lat2R - lat1R;

  const a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1R) * Math.cos(lat2R) * Math.pow(Math.sin(dLng / 2), 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (c === 0) return { lat: lat1, lng: lng1 };

  const f = t;
  const A = Math.sin((1 - f) * c) / Math.sin(c);
  const B = Math.sin(f * c) / Math.sin(c);

  const x = A * Math.cos(lat1R) * Math.cos(lng1R) + B * Math.cos(lat2R) * Math.cos(lng2R);
  const y = A * Math.cos(lat1R) * Math.sin(lng1R) + B * Math.cos(lat2R) * Math.sin(lng2R);
  const z = A * Math.sin(lat1R) + B * Math.sin(lat2R);

  const lat3 = Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)));
  const lng3 = Math.atan2(y, x);

  return { lat: lat3 * r2d, lng: lng3 * r2d };
}

function getHeading(lat1: number, lng1: number, lat2: number, lng2: number) {
  const d2r = Math.PI / 180;
  const r2d = 180 / Math.PI;
  const dLng = (lng2 - lng1) * d2r;
  const y = Math.sin(dLng) * Math.cos(lat2 * d2r);
  const x = Math.cos(lat1 * d2r) * Math.sin(lat2 * d2r) - Math.sin(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.cos(dLng);
  let brng = Math.atan2(y, x) * r2d;
  return (brng + 360) % 360;
}

function parseUTCDate(dateStr: any): number {
  if (!dateStr || typeof dateStr !== "string") return 0;
  let formatted = dateStr.replace(" ", "T");
  if (!formatted.endsWith("Z") && !formatted.includes("+") && !/-\d{2}:\d{2}$/.test(formatted)) {
    formatted += "Z";
  }
  return new Date(formatted).getTime();
}

function getDepartureTimeStr(isoStr: string): string {
  if (!isoStr) return "";
  try {
    const parts = isoStr.split(/[T ]/);
    if (parts.length >= 2) {
      const timeParts = parts[1].split(":");
      return `${timeParts[0]}:${timeParts[1]}`;
    }
  } catch (e) {}
  return "";
}

function AirportTower3D({ color, util, isDark }: { color: string; util: number; isDark?: boolean }) {
  const h_t = 6; // terminal height
  const h = 10 + (Math.min(100, util) / 100) * 10; // tower shaft height
  const gridStroke = isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.25)";

  return (
    <g>
      {/* Terminal Building Base */}
      {/* Left Face */}
      <path d={`M-12,-3 L0,3 L0,${3 - h_t} L-12,${-3 - h_t} Z`} fill={color} opacity={0.8} />
      {/* Right Face */}
      <path d={`M0,3 L6,0 L6,${-h_t} L0,${3 - h_t} Z`} fill={color} opacity={0.6} />
      {/* Roof */}
      <path d={`M0,${3 - h_t} L6,${-h_t} L-6,${-6 - h_t} L-12,${-3 - h_t} Z`} fill={color} />

      {/* Terminal Window Grid */}
      {/* Left Face Grid */}
      <line x1={-9} y1={-1.5} x2={-9} y2={-1.5 - h_t} stroke={gridStroke} strokeWidth={0.5} />
      <line x1={-6} y1={0} x2={-6} y2={-h_t} stroke={gridStroke} strokeWidth={0.5} />
      <line x1={-3} y1={1.5} x2={-3} y2={1.5 - h_t} stroke={gridStroke} strokeWidth={0.5} />
      <line x1={-12} y1={-3 - h_t / 2} x2={0} y2={3 - h_t / 2} stroke={gridStroke} strokeWidth={0.5} />

      {/* Right Face Grid */}
      <line x1={3} y1={1.5} x2={3} y2={1.5 - h_t} stroke={gridStroke} strokeWidth={0.5} />
      <line x1={0} y1={3 - h_t / 2} x2={6} y2={-h_t / 2} stroke={gridStroke} strokeWidth={0.5} />

      {/* Control Tower (translated to the right side of the roof) */}
      <g transform="translate(4.5, -5.5)">
        {/* Shaft */}
        <path d={`M0,1 L-1.5,0 L-1.5,-${h} L0,-${h - 1} Z`} fill={color} opacity={0.8} />
        <path d={`M0,1 L1.5,0 L1.5,-${h} L0,-${h - 1} Z`} fill={color} opacity={0.6} />
        
        {/* Cabin */}
        <path d={`M0,-${h - 1} L-3,-${h} L-3,-${h + 3.5} L0,-${h + 2.5} Z`} fill={color} opacity={0.9} />
        <path d={`M0,-${h - 1} L3,-${h} L3,-${h + 3.5} L0,-${h + 2.5} Z`} fill={color} opacity={0.7} />
        <path d={`M0,-${h + 2.5} L-3,-${h + 3.5} L0,-${h + 4.5} L3,-${h + 3.5} Z`} fill={color} />
        
        {/* Antenna */}
        <line x1={0} y1={-(h + 3.5)} x2={0} y2={-(h + 7.5)} stroke={color} strokeWidth={0.8} />
        <circle cx={0} cy={-(h + 7.5)} r={1} fill={color} />
      </g>
    </g>
  );
}

export function getRealTimeFlightCapacity(
  origin: string,
  destination: string,
  fechaSalida: string,
  airportsList: Airport[],
  flightsList: any[]
): number {
  if (!flightsList || flightsList.length === 0) return 200;

  // Find origin airport timezone offset
  const port = airportsList.find(a => a.code === origin) as any;
  let gmt = 0;
  if (port) {
    if (port.gmt !== undefined) {
      gmt = port.gmt;
    } else if (port.timezone) {
      const match = port.timezone.match(/UTC([+-]\d+(?:\.\d+|:\d+)?)/);
      if (match) {
        const val = match[1];
        if (val.includes(":")) {
          const parts = val.split(":");
          const hours = parseInt(parts[0], 10);
          const mins = parseInt(parts[1], 10);
          const sign = hours < 0 ? -1 : 1;
          gmt = hours + sign * (mins / 60);
        } else {
          gmt = parseFloat(val);
        }
      }
    }
  }

  // Parse time directly from string (since the backend constructs it by setting the local hour/minute of departure)
  let directHour = -1;
  let directMinute = -1;
  if (fechaSalida && typeof fechaSalida === "string") {
    const parts = fechaSalida.split(/[T ]/);
    if (parts.length >= 2) {
      const timeParts = parts[1].split(":");
      if (timeParts.length >= 2) {
        directHour = parseInt(timeParts[0], 10);
        directMinute = parseInt(timeParts[1], 10);
      }
    }
  }

  // Shifted time (assuming the string was UTC and needs GMT offset to get local time)
  const depTime = parseUTCDate(fechaSalida);
  const localMs = depTime + gmt * 3600_000;
  const d = new Date(localMs);
  const shiftedHour = d.getUTCHours();
  const shiftedMinute = d.getUTCMinutes();

  const matchFlight = (h: number, m: number) => {
    return flightsList.find(f => {
      const fOrigin = (f.origin || f.origenOaci || "").toUpperCase();
      const fDest = (f.destination || f.destinoOaci || "").toUpperCase();
      if (fOrigin !== origin.toUpperCase() || fDest !== destination.toUpperCase()) {
        return false;
      }
      if (f.horaSalida) {
        const parts = f.horaSalida.split(":");
        if (parts.length >= 2) {
          const fHour = parseInt(parts[0], 10);
          const fMinute = parseInt(parts[1], 10);
          return fHour === h && Math.abs(fMinute - m) < 15;
        }
      }
      if (f.departureHour != null) {
        return Math.round(f.departureHour) === h;
      }
      return true;
    });
  };

  // 1. Try direct time match
  let match = directHour !== -1 ? matchFlight(directHour, directMinute) : undefined;

  // 2. Try shifted time match
  if (!match) {
    match = matchFlight(shiftedHour, shiftedMinute);
  }

  // 3. Fallback to any flight between origin and destination
  if (!match) {
    match = flightsList.find(f => {
      const fOrigin = (f.origin || f.origenOaci || "").toUpperCase();
      const fDest = (f.destination || f.destinoOaci || "").toUpperCase();
      return fOrigin === origin.toUpperCase() && fDest === destination.toUpperCase();
    });
  }

  return match ? (match.capacity || match.capacidad || 200) : 200;
}

export function RealTimeMap({ pedidos, selectedPedido, onSelectPedido, airportsList, onSelectFlight, selectedFlightKey, flightsList, filters, selectedAirportCode, onSelectAirport }: RealTimeMapProps) {
  const { isDark } = useTheme();
  const { settings, getOceanColor, getActiveCountryColor, getIntraColor, getInterColor, translateCountry, checkCountryMatch } = useMapSettings();
  const [position, setPosition] = useState({ coordinates: [0, 20] as [number, number], zoom: 1 });
  const [hovered, setHovered] = useState<any | null>(null);

  const defaultFilters: OccupancyFilters = {
    empty: { warehouse: true, flight: true },
    normal: { warehouse: true, flight: true },
    moderate: { warehouse: true, flight: true },
    saturated: { warehouse: true, flight: true },
    routes: { intracontinental: true, intercontinental: true },
  };

  const activeFilters = filters ?? defaultFilters;

  const s = 1 / position.zoom;
  const mapBg      = getOceanColor();
  const geoFill    = isDark ? "#0c1a30"  : "#b0c4d8"; // Default
  const geoStroke  = isDark ? "#1a2744"  : "#8fafc8";
  const geoHover   = isDark ? "#0f203d"  : "#9ab8cc";
  const activeGeoFill = getActiveCountryColor();
  const tooltipBg  = isDark ? "bg-[#0a0f1ef0] border-[#1a2744]" : "bg-white/95 border-[#b0c4d8]";
  const tooltipTitle = isDark ? "text-cyan-400" : "text-blue-700";
  const tooltipSub = isDark ? "text-white/70" : "text-[#374151]";
  const tooltipVal = isDark ? "text-white" : "text-[#111827]";
  const labelFill  = isDark ? "#fff" : "#1e3a5f";

  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedPedido) {
      const leg = selectedPedido.tramos.find(t => t.estado === "EN_VUELO") || selectedPedido.tramos[0];
      if (leg) {
        const port = airportsList.find((a) => a.code === leg.origenOaci);
        if (port) {
          setPosition({ coordinates: [port.lng, port.lat], zoom: 2.5 });
        }
      }
    }
  }, [selectedPedido, airportsList]);

  useEffect(() => {
    if (selectedAirportCode) {
      const port = airportsList.find((a) => a.code === selectedAirportCode);
      if (port) {
        setPosition({ coordinates: [port.lng, port.lat], zoom: 3 });
      }
    }
  }, [selectedAirportCode, airportsList]);

  // Arcs and Planes calculations
  const { arcsData, planesData } = useMemo(() => {
    const arcs: any[] = [];
    const flightsMap = new Map<string, any>();

    // 1. Draw paths for selected order (dashed orange line)
    if (selectedPedido && selectedPedido.tramos) {
      selectedPedido.tramos.forEach((leg, i) => {
        const from = airportsList.find((a) => a.code === leg.origenOaci);
        const to = airportsList.find((a) => a.code === leg.destinoOaci);
        if (from && to) {
          arcs.push({
            from: [from.lng, from.lat],
            to: [to.lng, to.lat],
            color: "#ff8800",
            strokeWidth: 2.5,
            isDashed: true,
            key: `sel-${selectedPedido.id}-${i}`,
          });
        }
      });
    }

    // 2. Compute flight progress and positions for active orders, grouping overlapping ones
    const activePedidos = selectedPedido ? [selectedPedido] : pedidos;

    activePedidos.forEach(p => {
      if (!p.tramos) return;

      p.tramos.forEach((leg, i) => {
        if (leg.estado !== "EN_VUELO") return;

        const from = airportsList.find((a) => a.code === leg.origenOaci);
        const to = airportsList.find((a) => a.code === leg.destinoOaci);
        if (!from || !to) return;

        const depTime = parseUTCDate(leg.fechaSalida);
        const arrTime = parseUTCDate(leg.fechaLlegada);

        // Salvaguarda: Si el vuelo ya llegó hace más de 1 minuto Y tenemos fechas válidas, no lo dibujamos.
        if (arrTime > 0 && depTime > 0 && nowMs > arrTime + 60000) return;

        const total = arrTime - depTime;
        // Si no tenemos fechas válidas, usamos progress=0.5 (posición media) como fallback
        // para que el avión EN_VUELO siempre aparezca en el mapa.
        const progress = (total > 0)
          ? Math.min(1, Math.max(0, (nowMs - depTime) / total))
          : 0.5;

        // Grouping key: unique for a specific flight leg at a specific time
        const flightKey = `${leg.origenOaci}-${leg.destinoOaci}-${depTime}-${arrTime}`;

        if (!flightsMap.has(flightKey)) {
          flightsMap.set(flightKey, {
            key: flightKey,
            fromCode: leg.origenOaci,
            toCode: leg.destinoOaci,
            from: [from.lng, from.lat],
            to: [to.lng, to.lat],
            depTime,
            arrTime,
            progress: progress * 100,
            aerolinea: p.nombreAerolinea,
            cantMaletas: 0,
            pedidoIds: [] as string[],
            shipments: [] as { id: string; cant: number }[],
            lat: 0,
            lng: 0,
            heading: 0,
            fechaSalida: leg.fechaSalida,
            fechaLlegada: leg.fechaLlegada,
            departureTime: getDepartureTimeStr(leg.fechaSalida),
          });
        }

        const f = flightsMap.get(flightKey)!;
        f.cantMaletas += p.cantidadMaletas;
        f.pedidoIds.push(p.id);
        f.shipments.push({ id: p.id, cant: p.cantidadMaletas });

        const pos = interpolateGreatCircle(from.lat, from.lng, to.lat, to.lng, progress);
        const delta = Math.min(0.01, 1 - progress);
        const posAhead = interpolateGreatCircle(from.lat, from.lng, to.lat, to.lng, progress + delta);
        const heading = getHeading(pos.lat, pos.lng, posAhead.lat, posAhead.lng);

        f.lat = pos.lat;
        f.lng = pos.lng;
        f.heading = heading;
      });
    });

    // Add unique active flight arcs
    flightsMap.forEach((f) => {
      const fromAir = airportsList.find(a => a.code === f.fromCode);
      const toAir = airportsList.find(a => a.code === f.toCode);
      const sameContinent = fromAir && toAir ? fromAir.continent === toAir.continent : true;
      const routeColor = sameContinent ? getIntraColor() : getInterColor();

      if (f.from && f.to) {
          // Calculate utilization for filtering
          const capacity = getRealTimeFlightCapacity(f.fromCode, f.toCode, f.fechaSalida, airportsList, flightsList || []);
          const utilization = computeUtilizationPercent(f.cantMaletas, capacity);
          const level = getOccupancyLevel(utilization);
          
          // Filter arcs based on flight occupancy level
          if (activeFilters[level].flight) {
            // Filter based on route type (intracontinental vs intercontinental)
            if (!sameContinent && activeFilters.routes.intercontinental) {
              arcs.push({
                from: f.from,
                to: f.to,
                fromCode: f.fromCode,
                toCode: f.toCode,
                color: routeColor,
                strokeWidth: 1.5,
                key: `arc-${f.key}`,
              });
            } else if (sameContinent && activeFilters.routes.intracontinental) {
              arcs.push({
                from: f.from,
                to: f.to,
                fromCode: f.fromCode,
                toCode: f.toCode,
                color: routeColor,
                strokeWidth: 1.5,
                key: `arc-${f.key}`,
              });
            }
          }
        }
    });

    const activePlanes = Array.from(flightsMap.values()).map(f => {
      const capacity = getRealTimeFlightCapacity(f.fromCode, f.toCode, f.fechaSalida, airportsList, flightsList || []);
      const utilization = computeUtilizationPercent(f.cantMaletas, capacity);
      const fromAir = airportsList.find(a => a.code === f.fromCode);
      const toAir = airportsList.find(a => a.code === f.toCode);
      const sameContinent = fromAir && toAir ? fromAir.continent === toAir.continent : true;
      return {
        ...f,
        capacity,
        utilization,
        intercontinental: !sameContinent,
      };
    }).filter((plane) => {
      // Filter flights based on occupancy level and active filters
      const planeLevel = getOccupancyLevel(plane.utilization ?? 0);
      if (!activeFilters[planeLevel].flight) return false;

      // Filter based on route type (intracontinental vs intercontinental)
      if (plane.intercontinental && !activeFilters.routes.intercontinental) return false;
      if (!plane.intercontinental && !activeFilters.routes.intracontinental) return false;

      return true;
    });
    return { arcsData: arcs, planesData: activePlanes };
  }, [pedidos, selectedPedido, airportsList, isDark, nowMs, flightsList, activeFilters, getIntraColor, getInterColor]);

  return (
    <div className="w-full h-full rounded-xl overflow-hidden relative transition-colors duration-200" style={{ background: mapBg }}>
      <MapSettingsPanel />
      <ComposableMap projection="geoMercator" projectionConfig={{ scale: 120 }} style={{ width: "100%", height: "100%", display: "block" }}>
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={(pos) => setPosition(pos)}
          maxZoom={10}
        >
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const countryNameEn = geo.properties.name || "";
                const translatedName = translateCountry(countryNameEn);
                const isCountryActive = airportsList.some(
                  (a) => checkCountryMatch(a.country, countryNameEn)
                );
                
                const centroid = geoCentroid(geo);
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={isCountryActive ? activeGeoFill : geoFill}
                    stroke={geoStroke}
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", fill: geoHover },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>



          {/* Arcs/Lines */}
          {arcsData.filter(arc => {
            if (selectedAirportCode) {
              // Show only arcs connected to the selected airport
              return arc.fromCode === selectedAirportCode || arc.toCode === selectedAirportCode;
            }
            return !selectedFlightKey || selectedPedido || arc.key === `arc-${selectedFlightKey}`;
          }).map((arc) => (
            <Line
              key={arc.key}
              from={arc.from as [number, number]}
              to={arc.to as [number, number]}
              stroke={arc.color}
              strokeWidth={arc.strokeWidth * s}
              strokeLinecap="round"
              style={{
                pointerEvents: "none",
                ...(arc.isDashed ? { strokeDasharray: "4,4" } : {}),
                opacity: 0.8,
              }}
            />
          ))}

          {/* Airport Markers */}
          {(() => {
            const visibleAirportCodes = new Set<string>();
            if (selectedAirportCode) {
              visibleAirportCodes.add(selectedAirportCode);
              arcsData.forEach(arc => {
                if (arc.fromCode === selectedAirportCode) visibleAirportCodes.add(arc.toCode);
                if (arc.toCode === selectedAirportCode) visibleAirportCodes.add(arc.fromCode);
              });
            } else if (selectedFlightKey) {
              arcsData.forEach(arc => {
                if (arc.key === `arc-${selectedFlightKey}`) {
                  visibleAirportCodes.add(arc.fromCode);
                  visibleAirportCodes.add(arc.toCode);
                }
              });
            }

            return airportsList.map((point) => {
              const util = computeUtilizationPercent(point.currentStock, point.warehouseCapacity);
              const level = getOccupancyLevel(util);
              const color = getOccupancyColor(util);
              // Filter warehouses based on occupancy level
              const filterMatch = activeFilters[level].warehouse;
              // If a warehouse or flight is selected, only show related warehouses
              const selectionMatch = (!selectedAirportCode && !selectedFlightKey) || visibleAirportCodes.has(point.code);
              if (!filterMatch || !selectionMatch) return null;
              return (
              <Marker key={point.code} coordinates={[point.lng, point.lat]}>
                <g
                  style={{ cursor: "pointer" }}
                  transform={`scale(${s * WAREHOUSE_SCALE})`}
                  onClick={() => {
                    if (onSelectAirport) onSelectAirport(point.code);
                  }}
                  onMouseEnter={(e) => {
                    setHovered({
                      kind: "airport",
                      code: point.code,
                      city: point.city,
                      stock: point.currentStock,
                      capacity: point.warehouseCapacity,
                      utilization: util,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onMouseLeave={() => setHovered(null)}
                >
                  <AirportTower3D color={color} util={util} isDark={isDark} />
                  <text
                    textAnchor="middle"
                    y={10}
                    style={{ fill: labelFill, fontSize: `${Math.max(4, 3 + position.zoom * 0.8)}px`, pointerEvents: "none", textShadow: "0px 0px 2px rgba(0,0,0,0.5)" }}
                  >
                    {point.code}
                  </text>
                  </g>
                </Marker>
              );
            });
          })()}

          {/* Plane Markers */}
          {planesData.filter(plane => {
            const validCoords = typeof plane.lng === "number" && typeof plane.lat === "number" && !isNaN(plane.lng) && !isNaN(plane.lat);
            if (!validCoords) return false;
            if (selectedAirportCode) {
              // Show only planes connected to the selected airport
              return plane.fromCode === selectedAirportCode || plane.toCode === selectedAirportCode;
            }
            return !selectedFlightKey || selectedPedido || plane.key === selectedFlightKey;
          }).map((plane) => {
            const planeUtil = plane.utilization ?? 0;
            const planeColor = getOccupancyColor(planeUtil);
            const planeStroke = getOccupancyPlaneStroke(planeUtil);
            return (
              <Marker key={`plane-${plane.key}`} coordinates={[plane.lng, plane.lat]}>
                <g
                  style={{ cursor: "pointer" }}
                  transform={`scale(${s * PLANE_SCALE})`}
                  onMouseEnter={(e) => {
                    setHovered({
                      kind: "flight",
                      from: plane.fromCode,
                      to: plane.toCode,
                      departureTime: plane.departureTime,
                      load: plane.cantMaletas,
                      capacity: plane.capacity,
                      utilization: planeUtil,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    if (onSelectFlight) {
                      onSelectFlight(plane.pedidoIds, plane.key);
                    }
                  }}
                >
                  <g transform={`translate(0, 0.4) rotate(${plane.heading})`}>
                    <PlaneIcon color={planeColor} stroke={planeStroke} />
                  </g>
                </g>
              </Marker>
            );
          })}

          {/* Render labels on top of everything */}
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const countryNameEn = geo.properties.name || "";
                const translatedName = translateCountry(countryNameEn);
                const isCountryActive = airportsList.some(
                  (a) => checkCountryMatch(a.country, countryNameEn)
                );
                
                if (!settings.showCountryNames || !isCountryActive) return null;
                const centroid = geoCentroid(geo);
                
                return (
                  <Marker key={`label-${geo.rsmKey}`} coordinates={centroid}>
                    <g transform={`scale(${s})`}>
                      <text
                        textAnchor="middle"
                        y={-8}
                        style={{
                          fill: isDark ? "#ffffff" : "#1e3a5f",
                          fontSize: "6px",
                          pointerEvents: "none",
                          opacity: 0.85,
                          fontWeight: "bold",
                          textShadow: isDark
                            ? "0px 0px 3px rgba(0,0,0,0.8)"
                            : "0px 0px 3px rgba(255,255,255,0.8)",
                        }}
                      >
                        {translatedName}
                      </text>
                    </g>
                  </Marker>
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltips */}
      {hovered && hovered.kind === "airport" && (
        <div
          className={`fixed z-50 border rounded-lg px-3 py-2 pointer-events-none ${tooltipBg}`}
          style={{ left: hovered.x + 12, top: hovered.y - 10 }}
        >
          <div className={`text-[11px] font-semibold ${tooltipTitle}`}>{hovered.city} ({hovered.code})</div>
          <div className={`text-[10px] mt-1 ${tooltipSub}`}>
            Uso: <span className={tooltipVal}>{hovered.stock}</span> / {hovered.capacity} maletas
          </div>
          <div className={`text-[10px] ${tooltipSub}`}>
            Ocupación: <span className={getOccupancyTextClass(hovered.utilization)}>{hovered.utilization.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {hovered && hovered.kind === "flight" && (
        <div
          className={`fixed z-50 border rounded-lg px-3 py-2 pointer-events-none ${tooltipBg}`}
          style={{ left: hovered.x + 12, top: hovered.y - 10 }}
        >
          <div className={`text-[11px] font-semibold ${tooltipTitle}`}>{hovered.from}-{hovered.to}-{hovered.departureTime}</div>
          <div className={`text-[10px] mt-1 ${tooltipSub}`}>
            Uso: <span className={tooltipVal}>{hovered.load}</span> / {hovered.capacity} maletas
          </div>
          <div className={`text-[10px] ${tooltipSub}`}>
            Ocupación: <span className={getOccupancyTextClass(hovered.utilization)}>{hovered.utilization.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
