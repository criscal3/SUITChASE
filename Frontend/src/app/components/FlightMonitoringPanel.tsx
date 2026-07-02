import React, { useState, useMemo } from "react";
import { Search, Plane, X, ArrowUpDown, ChevronRight, ChevronDown, ChevronUp, MapPin, Package, Filter } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { getOccupancyColor, getOccupancyTextClass } from "../engine/occupancyStatus";

export interface FlightItem {
  id: string; // formatted code CodigoOrigen-CodigoDestino-HoraSalida
  key: string; // unique flight key
  fromCode: string;
  toCode: string;
  departureTime: string; // formatted local date-time
  arrivalTime: string; // formatted local date-time
  departureRaw: number | string; // raw timestamp or ISO string for sorting
  arrivalRaw: number | string; // raw timestamp or ISO string for sorting
  currentLoad: number;
  capacity: number;
  utilization: number;
  shipments: { id: string; cant: number }[];
  pedidoIds?: string[];
  baggageGroupIds?: string[];
}

interface FlightMonitoringPanelProps {
  flights: FlightItem[];
  isDark: boolean;
  onSelectFlightOnMap?: (shipmentIds: string[] | null, flightKey: string | null) => void;
  selectedFlightKey?: string | null;
}

type SortField = "occupancy" | "departure" | "arrival" | "origin" | "destination";

export function FlightMonitoringPanel({
  flights,
  isDark,
  onSelectFlightOnMap,
  selectedFlightKey
}: FlightMonitoringPanelProps) {
  // Search state (transient)
  const [search, setSearch] = useState("");
  
  // Filter state (semi-permanent)
  const [showFilters, setShowFilters] = useState(false);
  const [filterOrigin, setFilterOrigin] = useState("all");
  const [filterDest, setFilterDest] = useState("all");
  const [filterShipment, setFilterShipment] = useState("");

  // Sort state
  const [sortBy, setSortBy] = useState<SortField>("occupancy");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Local UI expansion state
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Theme tokens
  const headerBorder = isDark ? "border-[#1e293b]" : "border-[#cbd5e1]";
  const titleCls = isDark ? "text-white" : "text-[#111827]";
  const subCls = isDark ? "text-white/70" : "text-[#374151]";
  const mutedCls = isDark ? "text-white/50" : "text-[#6b7280]";
  const dimCls = isDark ? "text-white/40" : "text-[#9ca3af]";
  const searchBg = isDark ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30" : "bg-white border-[#cbd5e1] text-[#111827] placeholder:text-[#9ca3af]";
  const hoverRow = isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]";
  const activeRow = isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-blue-600/10 border border-blue-600/30";
  const selectBg = isDark ? "bg-[#0f172a] border-[#1e293b] text-white text-[11px]" : "bg-white border-[#cbd5e1] text-[#111827] text-[11px]";

  // Get unique origins and destinations for filters
  const uniqueOrigins = useMemo(() => {
    const set = new Set(flights.map(f => f.fromCode));
    return Array.from(set).sort();
  }, [flights]);

  const uniqueDestinations = useMemo(() => {
    const set = new Set(flights.map(f => f.toCode));
    return Array.from(set).sort();
  }, [flights]);

  // Apply filters, search and sorting
  const processedFlights = useMemo(() => {
    let result = [...flights];

    // 1. Apply semi-permanent filters first
    if (filterOrigin !== "all") {
      result = result.filter(f => f.fromCode === filterOrigin);
    }
    if (filterDest !== "all") {
      result = result.filter(f => f.toCode === filterDest);
    }
    if (filterShipment.trim()) {
      const q = filterShipment.toLowerCase().trim();
      result = result.filter(f => 
        f.id.toLowerCase().includes(q)
      );
    }

    // 2. Apply search query (transient)
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(f => 
        f.id.toLowerCase().includes(q) ||
        f.fromCode.toLowerCase().includes(q) ||
        f.toCode.toLowerCase().includes(q) ||
        f.shipments.some(s => s.id.toLowerCase().includes(q))
      );
    }

    // 3. Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "occupancy") {
        comparison = a.utilization - b.utilization;
      } else if (sortBy === "departure") {
        const aVal = typeof a.departureRaw === "number" ? a.departureRaw : new Date(a.departureRaw).getTime();
        const bVal = typeof b.departureRaw === "number" ? b.departureRaw : new Date(b.departureRaw).getTime();
        comparison = aVal - bVal;
      } else if (sortBy === "arrival") {
        const aVal = typeof a.arrivalRaw === "number" ? a.arrivalRaw : new Date(a.arrivalRaw).getTime();
        const bVal = typeof b.arrivalRaw === "number" ? b.arrivalRaw : new Date(b.arrivalRaw).getTime();
        comparison = aVal - bVal;
      } else if (sortBy === "origin") {
        comparison = a.fromCode.localeCompare(b.fromCode);
      } else if (sortBy === "destination") {
        comparison = a.toCode.localeCompare(b.toCode);
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [flights, filterOrigin, filterDest, filterShipment, search, sortBy, sortOrder]);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  // Reset page when filters, sorting, or search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterOrigin, filterDest, filterShipment, search, sortBy, sortOrder]);

  const totalPages = Math.ceil(processedFlights.length / pageSize);
  
  const paginatedFlights = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedFlights.slice(startIndex, startIndex + pageSize);
  }, [processedFlights, currentPage, pageSize]);

  // Jump to the page of the selected flight if it's set from the map
  React.useEffect(() => {
    if (selectedFlightKey) {
      const idx = processedFlights.findIndex(f => f.key === selectedFlightKey);
      if (idx !== -1) {
        const pageOfFlight = Math.floor(idx / pageSize) + 1;
        setCurrentPage(pageOfFlight);
        setExpandedKey(selectedFlightKey);
      }
    }
  }, [selectedFlightKey, processedFlights]);

  const handleFlightClick = (f: FlightItem) => {
    const newKey = expandedKey === f.key ? null : f.key;
    setExpandedKey(newKey);
    
    // Also select on map if expanded
    if (onSelectFlightOnMap) {
      if (newKey) {
        const ids = f.pedidoIds || f.baggageGroupIds || f.shipments.map(s => s.id);
        onSelectFlightOnMap(ids, f.key);
      } else {
        onSelectFlightOnMap(null, null);
      }
    }
  };

  const handleClearSearch = () => {
    setSearch("");
  };

  const handleClearFilters = () => {
    setFilterOrigin("all");
    setFilterDest("all");
    setFilterShipment("");
  };

  return (
    <div className="flex flex-col h-full min-h-0 text-[11px]">
      {/* Búsqueda */}
      <div className={`px-3 py-2 border-b ${headerBorder}`}>
        <div className="relative">
          <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${dimCls}`} />
          <Input
            placeholder="Buscar vuelo, envío, origen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`pl-7 pr-7 h-7 text-[11px] ${searchBg}`}
          />
          {search && (
            <button onClick={handleClearSearch} className={`absolute right-2 top-1/2 -translate-y-1/2 ${dimCls} hover:text-red-500`}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Barra de Filtros y Ordenamiento */}
      <div className={`px-3 py-1.5 border-b ${headerBorder} bg-black/5 flex items-center justify-between gap-1`}>
        <button 
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors ${
            showFilters || filterOrigin !== "all" || filterDest !== "all" || filterShipment
              ? "border-cyan-500/50 text-cyan-400 bg-cyan-500/5"
              : isDark ? "border-[#1e293b] text-white/70 hover:text-white" : "border-[#cbd5e1] text-[#475569] hover:text-[#111827]"
          }`}
        >
          <Filter className="w-3 h-3" />
          <span>Filtros</span>
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Ordenar */}
        <div className="flex items-center gap-1">
          <ArrowUpDown className={`w-3 h-3 ${dimCls}`} />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortField)}
            className={`h-6 rounded px-1.5 border py-0 focus:outline-none ${selectBg}`}
          >
            <option value="occupancy">Ocupación</option>
            <option value="departure">Salida</option>
            <option value="arrival">Llegada</option>
            <option value="origin">Origen</option>
            <option value="destination">Destino</option>
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

      {/* Contenido de Filtros (Colapsable) */}
      {showFilters && (
        <div className={`px-3 py-2 border-b ${headerBorder} space-y-1.5 bg-black/10`}>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className={`text-[9px] uppercase font-semibold ${mutedCls}`}>Origen</label>
              <select
                value={filterOrigin}
                onChange={e => setFilterOrigin(e.target.value)}
                className={`w-full h-6 rounded px-1 border focus:outline-none mt-0.5 ${selectBg}`}
              >
                <option value="all">Todos</option>
                {uniqueOrigins.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className={`text-[9px] uppercase font-semibold ${mutedCls}`}>Destino</label>
              <select
                value={filterDest}
                onChange={e => setFilterDest(e.target.value)}
                className={`w-full h-6 rounded px-1 border focus:outline-none mt-0.5 ${selectBg}`}
              >
                <option value="all">Todos</option>
                {uniqueDestinations.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={`text-[9px] uppercase font-semibold ${mutedCls}`}>Código Vuelo</label>
            <div className="relative mt-0.5">
              <Input
                placeholder="Filtrar por vuelo..."
                value={filterShipment}
                onChange={e => setFilterShipment(e.target.value)}
                className={`h-6 text-[10px] pr-6 ${searchBg}`}
              />
              {filterShipment && (
                <button onClick={() => setFilterShipment("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          {(filterOrigin !== "all" || filterDest !== "all" || filterShipment) && (
            <button
              onClick={handleClearFilters}
              className={`w-full text-center py-1 mt-1 text-[9px] font-bold rounded transition-colors ${
                isDark ? "bg-red-950/20 text-red-400 hover:bg-red-950/40" : "bg-red-50 text-red-600 hover:bg-red-100"
              }`}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Lista de Vuelos */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-1">
          {selectedFlightKey && (
            <div className={`mb-2.5 p-2 rounded-lg flex items-center justify-between text-[10px] shrink-0 ${
              isDark ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-400" : "bg-blue-50 border border-blue-200 text-blue-800"
            }`}>
              <span className="truncate font-mono">
                Vuelo seleccionado: {flights.find(f => f.key === selectedFlightKey)?.id || selectedFlightKey}
              </span>
              <button
                onClick={() => {
                  if (onSelectFlightOnMap) {
                    onSelectFlightOnMap(null, null);
                  }
                  setExpandedKey(null);
                }}
                className="ml-2 font-bold hover:underline shrink-0"
              >
                Deseleccionar
              </button>
            </div>
          )}
          {paginatedFlights.map(f => {
            const isSelected = selectedFlightKey === f.key || expandedKey === f.key;
            const utilColor = getOccupancyColor(f.utilization);

            return (
              <div
                key={f.key}
                className={`rounded-md mb-1.5 border transition-all overflow-hidden ${
                  isSelected ? activeRow : `${hoverRow} border-transparent`
                }`}
              >
                {/* Cabecera del Vuelo */}
                <button
                  onClick={() => handleFlightClick(f)}
                  className="w-full text-left px-2 py-2 flex items-center justify-between gap-1"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Plane className={`w-3 h-3 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                      <span className={`font-mono font-bold ${titleCls} truncate`}>{f.id}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    <span className="font-mono text-[10.5px]">
                      {f.currentLoad} / <span className={mutedCls}>{f.capacity}</span>
                    </span>
                    <Badge
                      className="text-[9px] py-0 px-1 font-mono font-bold border"
                      style={{
                        backgroundColor: `${utilColor}15`,
                        color: utilColor,
                        borderColor: `${utilColor}30`
                      }}
                    >
                      {f.utilization.toFixed(1)}%
                    </Badge>
                  </div>
                </button>

                {/* Detalles del Vuelo (Desplegable) */}
                {expandedKey === f.key && (
                  <div className={`px-2.5 pb-2.5 pt-1.5 border-t text-[10px] space-y-2 bg-black/15 ${headerBorder}`}>
                    <div className="space-y-1.5 text-[9.5px]">
                      <div>
                        <span className={mutedCls}>Salida:</span>
                        <div className={`font-medium ${subCls}`}>{f.departureTime}</div>
                      </div>
                      <div>
                        <span className={mutedCls}>Llegada:</span>
                        <div className={`font-medium ${subCls}`}>{f.arrivalTime}</div>
                      </div>
                    </div>

                    {/* Lista de envíos */}
                    <div className="space-y-1">
                      <div className={`text-[9px] font-semibold uppercase tracking-wider ${mutedCls} flex items-center gap-1`}>
                        <Package className="w-2.5 h-2.5" />
                        Envíos a bordo ({f.shipments.length})
                      </div>
                      <div className="max-h-56 overflow-y-auto pr-1 space-y-0.5 border rounded-lg p-1 bg-black/25">
                        {f.shipments.map(s => (
                          <div key={s.id} className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-white/5 font-mono">
                            <span className={titleCls}>{s.id}</span>
                            <span className="text-cyan-400 font-bold">x{s.cant}</span>
                          </div>
                        ))}
                        {f.shipments.length === 0 && (
                          <div className={`text-center py-2 italic ${dimCls}`}>
                            Sin envíos registrados
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {processedFlights.length === 0 && (
            <div className={`text-center py-12 ${dimCls} italic`}>
              No se encontraron vuelos activos.
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Controles de Paginación */}
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
            Página <span className={`font-semibold ${titleCls}`}>{currentPage}</span> de <span className={`font-semibold ${titleCls}`}>{totalPages}</span> ({processedFlights.length} vuelos)
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
