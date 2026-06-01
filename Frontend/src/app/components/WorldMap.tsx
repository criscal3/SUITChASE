import React, { useMemo } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { computeUtilizationPercent, getOccupancyColor } from "../engine/occupancyStatus";

function latLngToXY(lat: number, lng: number, width: number, height: number) {
  const x = ((lng + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

const CONTINENT_COLORS: Record<string, string> = {
  America: "#3b82f6",
  Europa: "#8b5cf6",
  Asia: "#f59e0b",
};

export function WorldMap() {
  const { state, airportsList } = useSim();
  const { isDark } = useTheme();
  const W = 900;
  const H = 480;

  const airportPositions = useMemo(() => {
    return airportsList.map(a => ({
      ...a,
      ...latLngToXY(a.lat, a.lng, W, H),
    }));
  }, [airportsList]);

  // Get active flight lines
  const activeFlights = useMemo(() => {
    const lines: { from: typeof airportPositions[0]; to: typeof airportPositions[0]; progress: number; qty: number }[] = [];
    for (const bg of state.baggageGroups) {
      if (bg.status !== "in_transit" || bg.currentLegIndex >= bg.route.length) continue;
      const leg = bg.route[bg.currentLegIndex];
      const from = airportPositions.find(a => a.code === leg.from);
      const to = airportPositions.find(a => a.code === leg.to);
      if (!from || !to) continue;
      const totalTime = leg.arrivalTime - leg.departureTime;
      const elapsed = state.currentTime - leg.departureTime;
      const progress = Math.min(1, Math.max(0, elapsed / totalTime));
      lines.push({ from, to, progress, qty: bg.quantity });
    }
    return lines;
  }, [state.currentTime, state.baggageGroups, airportPositions]);

  return (
    <div className="bg-[#0f172a] rounded-xl overflow-hidden border border-[#1e293b]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Grid */}
        <defs>
          <pattern id="grid" width="45" height="40" patternUnits="userSpaceOnUse">
            <path d="M 45 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />

        {/* Continent labels */}
        <text x="180" y="180" fill="#3b82f680" className="text-[14px]" textAnchor="middle">AMÉRICA</text>
        <text x="500" y="130" fill="#8b5cf680" className="text-[14px]" textAnchor="middle">EUROPA</text>
        <text x="720" y="170" fill="#f59e0b80" className="text-[14px]" textAnchor="middle">ASIA</text>

        {/* Flight routes (static) */}
        {state.flights.filter(f => !f.cancelled).map((f, i) => {
          const from = airportPositions.find(a => a.code === f.origin);
          const to = airportPositions.find(a => a.code === f.destination);
          if (!from || !to) return null;
          return (
            <line
              key={`route-${i}`}
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke="#334155"
              strokeWidth="0.3"
              opacity="0.3"
            />
          );
        })}

        {/* Active transits */}
        {activeFlights.map((f, i) => {
          const px = f.from.x + (f.to.x - f.from.x) * f.progress;
          const py = f.from.y + (f.to.y - f.from.y) * f.progress;
          const traceColor = isDark ? "#60a5fa" : "#1e3a8a";
          return (
            <g key={`active-${i}`}>
              <line
                x1={f.from.x} y1={f.from.y}
                x2={f.to.x} y2={f.to.y}
                stroke={traceColor}
                strokeWidth="1"
                opacity="0.6"
              />
              <circle cx={px} cy={py} r={Math.min(5, 2 + f.qty / 20)} fill={traceColor}>
                <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </g>
          );
        })}

        {/* Airports */}
        {airportPositions.map(a => {
          const apState = state.airports[a.code];
          const utilization = apState
            ? computeUtilizationPercent(apState.currentStock, apState.capacity)
            : 0;
          const color = getOccupancyColor(utilization);
          const r = Math.max(4, Math.min(8, 4 + (apState?.currentStock || 0) / 50));
          return (
            <g key={a.code}>
              <circle cx={a.x} cy={a.y} r={r + 2} fill={color} opacity="0.2" />
              <circle cx={a.x} cy={a.y} r={r} fill={color} stroke="#fff" strokeWidth="0.5" />
              <text
                x={a.x}
                y={a.y - r - 3}
                fill="#94a3b8"
                textAnchor="middle"
                className="text-[7px]"
              >
                {a.code}
              </text>
              {apState && apState.currentStock > 0 && (
                <text
                  x={a.x}
                  y={a.y + r + 9}
                  fill="#cbd5e1"
                  textAnchor="middle"
                  className="text-[6px]"
                >
                  {apState.currentStock}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
