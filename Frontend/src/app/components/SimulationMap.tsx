import React, { useMemo, useState, useEffect } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup, Line } from "react-simple-maps";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import type { BaggageGroup } from "../engine/types";
import { resolveFlightCapacity } from "../engine/backendAdapter";
import {
  computeUtilizationPercent,
  getOccupancyColor,
  getOccupancyPlaneStroke,
  getOccupancyTextClass,
  getOccupancyLevel,
} from "../engine/occupancyStatus";
import type { OccupancyFilters } from "./OccupancyLegend";

interface SimMapProps {
  onSelectBaggage?: (bg: BaggageGroup | null) => void;
  selectedBaggage?: BaggageGroup | null;
  onSelectFlight?: (baggageGroupIds: string[] | null, flightKey: string | null) => void;
  selectedFlightKey?: string | null;
  filters?: OccupancyFilters;
}

interface HoveredAirport {
  kind: "airport";
  code: string;
  city: string;
  stock: number;
  capacity: number;
  utilization: number;
  x: number;
  y: number;
}

interface HoveredFlight {
  kind: "flight";
  from: string;
  to: string;
  load: number;
  capacity: number;
  utilization: number;
  x: number;
  y: number;
}

type HoveredItem = HoveredAirport | HoveredFlight;

function getArcColor(intercontinental: boolean, isDark: boolean) {
  if (intercontinental) {
    return isDark ? "#fb7185" : "#e11d48";
  }
  return isDark ? "#22d3ee" : "#0891b2";
}

function isIntercontinentalRoute(
  fromCode: string,
  toCode: string,
  airportsList: { code: string; continent: string }[]
): boolean {
  const from = airportsList.find((a) => a.code === fromCode);
  const to = airportsList.find((a) => a.code === toCode);
  if (!from || !to) return false;
  return from.continent !== to.continent;
}

function computeFlightMetrics(
  claveVuelo: string | undefined,
  flightOccupancy: Record<string, number>,
  flightCapacities: Record<string, number>
) {
  const load = claveVuelo ? flightOccupancy[claveVuelo] ?? 0 : 0;
  const capacity = resolveFlightCapacity(claveVuelo, flightCapacities, flightCapacities);
  const utilization = computeUtilizationPercent(load, capacity);
  return { load, capacity, utilization };
}

// Spherical linear interpolation for plane positions
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

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const PLANE_SCALE = 0.60;
const WAREHOUSE_SCALE = 0.80;

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

export function SimulationMap({ onSelectBaggage, selectedBaggage, onSelectFlight, selectedFlightKey, filters }: SimMapProps) {
  const { state, airportsList } = useSim();
  const { isDark } = useTheme();
  const [position, setPosition] = useState({ coordinates: [0, 20] as [number, number], zoom: 1 });
  const [hovered, setHovered] = useState<HoveredItem | null>(null);

  const defaultFilters: OccupancyFilters = {
    empty: { warehouse: true, flight: true },
    normal: { warehouse: true, flight: true },
    moderate: { warehouse: true, flight: true },
    saturated: { warehouse: true, flight: true },
    routes: { intracontinental: true, intercontinental: true },
  };

  const activeFilters = filters ?? defaultFilters;

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

  useEffect(() => {
    if (selectedBaggage) {
      const leg = selectedBaggage.route[selectedBaggage.currentLegIndex] || selectedBaggage.route[0];
      if (leg) {
        const port = airportsList.find((a) => a.code === leg.from);
        if (port) {
          setPosition({ coordinates: [port.lng, port.lat], zoom: 2.5 });
        }
      }
    }
  }, [selectedBaggage, airportsList]);

  const pointsData = useMemo(() => {
    return airportsList
      .map((a) => {
        const ap = state.airports[a.code];
        const util = ap
          ? computeUtilizationPercent(ap.currentStock, ap.capacity)
          : 0;
        const level = getOccupancyLevel(util);
        return {
          ...a,
          utilization: util,
          color: getOccupancyColor(util),
          label: `${a.city} (${a.code}) - ${ap?.currentStock || 0}/${ap?.capacity || 0} maletas`,
          level,
        };
      })
      .filter((point) => {
        // Filter warehouses based on active filters
        return activeFilters[point.level].warehouse;
      });
  }, [state.airports, state.currentTime, airportsList, activeFilters]);

  const showFlightHover = (flight: Omit<HoveredFlight, "kind" | "x" | "y">, e: React.MouseEvent) => {
    setHovered({ kind: "flight", ...flight, x: e.clientX, y: e.clientY });
  };

  const { arcsData, planesData } = useMemo(() => {
    const arcs: any[] = [];
    const activePlanes: any[] = [];
    const { flightOccupancy, flightCapacities } = state;

    if (selectedBaggage) {
      for (let i = 0; i < selectedBaggage.route.length; i++) {
        const leg = selectedBaggage.route[i];
        const from = airportsList.find((a) => a.code === leg.from);
        const to = airportsList.find((a) => a.code === leg.to);
        if (from && to) {
          arcs.push({
            from: [from.lng, from.lat],
            to: [to.lng, to.lat],
            color: "#ff8800",
            strokeWidth: 2,
            isDashed: true,
            key: `sel-${i}`,
          });
        }
      }
    }

    const activeRoutesMap = new Map<string, {
      from: typeof airportsList[0];
      to: typeof airportsList[0];
      qty: number;
      claveVuelo?: string;
      fromCode: string;
      toCode: string;
      intercontinental: boolean;
      load: number;
      capacity: number;
      utilization: number;
    }>();
    const failedRoutesMap = new Map<string, { from: typeof airportsList[0]; to: typeof airportsList[0]; qty: number; registeredAt: number }>();

    const baggagesToRender = selectedBaggage
      ? state.baggageGroups.filter(bg => bg.id === selectedBaggage.id)
      : state.baggageGroups;

    for (const bg of baggagesToRender) {
      if (bg.status === "failed") {
        if (state.currentTime < bg.registeredAt) continue;

        const from = airportsList.find((a) => a.code === bg.origin);
        const to = airportsList.find((a) => a.code === bg.destination);
        if (from && to) {
          const key = `${bg.origin}-${bg.destination}`;
          const existing = failedRoutesMap.get(key);
          if (existing) {
            existing.qty += bg.quantity;
            existing.registeredAt = Math.max(existing.registeredAt, bg.registeredAt);
          } else {
            failedRoutesMap.set(key, { from, to, qty: bg.quantity, registeredAt: bg.registeredAt });
          }
        }
        continue;
      }

      if (bg.status !== "in_transit" || !bg.route || bg.route.length === 0) continue;

      for (let legIdx = 0; legIdx < bg.route.length; legIdx++) {
        const leg = bg.route[legIdx];

        if (state.currentTime < leg.departureTime || state.currentTime > leg.arrivalTime) continue;

        const from = airportsList.find((a) => a.code === leg.from);
        const to = airportsList.find((a) => a.code === leg.to);
        if (!from || !to) continue;

        const total = leg.arrivalTime - leg.departureTime;
        if (total <= 0) continue;
        const progress = (state.currentTime - leg.departureTime) / total;
        const routeKey = leg.claveVuelo || `${leg.from}-${leg.to}-${leg.departureTime}`;
        const intercontinental = isIntercontinentalRoute(leg.from, leg.to, airportsList);
        const metrics = computeFlightMetrics(leg.claveVuelo, flightOccupancy, flightCapacities);

        const existing = activeRoutesMap.get(routeKey);
        if (existing) {
          existing.qty += bg.quantity;
        } else {
          activeRoutesMap.set(routeKey, {
            from,
            to,
            qty: bg.quantity,
            claveVuelo: leg.claveVuelo,
            fromCode: leg.from,
            toCode: leg.to,
            intercontinental,
            ...metrics,
          });
        }

        const pos = interpolateGreatCircle(from.lat, from.lng, to.lat, to.lng, progress);
        const delta = Math.min(0.01, 1 - progress);
        const posAhead = interpolateGreatCircle(from.lat, from.lng, to.lat, to.lng, progress + delta);
        const heading = getHeading(pos.lat, pos.lng, posAhead.lat, posAhead.lng);

        activePlanes.push({
          lat: pos.lat,
          lng: pos.lng,
          heading,
          qty: bg.quantity,
          flightId: leg.flightId,
          routeKey,
          fromCode: leg.from,
          toCode: leg.to,
          claveVuelo: leg.claveVuelo,
          intercontinental,
          baggageGroupIds: [bg.id],
          ...metrics,
        });
        break;
      }
    }

    const planesMap = new Map<string, any>();
    for (const p of activePlanes) {
      const key = p.routeKey || p.flightId;
      if (planesMap.has(key)) {
        const existing = planesMap.get(key);
        existing.baggageGroupIds.push(...p.baggageGroupIds);
      } else {
        planesMap.set(key, { ...p });
      }
    }
    
    const uniquePlanes = Array.from(planesMap.values()).filter((plane) => {
      // Filter flights based on occupancy level and active filters
      const planeLevel = getOccupancyLevel(plane.utilization ?? 0);
      if (!activeFilters[planeLevel].flight) return false;

      // Filter based on route type (intracontinental vs intercontinental)
      if (plane.intercontinental && !activeFilters.routes.intercontinental) return false;
      if (!plane.intercontinental && !activeFilters.routes.intracontinental) return false;

      return true;
    });

    const failedRouteColor = "#ef4444";

    for (const [key, val] of Array.from(activeRoutesMap.entries())) {
      // Filter arcs based on flight occupancy level
      const routeLevel = getOccupancyLevel(val.utilization ?? 0);
      if (activeFilters[routeLevel].flight) {
        // Filter based on route type (intracontinental vs intercontinental)
        if (val.intercontinental && activeFilters.routes.intercontinental) {
          arcs.push({
            from: [val.from.lng, val.from.lat],
            to: [val.to.lng, val.to.lat],
            color: getArcColor(val.intercontinental, isDark),
            strokeWidth: 1 + Math.min(2, val.qty / 100),
            isActive: true,
            key: `act-${key}`,
          });
        } else if (!val.intercontinental && activeFilters.routes.intracontinental) {
          arcs.push({
            from: [val.from.lng, val.from.lat],
            to: [val.to.lng, val.to.lat],
            color: getArcColor(val.intercontinental, isDark),
            strokeWidth: 1 + Math.min(2, val.qty / 100),
            isActive: true,
            key: `act-${key}`,
          });
        }
      }
    }

    for (const [key, val] of Array.from(failedRoutesMap.entries())) {
      const ageHours = (state.currentTime - val.registeredAt) / 3600000;
      if (ageHours > 6) continue;

      arcs.push({
        from: [val.from.lng, val.from.lat],
        to: [val.to.lng, val.to.lat],
        color: failedRouteColor,
        strokeWidth: 1.5,
        isDashed: true,
        key: `fail-${key}`,
      });
    }

    return { arcsData: arcs, planesData: uniquePlanes };
  }, [state.baggageGroups, state.currentTime, state.flightOccupancy, state.flightCapacities, selectedBaggage, isDark, airportsList, activeFilters]);

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
                opacity: arc.isBackground ? 0.3 : 0.8,
              }}
            />
          ))}

          {pointsData.map((point) => (
            <Marker key={point.code} coordinates={[point.lng, point.lat]}>
              <g
                style={{ cursor: "pointer" }}
                transform={`scale(${s * WAREHOUSE_SCALE})`}
                onClick={() => setPosition({ coordinates: [point.lng, point.lat], zoom: 3 })}
                onMouseEnter={(e) => {
                  const ap = state.airports[point.code];
                  setHovered({
                    kind: "airport",
                    code: point.code,
                    city: point.city,
                    stock: ap?.currentStock || 0,
                    capacity: ap?.capacity || 0,
                    utilization: point.utilization,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                onMouseLeave={() => setHovered(null)}
              >
                <Building3D color={point.color} util={point.utilization} />
                <text
                  textAnchor="middle"
                  y={10}
                  style={{ fill: labelFill, fontSize: `${Math.max(4, 3 + position.zoom * 0.8)}px`, pointerEvents: "none", textShadow: "0px 0px 2px rgba(0,0,0,0.5)" }}
                >
                  {point.code}
                </text>
              </g>
            </Marker>
          ))}

          {planesData.map((plane) => {
            const planeUtil = plane.utilization ?? 0;
            const planeColor = getOccupancyColor(planeUtil);
            const planeStroke = getOccupancyPlaneStroke(planeUtil);
            return (
              <Marker key={`plane-${plane.routeKey || plane.flightId}`} coordinates={[plane.lng, plane.lat]}>
                <g
                  style={{ cursor: "pointer" }}
                  transform={`scale(${s * PLANE_SCALE})`}
                  onMouseEnter={(e) => {
                    showFlightHover({
                      from: plane.fromCode,
                      to: plane.toCode,
                      load: plane.load ?? 0,
                      capacity: plane.capacity ?? 0,
                      utilization: plane.utilization ?? 0,
                    }, e);
                  }}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    if (onSelectFlight) {
                      onSelectFlight(plane.baggageGroupIds, plane.routeKey || plane.flightId);
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
        </ZoomableGroup>
      </ComposableMap>

      {hovered && hovered.kind === "airport" && (
        <div
          className={`fixed z-50 border rounded-lg px-3 py-2 pointer-events-none ${tooltipBg}`}
          style={{ left: hovered.x + 12, top: hovered.y - 10 }}
        >
          <div className={`text-[11px] ${tooltipTitle}`}>{hovered.city} ({hovered.code})</div>
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
          <div className={`text-[11px] ${tooltipTitle}`}>{hovered.from} → {hovered.to}</div>
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
