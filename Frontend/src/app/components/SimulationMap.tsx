import React, { useMemo, useState, useEffect } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup, Line } from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { useMapSettings } from "../context/MapSettingsContext";
import { MapSettingsPanel } from "./MapSettingsPanel";
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
  selectedAirportCode?: string | null;
  onSelectAirport?: (code: string | null) => void;
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
  departureTime?: string;
  x: number;
  y: number;
}

type HoveredItem = HoveredAirport | HoveredFlight;

function getArcColor(isInter: boolean, isDark: boolean, getIntraColor: () => string, getInterColor: () => string) {
  return isInter ? getInterColor() : getIntraColor();
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

function getSimDepartureTimeStr(ts: number): string {
  if (!ts || isNaN(ts)) return "";
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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

export function SimulationMap({
  onSelectBaggage,
  selectedBaggage,
  onSelectFlight,
  selectedFlightKey,
  filters,
  selectedAirportCode,
  onSelectAirport,
}: SimMapProps) {
  const { state, airportsList } = useSim();
  const { isDark } = useTheme();
  const { settings, getOceanColor, getActiveCountryColor, getIntraColor, getInterColor, translateCountry, checkCountryMatch } = useMapSettings();
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

  useEffect(() => {
    if (selectedBaggage) {
      const currentLoc = selectedBaggage.currentLocation || selectedBaggage.origin;
      const port = airportsList.find((a) => a.code === currentLoc);
      if (port) {
        setPosition({ coordinates: [port.lng, port.lat], zoom: 2.5 });
      }
    }
  }, [selectedBaggage, airportsList]);

  useEffect(() => {
    if (selectedAirportCode) {
      const port = airportsList.find((a) => a.code === selectedAirportCode);
      if (port) {
        setPosition({ coordinates: [port.lng, port.lat], zoom: 3 });
      }
    }
  }, [selectedAirportCode, airportsList]);

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
        const filterMatch = activeFilters[point.level].warehouse;
        return filterMatch;
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
          const coords: [number, number][] = [];
          const steps = 30;
          for (let idx = 0; idx <= steps; idx++) {
            const t = idx / steps;
            const pos = interpolateGreatCircle(from.lat, from.lng, to.lat, to.lng, t);
            coords.push([pos.lng, pos.lat]);
          }
          arcs.push({
            from: [from.lng, from.lat],
            to: [to.lng, to.lat],
            coordinates: coords,
            fromCode: leg.from,
            toCode: leg.to,
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
        
        // Skip cancelled flights
        if (state.cancelledFlights.has(routeKey)) continue;
        
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
          departureTime: leg.departureTime,
          arrivalTime: leg.arrivalTime,
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
        const coords: [number, number][] = [];
        const steps = 30;
        for (let idx = 0; idx <= steps; idx++) {
          const t = idx / steps;
          const pos = interpolateGreatCircle(val.from.lat, val.from.lng, val.to.lat, val.to.lng, t);
          coords.push([pos.lng, pos.lat]);
        }

        // Filter based on route type (intracontinental vs intercontinental)
        if (val.intercontinental && activeFilters.routes.intercontinental) {
          arcs.push({
            from: [val.from.lng, val.from.lat],
            to: [val.to.lng, val.to.lat],
            coordinates: coords,
            fromCode: val.fromCode,
            toCode: val.toCode,
            color: getArcColor(val.intercontinental, isDark, getIntraColor, getInterColor),
            strokeWidth: 1 + Math.min(2, val.qty / 100),
            isActive: true,
            key: `act-${key}`,
          });
        } else if (!val.intercontinental && activeFilters.routes.intracontinental) {
          arcs.push({
            from: [val.from.lng, val.from.lat],
            to: [val.to.lng, val.to.lat],
            coordinates: coords,
            fromCode: val.fromCode,
            toCode: val.toCode,
            color: getArcColor(val.intercontinental, isDark, getIntraColor, getInterColor),
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

      const coords: [number, number][] = [];
      const steps = 30;
      for (let idx = 0; idx <= steps; idx++) {
        const t = idx / steps;
        const pos = interpolateGreatCircle(val.from.lat, val.from.lng, val.to.lat, val.to.lng, t);
        coords.push([pos.lng, pos.lat]);
      }

      arcs.push({
        from: [val.from.lng, val.from.lat],
        to: [val.to.lng, val.to.lat],
        coordinates: coords,
        color: failedRouteColor,
        strokeWidth: 1.5,
        isDashed: true,
        key: `fail-${key}`,
      });
    }

    return { arcsData: arcs, planesData: uniquePlanes };
  }, [state.baggageGroups, state.currentTime, state.flightOccupancy, state.flightCapacities, selectedBaggage, isDark, airportsList, activeFilters, getIntraColor, getInterColor]);

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
                  <React.Fragment key={geo.rsmKey}>
                    <Geography
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
                  </React.Fragment>
                );
              })
            }
          </Geographies>



          {arcsData.filter(arc => {
            if (selectedAirportCode) {
              // Show only arcs connected to the selected airport
              return arc.fromCode === selectedAirportCode || arc.toCode === selectedAirportCode;
            }
            return !selectedFlightKey || selectedBaggage || arc.key === `act-${selectedFlightKey}`;
          }).map((arc) => (
            <Line
              key={arc.key}
              coordinates={arc.coordinates}
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
                // In simulation, selectedFlightKey might be a routeKey, so we check if the arc key ends with it
                if (arc.key.includes(selectedFlightKey)) {
                  visibleAirportCodes.add(arc.fromCode);
                  visibleAirportCodes.add(arc.toCode);
                }
              });
            }

            return pointsData.map((point) => {
              const selectionMatch = (!selectedAirportCode && !selectedFlightKey) || visibleAirportCodes.has(point.code);
              if (!selectionMatch) return null;

              return (
              <Marker key={point.code} coordinates={[point.lng, point.lat]}>
                <g
                  style={{ cursor: "pointer" }}
                  transform={`scale(${s * WAREHOUSE_SCALE})`}
                  onClick={() => {
                    if (onSelectAirport) {
                      onSelectAirport(point.code);
                    }
                  }}
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
                  <AirportTower3D color={point.color} util={point.utilization} isDark={isDark} />
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

          {planesData.filter(plane => {
            if (selectedAirportCode) {
              // Show only planes connected to the selected airport
              return plane.fromCode === selectedAirportCode || plane.toCode === selectedAirportCode;
            }
            return !selectedFlightKey || selectedBaggage || (plane.routeKey || plane.flightId) === selectedFlightKey;
          }).map((plane) => {
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
                      departureTime: getSimDepartureTimeStr(plane.departureTime),
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
