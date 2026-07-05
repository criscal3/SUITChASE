import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Search, X, ArrowUpDown, ChevronDown, ChevronUp,
  Warehouse, Package, Clock, MapPin
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

export interface WarehouseItem {
  code: string;           // Código OACI aeropuerto/almacén
  cityName: string;       // Nombre de ciudad
  gmt: number;            // Offset UTC (número entero o decimal)
  capacity: number;       // Capacidad máxima
  currentStock: number;   // Stock actual
  utilization: number;    // % de ocupación (0–100)
  shipments: WarehouseShipmentItem[];
}

interface WarehouseMonitoringPanelProps {
  warehouses: WarehouseItem[];
  isDark: boolean;
  selectedCode?: string | null;
  onDeselect?: () => void;
  onSelectWarehouse?: (code: string | null) => void;
}

type SortField = "occupancy" | "alpha";

/** Formatea una cadena ISO como hora local del almacén según su offset GMT. */
function fmtLocalTime(isoStr: string | null, gmt: number): string {
  if (!isoStr) return "";
  try {
    const utcMs = new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z").getTime();
    const localMs = utcMs + gmt * 3_600_000;
    const d = new Date(localMs);
    const day   = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const year  = d.getUTCFullYear();
    const hh    = String(d.getUTCHours()).padStart(2, "0");
    const mm    = String(d.getUTCMinutes()).padStart(2, "0");
    const label = `UTC${gmt >= 0 ? `+${gmt}` : gmt}`;
    return `${day}-${month}-${year} ${hh}:${mm} ${label}`;
  } catch {
    return "—";
  }
}

export function WarehouseMonitoringPanel({ warehouses, isDark, selectedCode, onDeselect, onSelectWarehouse }: WarehouseMonitoringPanelProps) {
  // Búsqueda (transiente)
  const [search, setSearch] = useState("");

  // Ordenamiento
  const [sortBy, setSortBy] = useState<SortField>("occupancy");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Expansión local de filas
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  // Ref para scroll al elemento seleccionado
  const selectedRowRef = useRef<HTMLDivElement | null>(null);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  // Theme tokens
  const headerBorder = isDark ? "border-[#1e293b]" : "border-[#cbd5e1]";
  const titleCls     = isDark ? "text-white"       : "text-[#111827]";
  const subCls       = isDark ? "text-white/70"    : "text-[#374151]";
  const mutedCls     = isDark ? "text-white/50"    : "text-[#6b7280]";
  const dimCls       = isDark ? "text-white/40"    : "text-[#9ca3af]";
  const searchBg     = isDark
    ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30"
    : "bg-white border-[#cbd5e1] text-[#111827] placeholder:text-[#9ca3af]";
  const hoverRow     = isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]";
  const selectBg     = isDark
    ? "bg-[#0f172a] border-[#1e293b] text-white text-[11px]"
    : "bg-white border-[#cbd5e1] text-[#111827] text-[11px]";
  const shipmentBg   = isDark ? "bg-black/25"        : "bg-slate-100";

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
      } else {
        cmp = a.code.localeCompare(b.code);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [warehouses, searchTerm, searchMatchesShipment, sortBy, sortOrder]);

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

  // Cuando se selecciona un almacén desde el mapa o externamente:
  // 1. Encontrar su página y cambiar currentPage
  // 2. Expandirlo y hacer scroll
  useEffect(() => {
    if (selectedCode) {
      setExpandedCode(selectedCode);
      const index = processedWarehouses.findIndex(w => w.code === selectedCode);
      if (index >= 0) {
        const page = Math.floor(index / pageSize) + 1;
        setCurrentPage(page);
      }
      
      // Dar tiempo al render de la página correcta para que el ref esté disponible
      setTimeout(() => {
        selectedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
    }
  }, [selectedCode, processedWarehouses, pageSize]);

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
    <div className="flex flex-col h-full min-h-0 text-[11px]">

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
          <ArrowUpDown className={`w-3 h-3 ${dimCls}`} />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortField)}
            className={`h-6 rounded px-1.5 border py-0 focus:outline-none ${selectBg}`}
          >
            <option value="occupancy">Ocupación</option>
            <option value="alpha">Alfabético</option>
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

      {/* Lista de almacenes */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-1">
          {paginatedWarehouses.map(w => {
            const isExpanded      = expandedCode === w.code;
            const utilColor       = getOccupancyColor(w.utilization);
            const isShipmentMatch = searchMatchesShipment.has(w.code);
            const isSelected      = selectedCode === w.code;

            return (
              <div
                key={w.code}
                ref={isSelected ? selectedRowRef : undefined}
                className={`rounded-md mb-1.5 border transition-all overflow-hidden ${
                  isSelected
                    ? isDark
                      ? "border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_8px_#00e5ff30]"
                      : "border-blue-500/60 bg-blue-50 shadow-sm"
                    : isShipmentMatch && searchTerm
                      ? isDark
                        ? "border-cyan-500/40 bg-cyan-500/5"
                        : "border-blue-400/50 bg-blue-50"
                      : "border-transparent"
                }`}
              >
                {/* Cabecera del almacén */}
                <button
                  onClick={() => {
                    setExpandedCode(isExpanded ? null : w.code);
                    if (onSelectWarehouse) {
                      onSelectWarehouse(w.code);
                    }
                  }}
                  className={`w-full text-left px-2 py-2 flex items-center justify-between gap-1 rounded-md transition-colors ${hoverRow}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Warehouse className={`w-3 h-3 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                      <span className={`font-mono font-bold ${titleCls}`}>{w.code}</span>
                      <span className={`text-[9.5px] truncate ${mutedCls}`}>{w.cityName}</span>
                      {isSelected && (
                        <span className={`flex items-center gap-0.5 text-[8.5px] px-1.5 py-0.5 rounded-full font-semibold ${isDark ? "bg-cyan-500/20 text-cyan-300" : "bg-blue-100 text-blue-700"}`}>
                          <MapPin className="w-2 h-2" />
                          En mapa
                        </span>
                      )}
                    </div>
                    {isSelected && onDeselect && (
                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          onDeselect(); 
                          if (onSelectWarehouse) onSelectWarehouse(null);
                        }}
                        className={`mt-1 flex items-center gap-1 text-[8.5px] px-1.5 py-0.5 rounded border transition-colors ${isDark ? "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10" : "border-blue-400/40 text-blue-600 hover:bg-blue-50"}`}
                        title="Deseleccionar almacén"
                      >
                        <X className="w-2.5 h-2.5" />
                        Deseleccionar
                      </button>
                    )}
                    {/* Barra de progreso de ocupación */}
                    <div className={`mt-1 w-full h-1.5 rounded-full ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"} overflow-hidden`}>
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
                </button>

                {/* Detalle expandido: lista de envíos */}
                {isExpanded && (
                  <div className={`px-2.5 pb-2.5 pt-1 border-t text-[10px] space-y-1.5 bg-black/10 ${headerBorder}`}>
                    {/* Zona horaria de referencia */}
                    <div className={`text-[9px] ${dimCls} italic`}>
                      Horas en UTC{w.gmt >= 0 ? `+${w.gmt}` : w.gmt} ({w.cityName})
                    </div>

                    {/* Listado de envíos */}
                    <div className="space-y-0.5">
                      <div className={`text-[9px] font-semibold uppercase tracking-wider ${mutedCls} flex items-center gap-1 mb-1`}>
                        <Package className="w-2.5 h-2.5" />
                        Envíos en almacén ({w.shipments.length})
                      </div>

                      {w.shipments.length === 0 ? (
                        <div className={`text-center py-2 italic ${dimCls} text-[9.5px]`}>
                          Sin envíos registrados
                        </div>
                      ) : (
                        <div className={`max-h-52 overflow-y-auto pr-0.5 rounded-lg border p-1 custom-blue-scrollbar ${isDark ? "bg-black/25 border-[#1e293b]" : "bg-white/60 border-[#cbd5e1]"}`}>
                          {/* Encabezado de tabla */}
                          <div className={`grid grid-cols-[1fr_auto_1.2fr] gap-2 px-1 pb-1 border-b text-[8.5px] font-semibold uppercase tracking-wider ${mutedCls} ${headerBorder}`}>
                            <span>Envío</span>
                            <span className="text-right">Maletas</span>
                            <span className="text-right">Salida vuelo</span>
                          </div>

                          {w.shipments.map(s => {
                            const departureFormatted = s.flightDeparture ? fmtLocalTime(s.flightDeparture, w.gmt) : null;
                            const hasDeparture       = !!s.flightDeparture;

                            return (
                              <div
                                key={s.id}
                                className={`grid grid-cols-[1fr_auto_1.2fr] gap-2 px-1 py-0.5 rounded hover:bg-white/5 items-start text-[8.5px]`}
                              >
                                {/* Código envío */}
                                <span className={`font-mono font-semibold truncate ${titleCls}`}>{s.id}</span>

                                {/* Maletas */}
                                <span className={`font-bold text-right font-mono ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                  x{s.cant}
                                </span>

                                 {/* Hora salida vuelo */}
                                 {hasDeparture ? (
                                   <span className={`text-right font-mono ${subCls}`}>
                                     {departureFormatted}
                                   </span>
                                 ) : s.isFinalDestination ? (
                                   <span className={`text-right italic text-[8.5px] ${isDark ? "text-green-400/80" : "text-green-600"} font-medium flex items-center justify-end gap-0.5`}>
                                     Destino Final
                                   </span>
                                 ) : (
                                   <span className={`text-right italic text-[8px] ${isDark ? "text-amber-400/80" : "text-amber-600"} flex items-center justify-end gap-0.5`}>
                                     <Clock className="w-2 h-2 shrink-0" />
                                     Sin ruta disponible
                                   </span>
                                 )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
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
      </ScrollArea>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className={`px-3 py-2 border-t ${headerBorder} bg-black/5 flex items-center justify-between shrink-0 text-[10px]`}>
          <button
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className={`px-2 py-1 rounded border transition-colors font-medium ${
              currentPage === 1
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
            className={`px-2 py-1 rounded border transition-colors font-medium ${
              currentPage === totalPages
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
