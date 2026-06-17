import React, { useState, useMemo } from "react";
import { OCCUPANCY_COLORS, type OccupancyLevel } from "../engine/occupancyStatus";
import { Plane, Warehouse, X } from "lucide-react";

export type OccupancyFilters = {
  empty: { warehouse: boolean; flight: boolean };
  normal: { warehouse: boolean; flight: boolean };
  moderate: { warehouse: boolean; flight: boolean };
  saturated: { warehouse: boolean; flight: boolean };
  routes: { intracontinental: boolean; intercontinental: boolean };
};

interface OccupancyLegendProps {
  isDark: boolean;
  subText: string;
  showFlightRoutes?: boolean;
  borderClass?: string;
  filters?: OccupancyFilters;
  onFiltersChange?: (filters: OccupancyFilters) => void;
}

/** Leyenda "Estado" — almacenes, aviones y rutas (simulación / tracking). */
export function OccupancyLegend({
  isDark,
  subText,
  showFlightRoutes = true,
  borderClass,
  filters: externalFilters,
  onFiltersChange,
}: OccupancyLegendProps) {
  const defaultFilters: OccupancyFilters = {
    empty: { warehouse: true, flight: true },
    normal: { warehouse: true, flight: true },
    moderate: { warehouse: true, flight: true },
    saturated: { warehouse: true, flight: true },
    routes: { intracontinental: true, intercontinental: true },
  };

  const [internalFilters, setInternalFilters] = useState<OccupancyFilters>(defaultFilters);
  const filters = externalFilters ?? internalFilters;

  const updateFilters = (newFilters: OccupancyFilters) => {
    setInternalFilters(newFilters);
    onFiltersChange?.(newFilters);
  };

  const toggleFilter = (level: OccupancyLevel, type: "warehouse" | "flight") => {
    const updated = { ...filters };
    updated[level][type] = !updated[level][type];
    updateFilters(updated);
  };

  const toggleRouteFilter = (type: "intracontinental" | "intercontinental") => {
    const updated = { ...filters };
    updated.routes[type] = !updated.routes[type];
    updateFilters(updated);
  };

  const allSelected = useMemo(() => {
    return Object.values(filters).every((f) => f.warehouse && f.flight);
  }, [filters]);

  const allOccupancySelected = useMemo(() => {
    return filters.empty.warehouse && filters.empty.flight &&
           filters.normal.warehouse && filters.normal.flight &&
           filters.moderate.warehouse && filters.moderate.flight &&
           filters.saturated.warehouse && filters.saturated.flight;
  }, [filters]);

  const allRoutesSelected = useMemo(() => {
    return filters.routes.intracontinental && filters.routes.intercontinental;
  }, [filters]);

  const clearAll = () => {
    updateFilters(defaultFilters);
  };

  const deselectAll = () => {
    const clearedFilters: OccupancyFilters = {
      empty: { warehouse: false, flight: false },
      normal: { warehouse: false, flight: false },
      moderate: { warehouse: false, flight: false },
      saturated: { warehouse: false, flight: false },
      routes: { intracontinental: false, intercontinental: false },
    };
    updateFilters(clearedFilters);
  };

  const divider = borderClass ?? (isDark ? "border-[#1a2744]" : "border-[#cbd5e1]");
  const btnBase = `w-5 h-5 rounded flex items-center justify-center text-[10px] font-medium transition-all cursor-pointer`;
  const btnActive = isDark ? "bg-blue-600 text-white" : "bg-blue-500 text-white";
  const btnInactive = isDark ? "bg-[#2d3748] text-[#718096]" : "bg-[#e2e8f0] text-[#a0aec0]";

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <p className={`text-[9px] ${subText}`}>Almacenes y aviones</p>
        {allOccupancySelected ? (
          <button
            onClick={() => {
              const updated = { ...filters };
              updated.empty.warehouse = false;
              updated.empty.flight = false;
              updated.normal.warehouse = false;
              updated.normal.flight = false;
              updated.moderate.warehouse = false;
              updated.moderate.flight = false;
              updated.saturated.warehouse = false;
              updated.saturated.flight = false;
              updateFilters(updated);
            }}
            className={`text-[8px] px-1.5 py-0.5 rounded transition-colors ${
              isDark
                ? "bg-[#2d3748] hover:bg-[#4a5568] text-[#cbd5e1]"
                : "bg-[#e2e8f0] hover:bg-[#cbd5e1] text-[#475569]"
            }`}
            title="Deseleccionar todas las opciones de ocupación"
          >
            Deseleccionar todas
          </button>
        ) : (
          <button
            onClick={() => {
              const updated = { ...filters };
              updated.empty.warehouse = true;
              updated.empty.flight = true;
              updated.normal.warehouse = true;
              updated.normal.flight = true;
              updated.moderate.warehouse = true;
              updated.moderate.flight = true;
              updated.saturated.warehouse = true;
              updated.saturated.flight = true;
              updateFilters(updated);
            }}
            className={`text-[8px] px-1.5 py-0.5 rounded transition-colors ${
              isDark
                ? "bg-[#2d3748] hover:bg-[#4a5568] text-[#cbd5e1]"
                : "bg-[#e2e8f0] hover:bg-[#cbd5e1] text-[#475569]"
            }`}
            title="Restablecer opciones de ocupación"
          >
            Restablecer
          </button>
        )}
      </div>

      {/* Empty state */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: OCCUPANCY_COLORS.empty }}
        />
        <span className={`text-[10px] ${subText}`}>Vacío (0%)</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => toggleFilter("empty", "warehouse")}
            className={`${btnBase} ${filters.empty.warehouse ? btnActive : btnInactive}`}
            title="Filtrar almacenes vacíos"
          >
            <Warehouse size={14} />
          </button>
          <button
            onClick={() => toggleFilter("empty", "flight")}
            className={`${btnBase} ${filters.empty.flight ? btnActive : btnInactive}`}
            title="Filtrar vuelos vacíos"
          >
            <Plane size={14} />
          </button>
        </div>
      </div>

      {/* Normal state */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: OCCUPANCY_COLORS.normal }}
        />
        <span className={`text-[10px] ${subText}`}>Normal (&lt; 50%)</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => toggleFilter("normal", "warehouse")}
            className={`${btnBase} ${filters.normal.warehouse ? btnActive : btnInactive}`}
            title="Filtrar almacenes normales"
          >
            <Warehouse size={14} />
          </button>
          <button
            onClick={() => toggleFilter("normal", "flight")}
            className={`${btnBase} ${filters.normal.flight ? btnActive : btnInactive}`}
            title="Filtrar vuelos normales"
          >
            <Plane size={14} />
          </button>
        </div>
      </div>

      {/* Moderate state */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: OCCUPANCY_COLORS.moderate }}
        />
        <span className={`text-[10px] ${subText}`}>Moderado (50-80%)</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => toggleFilter("moderate", "warehouse")}
            className={`${btnBase} ${filters.moderate.warehouse ? btnActive : btnInactive}`}
            title="Filtrar almacenes moderados"
          >
            <Warehouse size={14} />
          </button>
          <button
            onClick={() => toggleFilter("moderate", "flight")}
            className={`${btnBase} ${filters.moderate.flight ? btnActive : btnInactive}`}
            title="Filtrar vuelos moderados"
          >
            <Plane size={14} />
          </button>
        </div>
      </div>

      {/* Saturated state */}
      <div className={`flex items-center gap-1.5 ${showFlightRoutes ? "mb-2" : ""}`}>
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: OCCUPANCY_COLORS.saturated }}
        />
        <span className={`text-[10px] ${subText}`}>Saturado (≥ 80%)</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => toggleFilter("saturated", "warehouse")}
            className={`${btnBase} ${filters.saturated.warehouse ? btnActive : btnInactive}`}
            title="Filtrar almacenes saturados"
          >
            <Warehouse size={14} />
          </button>
          <button
            onClick={() => toggleFilter("saturated", "flight")}
            className={`${btnBase} ${filters.saturated.flight ? btnActive : btnInactive}`}
            title="Filtrar vuelos saturados"
          >
            <Plane size={14} />
          </button>
        </div>
      </div>

      {showFlightRoutes && (
        <div className={`border-t pt-2 mb-1 ${divider}`}>
          <div className="flex items-center justify-between mb-1.5">
            <p className={`text-[9px] ${subText}`}>Rutas de vuelo</p>
            {allRoutesSelected ? (
              <button
                onClick={() => {
                  const updated = { ...filters };
                  updated.routes.intracontinental = false;
                  updated.routes.intercontinental = false;
                  updateFilters(updated);
                }}
                className={`text-[8px] px-1.5 py-0.5 rounded transition-colors ${
                  isDark
                    ? "bg-[#2d3748] hover:bg-[#4a5568] text-[#cbd5e1]"
                    : "bg-[#e2e8f0] hover:bg-[#cbd5e1] text-[#475569]"
                }`}
                title="Deseleccionar todas las rutas"
              >
                Deseleccionar todas
              </button>
            ) : (
              <button
                onClick={() => {
                  const updated = { ...filters };
                  updated.routes.intracontinental = true;
                  updated.routes.intercontinental = true;
                  updateFilters(updated);
                }}
                className={`text-[8px] px-1.5 py-0.5 rounded transition-colors ${
                  isDark
                    ? "bg-[#2d3748] hover:bg-[#4a5568] text-[#cbd5e1]"
                    : "bg-[#e2e8f0] hover:bg-[#cbd5e1] text-[#475569]"
                }`}
                title="Seleccionar todas las rutas"
              >
                Restablecer
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mb-1 ml-auto">
            <div className={`w-5 h-0.5 rounded ${isDark ? "bg-[#22d3ee]" : "bg-[#0891b2]"}`} />
            <span className={`text-[10px] ${subText}`}>Mismo continente</span>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => toggleRouteFilter("intracontinental")}
                className={`${btnBase} ${filters.routes.intracontinental ? btnActive : btnInactive}`}
                title="Filtrar rutas intracontinentales"
              >
                {filters.routes.intracontinental ? "✓" : "✕"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <div className={`w-5 h-0.5 rounded ${isDark ? "bg-[#fb7185]" : "bg-[#e11d48]"}`} />
            <span className={`text-[10px] ${subText}`}>Distinto continente</span>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => toggleRouteFilter("intercontinental")}
                className={`${btnBase} ${filters.routes.intercontinental ? btnActive : btnInactive}`}
                title="Filtrar rutas intercontinentales"
              >
                {filters.routes.intercontinental ? "✓" : "✕"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
