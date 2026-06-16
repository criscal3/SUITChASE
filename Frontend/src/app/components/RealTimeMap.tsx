import React, { useMemo, useState, useEffect } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup, Line } from "react-simple-maps";
import { useTheme } from "../context/ThemeContext";
import {
  getOccupancyColor,
  getOccupancyPlaneStroke,
  getOccupancyTextClass,
  computeUtilizationPercent,
} from "../engine/occupancyStatus";

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
}

interface RealTimeMapProps {
  pedidos: Pedido[];
  selectedPedido: Pedido | null;
  onSelectPedido: (p: Pedido | null) => void;
  airportsList: Airport[];
  onSelectFlight?: (pedidoIds: string[] | null, flightKey: string | null) => void;
  selectedFlightKey?: string | null;
  flightsList?: any[];
}

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const PLANE_SCALE = 0.72;

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

function Building3D({ color, util }: { color: string; util: number }) {
  const h = 8 + (Math.min(100, util) / 100) * 16;
  return (
    <g>
      <path d={`M0,3 L-6,0 L-6,-${h} L0,-${h + 3} Z`} fill={color} opacity={0.8} />
      <path d={`M0,3 L6,0 L6,-${h} L0,-${h + 3} Z`} fill={color} opacity={0.6} />
      <path d={`M0,-${h + 3} L-6,-${h} L0,-${h + 6} L6,-${h} Z`} fill={color} />
    </g>
  );
}

function getRealTimeFlightCapacity(
  origin: string,
  destination: string,
  fechaSalida: string,
  airportsList: Airport[],
  flightsList: any[]
): number {
  if (!flightsList || flightsList.length === 0) return 1000;

  // Find origin airport timezone offset
  const port = airportsList.find(a => a.code === origin);
  let gmt = 0;
  if (port && port.timezone) {
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

  const depTime = parseUTCDate(fechaSalida);
  const localMs = depTime + gmt * 3600_000;
  const d = new Date(localMs);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();

  let match = flightsList.find(f => {
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
        return fHour === hour && Math.abs(fMinute - minute) < 15;
      }
    }
    if (f.departureHour != null) {
      return Math.round(f.departureHour) === hour;
    }
    return true;
  });

  if (!match) {
    match = flightsList.find(f => {
      const fOrigin = (f.origin || f.origenOaci || "").toUpperCase();
      const fDest = (f.destination || f.destinoOaci || "").toUpperCase();
      return fOrigin === origin.toUpperCase() && fDest === destination.toUpperCase();
    });
  }

  return match ? (match.capacity || match.capacidad || 1000) : 1000;
}

export function RealTimeMap({ pedidos, selectedPedido, onSelectPedido, airportsList, onSelectFlight, selectedFlightKey, flightsList }: RealTimeMapProps) {
  const { isDark } = useTheme();
  const [position, setPosition] = useState({ coordinates: [0, 20] as [number, number], zoom: 1 });
  const [hovered, setHovered] = useState<any | null>(null);

  const s = 1 / position.zoom;
  const mapBg      = isDark ? "#060a15"  : "#c8d8e8";
  const geoFill    = isDark ? "#0c1a30"  : "#b0c4d8";
  const geoStroke  = isDark ? "#1a2744"  : "#8fafc8";
  const geoHover   = isDark ? "#0f203d"  : "#9ab8cc";
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
        const total = arrTime - depTime;
        if (total <= 0) return;

        const progress = Math.min(1, Math.max(0, (nowMs - depTime) / total));

        // Grouping key: unique for a specific flight leg at a specific time
        const flightKey = `${leg.origenOaci}-${leg.destinoOaci}-${depTime}-${arrTime}-${p.nombreAerolinea}`;

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
            lat: 0,
            lng: 0,
            heading: 0,
            fechaSalida: leg.fechaSalida,
          });
        }

        const f = flightsMap.get(flightKey)!;
        f.cantMaletas += p.cantidadMaletas;
        f.pedidoIds.push(p.id);

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
      const routeColor = sameContinent
        ? (isDark ? "#22d3ee" : "#0891b2")
        : (isDark ? "#fb7185" : "#e11d48");

      if (f.from && f.to) {
        arcs.push({
          from: f.from,
          to: f.to,
          color: routeColor,
          strokeWidth: 1.5,
          key: `arc-${f.key}`,
        });
      }
    });

    const activePlanes = Array.from(flightsMap.values()).map(f => {
      const capacity = getRealTimeFlightCapacity(f.fromCode, f.toCode, f.fechaSalida, airportsList, flightsList || []);
      const utilization = computeUtilizationPercent(f.cantMaletas, capacity);
      return {
        ...f,
        capacity,
        utilization,
      };
    });
    return { arcsData: arcs, planesData: activePlanes };
  }, [pedidos, selectedPedido, airportsList, isDark, nowMs, flightsList]);

  return (
    <div className="w-full h-full rounded-xl overflow-hidden relative transition-colors duration-200" style={{ background: mapBg }}>
      <ComposableMap projection="geoMercator" projectionConfig={{ scale: 120 }}>
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={(pos) => setPosition(pos)}
          maxZoom={10}
        >
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={geoFill}
                  stroke={geoStroke}
                  strokeWidth={0.5}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none", fill: geoHover },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>

          {/* Arcs/Lines */}
          {arcsData.map((arc) => (
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
          {airportsList.map((point) => {
            const util = computeUtilizationPercent(point.currentStock, point.warehouseCapacity);
            const color = getOccupancyColor(util);
            return (
              <Marker key={point.code} coordinates={[point.lng, point.lat]}>
                <g
                  style={{ cursor: "pointer" }}
                  transform={`scale(${s})`}
                  onClick={() => setPosition({ coordinates: [point.lng, point.lat], zoom: 3 })}
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
                  <Building3D color={color} util={util} />
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
          })}

          {/* Plane Markers */}
          {planesData.filter(plane => typeof plane.lng === "number" && typeof plane.lat === "number" && !isNaN(plane.lng) && !isNaN(plane.lat)).map((plane) => {
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
                  <g transform={`rotate(${plane.heading})`}>
                    <PlaneIcon color={planeColor} stroke={planeStroke} />
                  </g>
                </g>
              </Marker>
            );
          })}
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
          <div className={`text-[11px] font-semibold ${tooltipTitle}`}>{hovered.from} → {hovered.to}</div>
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
