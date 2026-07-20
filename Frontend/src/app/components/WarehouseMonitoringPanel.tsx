import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Search, X, ArrowUpDown, ChevronDown, ChevronUp,
  Warehouse, Package, Clock, MapPin, Plane
} from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { getOccupancyColor } from "../engine/occupancyStatus";

export interface WarehouseShipmentItem {
  id: string;              // Código de envío
  cant: number;            // Cantidad de maletas
  arrivedAt: string | null;      // ISO string hora llegada al almacén (UTC) — null si desconocida
  flightDeparture: string | null; // ISO string hora salida del vuelo asignado (UTC) — null si sin ruta
  isFinalDestination?: boolean;   // true si está en su destino final
}

export interface WarehouseUpcomingFlight {
  id: string;
  airportCode: string;
  timeRaw: string | number;
}

export interface WarehouseItem {
  code: string;           // Código OACI aeropuerto/almacén
  cityName: string;       // Nombre de ciudad
  gmt: number;            // Offset UTC (número entero o decimal)
  capacity: number;       // Capacidad máxima
  currentStock: number;   // Stock actual
  utilization: number;    // % de ocupación (0–100)
  shipments: WarehouseShipmentItem[];
  incomingFlights?: WarehouseUpcomingFlight[];
  outgoingFlights?: WarehouseUpcomingFlight[];
}

interface WarehouseMonitoringPanelProps {
  warehouses: WarehouseItem[];
  isDark: boolean;
  selectedCode?: string | null;
  onDeselect?: () => void;
  onSelectWarehouse?: (code: string | null) => void;
  currentTime?: number;
}

type SortField = "occupancy" | "alpha" | "closest_departure" | "closest_arrival";

/** Formatea una cadena ISO como hora local del almacén según su offset GMT. */
function fmtLocalTime(isoStr: string | null, gmt: number): string {
  if (!isoStr) return "";
  try {
    const utcMs = new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z").getTime();
    const localMs = utcMs + gmt * 3_600_000;
    const d = new Date(localMs);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const year = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const label = `UTC${gmt >= 0 ? `+${gmt}` : gmt}`;
    return `${day}-${month}-${year} ${hh}:${mm} ${label}`;
  } catch {
    return "—";
  }
}

export function WarehouseMonitoringPanel({ warehouses, isDark, selectedCode, onDeselect, onSelectWarehouse, currentTime = Date.now() }: WarehouseMonitoringPanelProps) {
  // Búsqueda (transiente)
  const [search, setSearch] = useState("");

  // Ordenamiento
  const [sortBy, setSortBy] = useState<SortField>("occupancy");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Expansión local de filas
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  // Control de subsecciones abiertas por almacén
  const [openSubsections, setOpenSubsections] = useState<Record<string, { shipments: boolean; incoming: boolean; outgoing: boolean }>>({});

  const toggleSubsection = (code: string, section: "shipments" | "incoming" | "outgoing") => {
    setOpenSubsections(prev => {
      const current = prev[code] || { shipments: true, incoming: true, outgoing: true };
      return {
        ...prev,
        [code]: {
          ...current,
          [section]: !current[section]
        }
      };
    });
  };

  const isSectionOpen = (code: string, section: "shipments" | "incoming" | "outgoing") => {
    const current = openSubsections[code] || { shipments: true, incoming: true, outgoing: true };
    return current[section];
  };

  const areAllSectionsOpen = (code: string) => {
    const current = openSubsections[code] || { shipments: true, incoming: true, outgoing: true };
    return current.shipments && current.incoming && current.outgoing;
  };

  const toggleAllSections = (code: string) => {
    const allOpen = areAllSectionsOpen(code);
    setOpenSubsections(prev => ({
      ...prev,
      [code]: {
        shipments: !allOpen,
        incoming: !allOpen,
        outgoing: !allOpen
      }
    }));
  };

  // Almacén seleccionado fijado (pinned)
  const pinnedWarehouse = useMemo(() => {
    if (!selectedCode) return null;
    return warehouses.find(w => w.code === selectedCode) || null;
  }, [selectedCode, warehouses]);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  // Theme tokens
  const headerBorder = isDark ? "border-[#1e293b]" : "border-[#cbd5e1]";
  const titleCls = isDark ? "text-white" : "text-[#111827]";
  const subCls = isDark ? "text-white/70" : "text-[#374151]";
  const mutedCls = isDark ? "text-white/50" : "text-[#6b7280]";
  const dimCls = isDark ? "text-white/40" : "text-[#9ca3af]";
  const searchBg = isDark
    ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30"
    : "bg-white border-[#cbd5e1] text-[#111827] placeholder:text-[#9ca3af]";
  const hoverRow = isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]";
  const selectBg = isDark
    ? "bg-[#0f172a] border-[#1e293b] text-white text-[11px]"
    : "bg-white border-[#cbd5e1] text-[#111827] text-[11px]";
  const shipmentBg = isDark ? "bg-black/25" : "bg-slate-100";

  // ──────────────────────────────────────────────────────────────
  // Búsqueda transiente: por OACI, ciudad, nombre, o código envío
  // ──────────────────────────────────────────────────────────────
  const searchTerm = search.trim().toLowerCase();

  /**
   * Al buscar por código de envío queremos resaltar el almacén
   * que contiene ese envío. Identificamos cuáles almacenes
   * contienen envíos que coincidan con el término de búsqueda.
   */
  const searchMatchesShipment = useMemo(() => {
    if (!searchTerm) return new Set<string>();
    const matched = new Set<string>();
    warehouses.forEach(w => {
      if (w.shipments.some(s => s.id.toLowerCase().includes(searchTerm))) {
        matched.add(w.code);
      }
    });
    return matched;
  }, [warehouses, searchTerm]);

  const processedWarehouses = useMemo(() => {
    let result = [...warehouses];

    // Excluir almacén seleccionado/fijado si existe
    if (selectedCode) {
      result = result.filter(w => w.code !== selectedCode);
    }

    // Filtrar por búsqueda
    if (searchTerm) {
      result = result.filter(w =>
        w.code.toLowerCase().includes(searchTerm) ||
        w.cityName.toLowerCase().includes(searchTerm) ||
        searchMatchesShipment.has(w.code)
      );
    }

    // Ordenar
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "occupancy") {
        cmp = a.utilization - b.utilization;
      } else if (sortBy === "closest_departure") {
        const getVal = (w: WarehouseItem) => (w.outgoingFlights && w.outgoingFlights.length > 0) ? w.outgoingFlights[0].timeRaw : null;
        const aVal = getVal(a);
        const bVal = getVal(b);
        if (!aVal && !bVal) {
          cmp = 0;
        } else if (!aVal) {
          return 1; // Empty to the bottom
        } else if (!bVal) {
          return -1; // Empty to the bottom
        } else {
          if (typeof aVal === "number" && typeof bVal === "number") {
            cmp = aVal - bVal;
          } else {
            cmp = String(aVal).localeCompare(String(bVal));
          }
        }
      } else if (sortBy === "closest_arrival") {
        const getVal = (w: WarehouseItem) => (w.incomingFlights && w.incomingFlights.length > 0) ? w.incomingFlights[0].timeRaw : null;
        const aVal = getVal(a);
        const bVal = getVal(b);
        if (!aVal && !bVal) {
          cmp = 0;
        } else if (!aVal) {
          return 1;
        } else if (!bVal) {
          return -1;
        } else {
          if (typeof aVal === "number" && typeof bVal === "number") {
            cmp = aVal - bVal;
          } else {
            cmp = String(aVal).localeCompare(String(bVal));
          }
        }
      } else {
        cmp = a.code.localeCompare(b.code);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [warehouses, selectedCode, searchTerm, searchMatchesShipment, sortBy, sortOrder]);

  // Reset de página cuando cambia la búsqueda o el orden
  React.useEffect(() => {
    setCurrentPage(1);
  }, [search, sortBy, sortOrder]);

  // Si el término de búsqueda coincide con un envío, auto-expandir ese almacén
  React.useEffect(() => {
    if (searchMatchesShipment.size === 1) {
      setExpandedCode(Array.from(searchMatchesShipment)[0]);
    }
  }, [searchMatchesShipment]);

  // Cuando se selecciona/deselecciona un almacén, expandir o colapsar
  useEffect(() => {
    if (selectedCode) {
      setExpandedCode(selectedCode);
      setCurrentPage(1);
    } else {
      setExpandedCode(null);
    }
  }, [selectedCode]);

  const totalPages = Math.ceil(processedWarehouses.length / pageSize);
  const paginatedWarehouses = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedWarehouses.slice(start, start + pageSize);
  }, [processedWarehouses, currentPage]);

  const handleClearSearch = () => {
    setSearch("");
    setExpandedCode(null);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 text-[11px]">

      {/* Búsqueda */}
      <div className={`px-3 py-2 border-b ${headerBorder}`}>
        <div className="relative">
          <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${dimCls}`} />
          <Input
            placeholder="Buscar almacén, ciudad o envío..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`pl-7 pr-7 h-7 text-[11px] ${searchBg}`}
          />
          {search && (
            <button
              onClick={handleClearSearch}
              className={`absolute right-2 top-1/2 -translate-y-1/2 ${dimCls} hover:text-red-500`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* Indicador de búsqueda por envío */}
        {searchTerm && searchMatchesShipment.size > 0 && (
          <div className={`mt-1.5 text-[9.5px] flex items-center gap-1 ${isDark ? "text-cyan-400" : "text-blue-700"}`}>
            <Package className="w-2.5 h-2.5" />
            <span>
              Mostrando {searchMatchesShipment.size} almacén{searchMatchesShipment.size > 1 ? "es" : ""} con el envío
            </span>
          </div>
        )}
      </div>

      {/* Barra de Ordenamiento */}
      <div className={`px-3 py-1.5 border-b ${headerBorder} bg-black/5 flex items-center justify-end gap-1`}>
        <div className="flex items-center gap-1">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortField)}
            className={`h-6 rounded px-1.5 border py-0 focus:outline-none ${selectBg}`}
          >
            <option value="occupancy">Ocupación</option>
            <option value="alpha">Alfabético</option>
            <option value="closest_departure">Próximo a salir</option>
            <option value="closest_arrival">Próximo a llegar</option>
          </select>
          <button
            onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
            className={`h-6 px-1.5 rounded border ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"} text-center hover:bg-black/10`}
            title={sortOrder === "asc" ? "Ascendente" : "Descendente"}
          >
            {sortOrder === "asc" ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* ── Almacén fijado FUERA del scroll (header estático) ── */}
      {pinnedWarehouse && (() => {
        const w = warehouses.find(wh => wh.code === pinnedWarehouse.code) ?? pinnedWarehouse;
        const isExpanded = expandedCode === w.code;
        const utilColor = getOccupancyColor(w.utilization);
        return (
          <div className={`px-2 pt-2 pb-0 shrink-0 border-b ${headerBorder}`}>
            {/* Etiqueta de pinned */}
            <div className={`mb-1 px-1.5 py-0.5 flex items-center gap-1 text-[9px] font-semibold rounded ${isDark ? "text-cyan-400/80" : "text-blue-600/80"
              }`}>
              <MapPin className="w-2.5 h-2.5" />
              <span>Almacén fijado</span>
              <button
                onClick={() => {
                  if (onDeselect) onDeselect();
                  if (onSelectWarehouse) onSelectWarehouse(null);
                  setExpandedCode(null);
                }}
                className="ml-auto hover:text-red-400 transition-colors"
                title="Desfijar almacén"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>

            <div
              className={`rounded-md mb-2 border transition-all overflow-hidden ${isDark
                  ? "border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_8px_#00e5ff30]"
                  : "border-blue-500/60 bg-blue-50 shadow-sm"
                }`}
            >
              {/* Cabecera del almacén fijado */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  setExpandedCode(isExpanded ? null : w.code);
                }}
                className={`w-full text-left px-2 py-2 flex items-center justify-between gap-1 rounded-md transition-colors cursor-pointer ${hoverRow}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Warehouse className={`w-3 h-3 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                    <span className={`font-mono font-bold ${titleCls}`}>{w.code}</span>
                    <span className={`text-[9.5px] truncate ${mutedCls}`}>{w.cityName}</span>
                  </div>
                  {/* Barra de progreso de ocupación */}
                  <div className={`mt-1.5 w-full h-1.5 rounded-full ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"} overflow-hidden`}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(w.utilization, 100)}%`,
                        backgroundColor: utilColor,
                      }}
                    />
                  </div>
                </div>

                <div className="text-right shrink-0 flex flex-col items-end gap-0.5 ml-2">
                  <span className="font-mono text-[10px]">
                    {w.currentStock} / <span className={mutedCls}>{w.capacity}</span>
                  </span>
                  <Badge
                    className="text-[9px] py-0 px-1 font-mono font-bold border"
                    style={{
                      backgroundColor: `${utilColor}18`,
                      color: utilColor,
                      borderColor: `${utilColor}35`,
                    }}
                  >
                    {w.utilization.toFixed(1)}%
                  </Badge>
                </div>

                <div className="ml-1 shrink-0">
                  {isExpanded
                    ? <ChevronUp className={`w-3 h-3 ${dimCls}`} />
                    : <ChevronDown className={`w-3 h-3 ${dimCls}`} />
                  }
                </div>
              </div>

              {/* Detalle expandido: lista de envíos del almacén fijado (scrolleable) */}
              {isExpanded && (
                <div className={`px-2.5 pb-2.5 pt-1 border-t text-[10px] space-y-1.5 bg-black/10 max-h-80 overflow-y-auto pr-1 custom-blue-scrollbar ${headerBorder}`}>
                  <div className="flex items-center justify-between text-[9px] italic mb-1">
                    <span className={dimCls}>
                      Horas en UTC{w.gmt >= 0 ? `+${w.gmt}` : w.gmt} ({w.cityName})
                    </span>
                    <button
                      onClick={() => toggleAllSections(w.code)}
                      className={`text-[8.5px] font-semibold not-italic px-1.5 py-0.5 rounded border transition-colors ${isDark
                          ? "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                          : "border-blue-400/40 text-blue-700 hover:bg-blue-50"
                        }`}
                    >
                      {areAllSectionsOpen(w.code) ? "Contraer todos" : "Expandir todos"}
                    </button>
                  </div>

                  <div className="space-y-0.5">
                    {/* Botón colapsable Envíos */}
                    <button
                      onClick={() => toggleSubsection(w.code, "shipments")}
                      className={`w-full flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider ${mutedCls} mb-1 hover:text-cyan-400 text-left`}
                    >
                      <span className="flex items-center gap-1">
                        <Package className="w-2.5 h-2.5" />
                        Envíos en almacén ({w.shipments.length})
                      </span>
                      {isSectionOpen(w.code, "shipments") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {isSectionOpen(w.code, "shipments") && (
                      w.shipments.length === 0 ? (
                        <div className={`text-center py-2 italic ${dimCls} text-[9.5px]`}>
                          Sin envíos registrados
                        </div>
                      ) : (
                        <div className={`max-h-40 overflow-y-auto pr-0.5 rounded-lg border p-1 custom-blue-scrollbar ${isDark ? "bg-black/25 border-[#1e293b]" : "bg-white/60 border-[#cbd5e1]"}`}>
                          <div className={`grid grid-cols-[1fr_auto_1.2fr_1.2fr] gap-2 px-1 pb-1 border-b text-[8.5px] font-semibold uppercase tracking-wider ${mutedCls} ${headerBorder}`}>
                            <span>Envío</span>
                            <span className="text-right">Maletas</span>
                            <span className="text-right">Llegada almacén</span>
                            <span className="text-right">Salida vuelo</span>
                          </div>

                          {w.shipments.map(s => {
                            const departureFormatted = s.flightDeparture ? fmtLocalTime(s.flightDeparture, w.gmt) : null;
                            const hasDeparture = !!s.flightDeparture;
                            const arrivalFormatted = s.arrivedAt ? fmtLocalTime(s.arrivedAt, w.gmt) : null;
                            const hasArrival = !!s.arrivedAt;

                            return (
                              <div
                                key={s.id}
                                className={`grid grid-cols-[1fr_auto_1.2fr_1.2fr] gap-2 px-1 py-0.5 rounded hover:bg-white/5 items-start text-[8.5px]`}
                              >
                                <span className={`font-mono font-semibold truncate ${titleCls}`}>{s.id}</span>
                                <span className={`font-bold text-right font-mono ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                  x{s.cant}
                                </span>
                                {hasArrival ? (
                                  <span className={`text-right font-mono ${subCls}`}>{arrivalFormatted}</span>
                                ) : (
                                  <span className={`text-right italic text-[8.5px] ${isDark ? "text-cyan-400/50" : "text-blue-600/50"}`}>—</span>
                                )}
                                {hasDeparture ? (
                                  <span className={`text-right font-mono ${subCls}`}>{departureFormatted}</span>
                                ) : s.isFinalDestination ? (
                                  <span className={`text-right italic text-[8.5px] ${isDark ? "text-green-400/80" : "text-green-600"} font-medium flex items-center justify-end gap-0.5`}>
                                    Destino Final
                                  </span>
                                ) : (
                                  <span className={`text-right italic text-[8px] ${isDark ? "text-amber-400/80" : "text-amber-600"} flex items-center justify-end gap-0.5`}>
                                    <Clock className="w-2 h-2 shrink-0" />
                                    Sin ruta
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )
                    )}
                  </div>

                  {w.incomingFlights && (
                    <div className="space-y-0.5 mt-2">
                      {/* Botón colapsable Vuelos de llegada */}
                      <button
                        onClick={() => toggleSubsection(w.code, "incoming")}
                        className={`w-full flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider ${mutedCls} mb-1 hover:text-cyan-400 text-left`}
                      >
                        <span className="flex items-center gap-1">
                          <Plane className="w-2.5 h-2.5 transform rotate-90" />
                          Vuelos próximos a llegar ({w.incomingFlights.length})
                        </span>
                        {isSectionOpen(w.code, "incoming") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isSectionOpen(w.code, "incoming") && (
                        <div className={`max-h-32 overflow-y-auto pr-0.5 rounded-lg border p-1 custom-blue-scrollbar ${isDark ? "bg-black/25 border-[#1e293b]" : "bg-white/60 border-[#cbd5e1]"}`}>
                          <div className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 pb-1 border-b text-[8.5px] font-semibold uppercase tracking-wider ${mutedCls} ${headerBorder}`}>
                            <span>Origen</span>
                            <span className="text-right">Llegada</span>
                          </div>
                          {w.incomingFlights.length === 0 ? (
                            <div className={`text-center py-2 italic ${dimCls} text-[9.5px]`}>No hay vuelos programados</div>
                          ) : (
                            w.incomingFlights.map(f => (
                              <div key={f.id} className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 py-0.5 rounded hover:bg-white/5 items-start text-[8.5px]`}>
                                <span className={`font-mono font-semibold truncate ${titleCls}`}>{f.airportCode}</span>
                                <span className={`text-right font-mono ${subCls}`}>
                                  {typeof f.timeRaw === "number" ? fmtLocalTime(new Date(f.timeRaw).toISOString(), w.gmt) : fmtLocalTime(String(f.timeRaw), w.gmt)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {w.outgoingFlights && (
                    <div className="space-y-0.5 mt-2">
                      {/* Botón colapsable Vuelos de salida */}
                      <button
                        onClick={() => toggleSubsection(w.code, "outgoing")}
                        className={`w-full flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider ${mutedCls} mb-1 hover:text-cyan-400 text-left`}
                      >
                        <span className="flex items-center gap-1">
                          <Plane className="w-2.5 h-2.5 transform rotate-45" />
                          Vuelos próximos a salir ({w.outgoingFlights.length})
                        </span>
                        {isSectionOpen(w.code, "outgoing") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isSectionOpen(w.code, "outgoing") && (
                        <div className={`max-h-32 overflow-y-auto pr-0.5 rounded-lg border p-1 custom-blue-scrollbar ${isDark ? "bg-black/25 border-[#1e293b]" : "bg-white/60 border-[#cbd5e1]"}`}>
                          <div className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 pb-1 border-b text-[8.5px] font-semibold uppercase tracking-wider ${mutedCls} ${headerBorder}`}>
                            <span>Destino</span>
                            <span className="text-right">Salida</span>
                          </div>
                          {w.outgoingFlights.length === 0 ? (
                            <div className={`text-center py-2 italic ${dimCls} text-[9.5px]`}>No hay vuelos programados</div>
                          ) : (
                            w.outgoingFlights.map(f => (
                              <div key={f.id} className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 py-0.5 rounded hover:bg-white/5 items-start text-[8.5px]`}>
                                <span className={`font-mono font-semibold truncate ${titleCls}`}>{f.airportCode}</span>
                                <span className={`text-right font-mono ${subCls}`}>
                                  {typeof f.timeRaw === "number" ? fmtLocalTime(new Date(f.timeRaw).toISOString(), w.gmt) : fmtLocalTime(String(f.timeRaw), w.gmt)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Lista de almacenes scrolleable (independiente del fijado) */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 custom-blue-scrollbar">
        <div className="px-2 py-1">
          {paginatedWarehouses.map(w => {
            const isExpanded = expandedCode === w.code;
            const utilColor = getOccupancyColor(w.utilization);
            const isShipmentMatch = searchMatchesShipment.has(w.code);
            const isSelected = selectedCode === w.code;

            return (
              <div
                key={w.code}
                className={`rounded-md mb-1.5 border transition-all overflow-hidden ${isShipmentMatch && searchTerm
                    ? isDark
                      ? "border-cyan-500/40 bg-cyan-500/5"
                      : "border-blue-400/50 bg-blue-50"
                    : "border-transparent"
                  }`}
              >
                {/* Cabecera del almacén */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setExpandedCode(isExpanded ? null : w.code);
                    if (onSelectWarehouse) {
                      onSelectWarehouse(w.code);
                    }
                  }}
                  className={`w-full text-left px-2 py-2 flex items-center justify-between gap-1 rounded-md transition-colors cursor-pointer ${hoverRow}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Warehouse className={`w-3 h-3 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                      <span className={`font-mono font-bold ${titleCls}`}>{w.code}</span>
                      <span className={`text-[9.5px] truncate ${mutedCls}`}>{w.cityName}</span>
                    </div>
                    {/* Barra de progreso de ocupación */}
                    <div className={`mt-1.5 w-full h-1.5 rounded-full ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"} overflow-hidden`}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(w.utilization, 100)}%`,
                          backgroundColor: utilColor,
                        }}
                      />
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end gap-0.5 ml-2">
                    <span className="font-mono text-[10px]">
                      {w.currentStock} / <span className={mutedCls}>{w.capacity}</span>
                    </span>
                    <Badge
                      className="text-[9px] py-0 px-1 font-mono font-bold border"
                      style={{
                        backgroundColor: `${utilColor}18`,
                        color: utilColor,
                        borderColor: `${utilColor}35`,
                      }}
                    >
                      {w.utilization.toFixed(1)}%
                    </Badge>
                  </div>

                  <div className="ml-1 shrink-0">
                    {isExpanded
                      ? <ChevronUp className={`w-3 h-3 ${dimCls}`} />
                      : <ChevronDown className={`w-3 h-3 ${dimCls}`} />
                    }
                  </div>
                </div>

                {/* Detalle expandido: lista de envíos (scrolleable) */}
                {isExpanded && (
                  <div className={`px-2.5 pb-2.5 pt-1 border-t text-[10px] space-y-1.5 bg-black/10 max-h-80 overflow-y-auto pr-1 custom-blue-scrollbar ${headerBorder}`}>
                    <div className="flex items-center justify-between text-[9px] italic mb-1">
                      <span className={dimCls}>
                        Horas en UTC{w.gmt >= 0 ? `+${w.gmt}` : w.gmt} ({w.cityName})
                      </span>
                      <button
                        onClick={() => toggleAllSections(w.code)}
                        className={`text-[8.5px] font-semibold not-italic px-1.5 py-0.5 rounded border transition-colors ${isDark
                            ? "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                            : "border-blue-400/40 text-blue-700 hover:bg-blue-50"
                          }`}
                      >
                        {areAllSectionsOpen(w.code) ? "Contraer todos" : "Expandir todos"}
                      </button>
                    </div>

                    <div className="space-y-0.5">
                      {/* Botón colapsable Envíos */}
                      <button
                        onClick={() => toggleSubsection(w.code, "shipments")}
                        className={`w-full flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider ${mutedCls} mb-1 hover:text-cyan-400 text-left`}
                      >
                        <span className="flex items-center gap-1">
                          <Package className="w-2.5 h-2.5" />
                          Envíos en almacén ({w.shipments.length})
                        </span>
                        {isSectionOpen(w.code, "shipments") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isSectionOpen(w.code, "shipments") && (
                        w.shipments.length === 0 ? (
                          <div className={`text-center py-2 italic ${dimCls} text-[9.5px]`}>
                            Sin envíos registrados
                          </div>
                        ) : (
                          <div className={`max-h-52 overflow-y-auto pr-0.5 rounded-lg border p-1 custom-blue-scrollbar ${isDark ? "bg-black/25 border-[#1e293b]" : "bg-white/60 border-[#cbd5e1]"}`}>
                            <div className={`grid grid-cols-[1fr_auto_1.2fr_1.2fr] gap-2 px-1 pb-1 border-b text-[8.5px] font-semibold uppercase tracking-wider ${mutedCls} ${headerBorder}`}>
                              <span>Envío</span>
                              <span className="text-right">Maletas</span>
                              <span className="text-right">Llegada almacén</span>
                              <span className="text-right">Salida vuelo</span>
                            </div>

                            {w.shipments.map(s => {
                              const departureFormatted = s.flightDeparture ? fmtLocalTime(s.flightDeparture, w.gmt) : null;
                              const hasDeparture = !!s.flightDeparture;
                              const arrivalFormatted = s.arrivedAt ? fmtLocalTime(s.arrivedAt, w.gmt) : null;
                              const hasArrival = !!s.arrivedAt;

                              return (
                                <div
                                  key={s.id}
                                  className={`grid grid-cols-[1fr_auto_1.2fr_1.2fr] gap-2 px-1 py-0.5 rounded hover:bg-white/5 items-start text-[8.5px]`}
                                >
                                  <span className={`font-mono font-semibold truncate ${titleCls}`}>{s.id}</span>
                                  <span className={`font-bold text-right font-mono ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                    x{s.cant}
                                  </span>
                                  {hasArrival ? (
                                    <span className={`text-right font-mono ${subCls}`}>{arrivalFormatted}</span>
                                  ) : (
                                    <span className={`text-right italic text-[8.5px] ${isDark ? "text-cyan-400/50" : "text-blue-600/50"}`}>—</span>
                                  )}
                                  {hasDeparture ? (
                                    <span className={`text-right font-mono ${subCls}`}>{departureFormatted}</span>
                                  ) : s.isFinalDestination ? (
                                    <span className={`text-right italic text-[8.5px] ${isDark ? "text-green-400/80" : "text-green-600"} font-medium flex items-center justify-end gap-0.5`}>
                                      Destino Final
                                    </span>
                                  ) : (
                                    <span className={`text-right italic text-[8px] ${isDark ? "text-amber-400/80" : "text-amber-600"} flex items-center justify-end gap-0.5`}>
                                      <Clock className="w-2 h-2 shrink-0" />
                                      Sin ruta
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )
                      )}
                    </div>

                    {w.incomingFlights && (
                      <div className="space-y-0.5 mt-2">
                        {/* Botón colapsable Vuelos de llegada */}
                        <button
                          onClick={() => toggleSubsection(w.code, "incoming")}
                          className={`w-full flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider ${mutedCls} mb-1 hover:text-cyan-400 text-left`}
                        >
                          <span className="flex items-center gap-1">
                            <Plane className="w-2.5 h-2.5 transform rotate-90" />
                            Vuelos próximos a llegar ({w.incomingFlights.length})
                          </span>
                          {isSectionOpen(w.code, "incoming") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>

                        {isSectionOpen(w.code, "incoming") && (
                          <div className={`max-h-32 overflow-y-auto pr-0.5 rounded-lg border p-1 custom-blue-scrollbar ${isDark ? "bg-black/25 border-[#1e293b]" : "bg-white/60 border-[#cbd5e1]"}`}>
                            <div className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 pb-1 border-b text-[8.5px] font-semibold uppercase tracking-wider ${mutedCls} ${headerBorder}`}>
                              <span>Origen</span>
                              <span className="text-right">Llegada</span>
                            </div>
                            {w.incomingFlights.length === 0 ? (
                              <div className={`text-center py-2 italic ${dimCls} text-[9.5px]`}>No hay vuelos programados</div>
                            ) : (
                              w.incomingFlights.map(f => (
                                <div key={f.id} className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 py-0.5 rounded hover:bg-white/5 items-start text-[8.5px]`}>
                                  <span className={`font-mono font-semibold truncate ${titleCls}`}>{f.airportCode}</span>
                                  <span className={`text-right font-mono ${subCls}`}>
                                    {typeof f.timeRaw === "number" ? fmtLocalTime(new Date(f.timeRaw).toISOString(), w.gmt) : fmtLocalTime(String(f.timeRaw), w.gmt)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {w.outgoingFlights && (
                      <div className="space-y-0.5 mt-2">
                        {/* Botón colapsable Vuelos de salida */}
                        <button
                          onClick={() => toggleSubsection(w.code, "outgoing")}
                          className={`w-full flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider ${mutedCls} mb-1 hover:text-cyan-400 text-left`}
                        >
                          <span className="flex items-center gap-1">
                            <Plane className="w-2.5 h-2.5 transform rotate-45" />
                            Vuelos próximos a salir ({w.outgoingFlights.length})
                          </span>
                          {isSectionOpen(w.code, "outgoing") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>

                        {isSectionOpen(w.code, "outgoing") && (
                          <div className={`max-h-32 overflow-y-auto pr-0.5 rounded-lg border p-1 custom-blue-scrollbar ${isDark ? "bg-black/25 border-[#1e293b]" : "bg-white/60 border-[#cbd5e1]"}`}>
                            <div className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 pb-1 border-b text-[8.5px] font-semibold uppercase tracking-wider ${mutedCls} ${headerBorder}`}>
                              <span>Destino</span>
                              <span className="text-right">Salida</span>
                            </div>
                            {w.outgoingFlights.length === 0 ? (
                              <div className={`text-center py-2 italic ${dimCls} text-[9.5px]`}>No hay vuelos programados</div>
                            ) : (
                              w.outgoingFlights.map(f => (
                                <div key={f.id} className={`grid grid-cols-[1fr_1.5fr] gap-2 px-1 py-0.5 rounded hover:bg-white/5 items-start text-[8.5px]`}>
                                  <span className={`font-mono font-semibold truncate ${titleCls}`}>{f.airportCode}</span>
                                  <span className={`text-right font-mono ${subCls}`}>
                                    {typeof f.timeRaw === "number" ? fmtLocalTime(new Date(f.timeRaw).toISOString(), w.gmt) : fmtLocalTime(String(f.timeRaw), w.gmt)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {processedWarehouses.length === 0 && (
            <div className={`text-center py-12 ${dimCls} italic`}>
              No se encontraron almacenes.
            </div>
          )}
        </div>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className={`px-3 py-2 border-t ${headerBorder} bg-black/5 flex items-center justify-between shrink-0 text-[10px]`}>
          <button
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className={`px-2 py-1 rounded border transition-colors font-medium ${currentPage === 1
              ? "opacity-40 cursor-not-allowed border-transparent"
              : isDark
                ? "border-[#1e293b] text-cyan-400 hover:bg-[#1e293b]/50"
                : "border-[#cbd5e1] text-blue-700 hover:bg-slate-100"
              }`}
          >
            Anterior
          </button>
          <span className={mutedCls}>
            Página <span className={`font-semibold ${titleCls}`}>{currentPage}</span> de{" "}
            <span className={`font-semibold ${titleCls}`}>{totalPages}</span>{" "}
            ({processedWarehouses.length} almacenes)
          </span>
          <button
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className={`px-2 py-1 rounded border transition-colors font-medium ${currentPage === totalPages
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
  );
}
