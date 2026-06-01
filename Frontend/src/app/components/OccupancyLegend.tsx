import React from "react";
import { OCCUPANCY_COLORS } from "../engine/occupancyStatus";

interface OccupancyLegendProps {
  isDark: boolean;
  subText: string;
  showFlightRoutes?: boolean;
  borderClass?: string;
}

/** Leyenda "Estado" — almacenes, aviones y rutas (simulación / tracking). */
export function OccupancyLegend({
  isDark,
  subText,
  showFlightRoutes = true,
  borderClass,
}: OccupancyLegendProps) {
  const divider = borderClass ?? (isDark ? "border-[#1a2744]" : "border-[#cbd5e1]");

  return (
    <>
      <p className={`text-[9px] mb-2 ${subText}`}>Almacenes y aviones</p>
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: OCCUPANCY_COLORS.normal }}
        />
        <span className={`text-[10px] ${subText}`}>Capacidad Normal (&lt; 50%)</span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: OCCUPANCY_COLORS.moderate }}
        />
        <span className={`text-[10px] ${subText}`}>
          Capacidad Moderada (≥ 50% y &lt; 80%)
        </span>
      </div>
      <div className={`flex items-center gap-2 ${showFlightRoutes ? "mb-2" : ""}`}>
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: OCCUPANCY_COLORS.saturated }}
        />
        <span className={`text-[10px] ${subText}`}>Saturado (≥ 80%)</span>
      </div>
      {showFlightRoutes && (
        <div className={`border-t pt-2 mb-1 ${divider}`}>
          <p className={`text-[9px] mb-1.5 ${subText}`}>Rutas de vuelo</p>
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-5 h-0.5 rounded ${isDark ? "bg-[#22d3ee]" : "bg-[#0891b2]"}`} />
            <span className={`text-[10px] ${subText}`}>Mismo continente</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-5 h-0.5 rounded ${isDark ? "bg-[#fb7185]" : "bg-[#e11d48]"}`} />
            <span className={`text-[10px] ${subText}`}>Distinto continente</span>
          </div>
        </div>
      )}
    </>
  );
}
