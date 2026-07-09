import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { BaggageGroup } from "../engine/types";
import { Search, Package, MapPin, Plane, CheckCircle, AlertTriangle, Clock, ChevronRight, X } from "lucide-react";

const statusConfig: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  waiting:    { color: "text-amber-500",  bg: "bg-amber-500/20",  label: "En espera",   icon: <Clock className="w-3 h-3" /> },
  scheduled:  { color: "text-purple-500", bg: "bg-purple-500/20", label: "Programado",  icon: <Clock className="w-3 h-3" /> },
  in_transit: { color: "text-blue-700",   bg: "bg-blue-600/20",   label: "En tránsito", icon: <Plane className="w-3 h-3" /> },
  delivered:  { color: "text-green-500",  bg: "bg-green-500/20",  label: "Entregado",   icon: <CheckCircle className="w-3 h-3" /> },
  delayed:    { color: "text-orange-500", bg: "bg-orange-500/20", label: "Retrasado",   icon: <AlertTriangle className="w-3 h-3" /> },
  failed:     { color: "text-red-500",    bg: "bg-red-500/20",    label: "Fallido",     icon: <AlertTriangle className="w-3 h-3" /> },
  waiting_replan: { color: "text-amber-500 animate-pulse", bg: "bg-amber-500/20 border border-amber-500/30", label: "Esperando replanificación", icon: <Clock className="w-3 h-3 animate-spin" style={{ animationDuration: '3s' }} /> },
};

const SIM_BASE_DATE = new Date(2026, 3, 2, 0, 0, 0);

function formatTimestamp(ts: number): string {
  if (!ts || isNaN(ts)) return "—";
  const d = new Date(ts);
  const day   = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year  = d.getUTCFullYear();
  const hh    = String(d.getUTCHours()).padStart(2, "0");
  const mm    = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} ${hh}:${mm}`;
}

interface BaggageTrackingProps {
  selectedBaggage: BaggageGroup | null;
  onSelectBaggage: (bg: BaggageGroup | null) => void;
  selectedFlightBaggageIds?: string[] | null;
  selectedFlightKey?: string | null;
  onClearFlightFilter?: () => void;
  hideHeader?: boolean;
  selectedWarehouseCode?: string | null;
}

export function BaggageTracking({
  selectedBaggage: selectedBaggageProp,
  onSelectBaggage,
  selectedFlightBaggageIds,
  selectedFlightKey,
  onClearFlightFilter,
  hideHeader = false,
  selectedWarehouseCode,
}: BaggageTrackingProps) {
  const { state, airportsList } = useSim();
  const { isDark } = useTheme();

  // Siempre usar la versión más actualizada del equipaje desde el estado global
  const selectedBaggage = useMemo(() => {
    if (!selectedBaggageProp) return null;
    return state.baggageGroups.find(bg => bg.id === selectedBaggageProp.id) || selectedBaggageProp;
  }, [selectedBaggageProp, state.baggageGroups]);

  // Resolver dinámicamente el tramo actual en base al currentTime
  const currentLegIndexResolved = useMemo(() => {
    if (!selectedBaggage) return 0;
    const smoothTime = state.currentTime;

    if (state.scenario === "daily" || state.scenario === "tracking") {
      return selectedBaggage.currentLegIndex;
    }

    const flyingIdx = (selectedBaggage.route || []).findIndex(
      (leg: any) => smoothTime >= leg.departureTime && smoothTime < leg.arrivalTime
    );
    if (flyingIdx !== -1) return flyingIdx;

    const nextFutureIdx = (selectedBaggage.route || []).findIndex(
      (leg: any) => smoothTime < leg.departureTime
    );
    if (nextFutureIdx !== -1) return nextFutureIdx;

    return (selectedBaggage.route || []).length;
  }, [selectedBaggage, state.currentTime, state.scenario]);

  const [search, setSearch] = useState("");
  const [selectedOriginFilter, setSelectedOriginFilter] = useState<string>("ALL");
  const [selectedDestFilter, setSelectedDestFilter] = useState<string>("ALL");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("ALL");

  // Pinned baggage: fixed at the top when selected, does not move with list updates
  const [pinnedBaggage, setPinnedBaggage] = useState<BaggageGroup | null>(null);
  const pinnedBaggageRef = useRef<BaggageGroup | null>(null);

  const getGmt = (oaci: string) => {
    const ap = airportsList.find((a: any) => a.code === oaci);
    if (!ap || !ap.timezone) return 0;
    const match = ap.timezone.match(/UTC([+-]\d+(?:\.\d+|:\d+)?)/);
    if (!match) return 0;
    const val = match[1];
    if (val.includes(":")) {
      const parts = val.split(":");
      const hours = parseInt(parts[0], 10);
      const mins = parseInt(parts[1], 10);
      const sign = hours < 0 ? -1 : 1;
      return hours + sign * (mins / 60);
    }
    return parseFloat(val);
  };

  const gmtLabel = (oaci: string) => {
    const ap = airportsList.find((a: any) => a.code === oaci);
    if (!ap || !ap.timezone) return "GMT+0";
    return ap.timezone.replace("UTC", "GMT");
  };

  const formatTimestampLocal = (ts: number, oaci: string): string => {
    if (!ts || isNaN(ts)) return "—";
    const offset = getGmt(oaci);
    const localMs = ts + offset * 3600_000;
    const d = new Date(localMs);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const year = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${day}-${month}-${year} ${hh}:${mm} ${gmtLabel(oaci)}`;
  };

  const getCity = (code: string) => airportsList.find(a => a.code === code)?.city || code;

  const getDepartureTimeOnly = (ts: number) => {
    if (!ts || isNaN(ts)) return "";
    const d = new Date(ts);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const isIntercontinental = (bg: BaggageGroup): boolean => {
    if (bg.route.length === 0) return false;
    const firstFlight = state.flights.find(f => f.id === bg.route[0].flightId);
    return firstFlight?.intercontinental ?? false;
  };

  const getDeadline = (bg: BaggageGroup): number => {
    return bg.deadlineAt ?? (bg.registeredAt + (isIntercontinental(bg) ? 48 : 24) * 3600000);
  };

  const filtered = state.baggageGroups
    .filter(bg => {
      if (selectedFlightBaggageIds && !selectedFlightBaggageIds.includes(bg.id)) {
        return false;
      }

      // Filter by selected warehouse
      if (selectedWarehouseCode && bg.origin !== selectedWarehouseCode && bg.destination !== selectedWarehouseCode) {
        return false;
      }

      if (selectedOriginFilter !== "ALL" && bg.origin !== selectedOriginFilter) {
        return false;
      }

      if (selectedDestFilter !== "ALL" && bg.destination !== selectedDestFilter) {
        return false;
      }

      if (selectedStatusFilter !== "ALL" && bg.status !== selectedStatusFilter) {
        return false;
      }

      const finalArrival = bg.route && bg.route.length > 0
        ? bg.route[bg.route.length - 1].arrivalTime
        : bg.deadlineAt;

      // Include delivered/failed orders from last 4 hours of simulation time
      if ((bg.status === "delivered" || bg.status === "failed") && finalArrival && finalArrival < state.currentTime) {
        const fourHoursInMs = 4 * 60 * 60 * 1000;
        if (finalArrival < state.currentTime - fourHoursInMs) {
          return false;
        }
      }

      if (!search) return true;
      const s = search.toLowerCase();
      return String(bg.id).toLowerCase().includes(s) ||
        bg.origin.toLowerCase().includes(s) ||
        bg.destination.toLowerCase().includes(s) ||
        bg.airline.toLowerCase().includes(s);
    })
    .filter(bg => !pinnedBaggageRef.current || bg.id !== pinnedBaggageRef.current.id)
    .reverse();

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Reset page when search or flight filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedFlightKey, selectedWarehouseCode, selectedOriginFilter, selectedDestFilter, selectedStatusFilter]);

  const totalPages = Math.ceil(filtered.length / pageSize);

  const paginatedBaggages = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filtered.slice(startIndex, startIndex + pageSize);
  }, [filtered, currentPage, pageSize]);

  // Jump to page of selected baggage OR pin it if it changes from outside
  useEffect(() => {
    if (selectedBaggage) {
      // Pin it to the top
      pinnedBaggageRef.current = selectedBaggage;
      setPinnedBaggage(selectedBaggage);
      setCurrentPage(1);
    } else {
      pinnedBaggageRef.current = null;
      setPinnedBaggage(null);
    }
  }, [selectedBaggage?.id]);

  const sc = selectedBaggage ? statusConfig[selectedBaggage.status] : null;

  // Theme tokens
  const headerBorder = isDark ? "border-[#1e293b]" : "border-[#c8d0d8]";
  const titleCls     = isDark ? "text-white"       : "text-[#111827]";
  const subCls       = isDark ? "text-white/70"    : "text-[#374151]";
  const mutedCls     = isDark ? "text-white/50"    : "text-[#6b7280]";
  const dimCls       = isDark ? "text-white/40"    : "text-[#9ca3af]";
  const detailBg     = isDark ? "bg-[#0f172a]"     : "bg-[#dde3ea]";
  const trackLineBg  = isDark ? "bg-[#1e293b]"     : "bg-[#c8d0d8]";
  const dotInactive  = isDark ? "bg-[#334155]"     : "bg-[#a0aec0]";
  const hoverRow     = isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]";
  const searchBg     = isDark ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30" : "bg-white border-[#c8d0d8] text-[#111827] placeholder:text-[#9ca3af]";
  const searchIcon   = isDark ? "text-white/40"    : "text-[#9ca3af]";
  const emptyText    = isDark ? "text-white/30"    : "text-[#9ca3af]";

  return (
    <div className="flex flex-col h-full min-h-0">
      {!hideHeader && (
        <div className={`flex items-center gap-2 px-3 py-2 border-b ${headerBorder}`}>
          <Package className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
          <span className={`text-[13px] ${titleCls}`}>Monitoreo de Envíos</span>
        </div>
      )}

      {/* Búsqueda y Filtros */}
      <div className={`px-3 py-2 border-b flex flex-col gap-2 ${headerBorder}`}>
        <div className="relative">
          <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${searchIcon}`} />
          <Input
            placeholder="Buscar ID, origen, destino..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`pl-7 h-7 text-[11px] ${searchBg}`}
          />
        </div>
        <div className="flex gap-2">
          <Select value={selectedOriginFilter} onValueChange={setSelectedOriginFilter}>
            <SelectTrigger className={`h-7 text-[11px] flex-1 ${searchBg}`}>
              <SelectValue placeholder="Origen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los orígenes</SelectItem>
              {Array.from(new Set(state.baggageGroups.map(bg => bg.origin))).sort().map(code => (
                <SelectItem key={code} value={code}>
                  {code} - {getCity(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedDestFilter} onValueChange={setSelectedDestFilter}>
            <SelectTrigger className={`h-7 text-[11px] flex-1 ${searchBg}`}>
              <SelectValue placeholder="Destino" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los destinos</SelectItem>
              {Array.from(new Set(state.baggageGroups.map(bg => bg.destination))).sort().map(code => (
                <SelectItem key={code} value={code}>
                  {code} - {getCity(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Select value={selectedStatusFilter} onValueChange={setSelectedStatusFilter}>
            <SelectTrigger className={`h-7 text-[11px] flex-1 ${searchBg}`}>
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los estados</SelectItem>
              {state.scenario === "daily" || state.scenario === "tracking" ? (
                <>
                  <SelectItem value="waiting">En espera</SelectItem>
                  <SelectItem value="in_transit">En tránsito</SelectItem>
                  <SelectItem value="delayed">Retrasado</SelectItem>
                  <SelectItem value="delivered">Entregado</SelectItem>
                  <SelectItem value="failed">Fallido</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="scheduled">Programado</SelectItem>
                  <SelectItem value="in_transit">En tránsito</SelectItem>
                  <SelectItem value="waiting_replan">Esperando replanificación</SelectItem>
                  <SelectItem value="delivered">Entregado</SelectItem>
                  <SelectItem value="failed">Fuera de plazo</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Indicador de filtro de vuelo */}
      {selectedFlightKey && (
        <div className={`mx-3 my-2 p-2 rounded-lg flex items-center justify-between text-[10px] shrink-0 ${isDark ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-400" : "bg-blue-50 border border-blue-200 text-blue-800"}`}>
          <span className="truncate">
            Filtrando por vuelo: {(() => {
              const parts = selectedFlightKey.split('-');
              // Buscar la parte que parece una hora (contiene ":") y tomar hasta esa parte
              const timeIndex = parts.findIndex(p => p.includes(':'));
              if (timeIndex >= 0 && timeIndex >= 1) {
                // Tomar origen, destino y hora
                return parts.slice(0, timeIndex + 1).join('-');
              }
              // Si no hay hora, tomar las primeras 3 partes por defecto
              if (parts.length >= 3) {
                return parts.slice(0, 3).join('-');
              }
              return selectedFlightKey;
            })()}
          </span>
          <button
            onClick={onClearFlightFilter}
            className="ml-2 font-bold hover:underline shrink-0"
          >
            Ver todos
          </button>
        </div>
      )}

      {/* Detalle de maleta seleccionada */}
      {selectedBaggage && sc && (
        <div className={`px-3 py-2 border-b ${headerBorder} ${detailBg}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[12px] font-bold ${titleCls}`}>{selectedBaggage.id}</span>
            <Badge className={`text-[9px] ${sc.bg} ${sc.color}`}>
              {sc.icon} <span className="ml-1">{sc.label}</span>
            </Badge>
          </div>
          <div className={`text-[10px] mb-2 ${subCls}`}>
            {selectedBaggage.airline} | {selectedBaggage.quantity} maletas
          </div>

          {/* Línea de tiempo de la ruta */}
          <div className="space-y-0 max-h-56 overflow-y-auto mt-2">
            {/* Aeropuerto origen */}
            <div className="flex items-start gap-2">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} />
              <div className="flex-1">
                <div className={`text-[10px] font-semibold ${titleCls}`}>
                  {getCity(selectedBaggage.origin)} ({selectedBaggage.origin})
                </div>
                <div className={`text-[9px] ${mutedCls}`}>
                  Registro: {formatTimestampLocal(selectedBaggage.registeredAt, selectedBaggage.origin)}
                </div>
                {selectedBaggage.route.length > 0 && (
                  <div className={`text-[9px] ${isDark ? "text-cyan-400/80" : "text-cyan-700"}`}>
                    Salida: {formatTimestampLocal(selectedBaggage.route[0].departureTime, selectedBaggage.origin)}
                  </div>
                )}
              </div>
            </div>

            {selectedBaggage.route.map((leg, i) => {
              const isCompleted = i < currentLegIndexResolved;
              const isCurrent = i === currentLegIndexResolved && selectedBaggage.status === "in_transit";
              const isLastLeg = i === selectedBaggage.route.length - 1;
              const nextLeg = selectedBaggage.route[i + 1];
              
              return (
                <React.Fragment key={i}>
                  <div className={`ml-[4px] w-[2px] h-3.5 ${trackLineBg} relative`}>
                    {(isCompleted || isCurrent) && (
                      <div className={`absolute inset-0 ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} style={{ height: isCurrent ? "50%" : "100%" }} />
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isCompleted ? (isDark ? "bg-cyan-500" : "bg-blue-600") : isCurrent ? (isDark ? "bg-cyan-500 animate-pulse" : "bg-blue-600 animate-pulse") : dotInactive}`} />
                    <div className="flex-1">
                      <div className={`text-[10px] font-semibold ${titleCls}`}>
                        {getCity(leg.to)} ({leg.to})
                      </div>
                      <div className={`text-[9px] ${mutedCls}`}>
                        Llegada: {formatTimestampLocal(leg.arrivalTime, leg.to)}
                      </div>
                      {!isLastLeg && nextLeg && (
                        <div className={`text-[9px] ${isDark ? "text-cyan-400/80" : "text-cyan-700"}`}>
                          Salida: {formatTimestampLocal(nextLeg.departureTime, leg.to)}
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            <div className={`ml-[4px] w-[2px] h-3 ${trackLineBg}`} />
            <div className="flex items-start gap-2">
              <div
                className={`w-2.5 h-2.5 shrink-0 mt-0.5 ${selectedBaggage.status === "delivered" ? "bg-green-500" : selectedBaggage.status === "failed" ? "bg-red-500" : dotInactive}`}
                style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
              />
              <div className="flex-1">
                <div className={`text-[9px] ${mutedCls}`}>
                  Plazo: {formatTimestampLocal(getDeadline(selectedBaggage), selectedBaggage.destination)}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectBaggage(null)}
            className={`mt-2 text-[10px] transition-colors ${isDark ? "text-cyan-500 hover:text-cyan-400" : "text-blue-700 hover:text-blue-800"}`}
          >
            Cerrar detalle
          </button>
        </div>
      )}

      {/* Lista */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-1">

          {/* ── Envío fijado al inicio (datos en tiempo real) ── */}
          {pinnedBaggage && (() => {
            // Siempre usar la versión más reciente del envío desde state
            const bg = state.baggageGroups.find(b => b.id === pinnedBaggage.id) ?? pinnedBaggage;
            const s = statusConfig[bg.status];
            const isSelected = selectedBaggage?.id === bg.id;
            return (
              <div className="mb-1">
                {/* Etiqueta */}
                <div className={`mb-1 px-1.5 py-0.5 flex items-center gap-1 text-[9px] font-semibold rounded ${
                  isDark ? "text-cyan-400/80" : "text-blue-600/80"
                }`}>
                  <MapPin className="w-2.5 h-2.5" />
                  <span>Envío fijado</span>
                  <button
                    onClick={() => {
                      pinnedBaggageRef.current = null;
                      setPinnedBaggage(null);
                      onSelectBaggage(null);
                    }}
                    className="ml-auto hover:text-red-400 transition-colors"
                    title="Desfijar envío"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>

                <button
                  onClick={() => onSelectBaggage(isSelected ? null : bg)}
                  className={`w-full text-left px-2 py-1.5 rounded-md mb-0.5 flex items-center gap-2 transition-colors ${
                    isSelected
                      ? (isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-blue-600/10 border border-blue-600/30")
                      : `${hoverRow} border border-transparent`
                  }`}
                >
                  <div className={`shrink-0 ${s.color}`}>{s.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] ${titleCls}`}>{bg.id}</span>
                      <span className={`text-[9px] ${dimCls}`}>x{bg.quantity}</span>
                    </div>
                    <div className={`text-[9px] truncate ${subCls}`}>
                      {bg.origin} <ChevronRight className="w-2 h-2 inline" /> {bg.destination}
                    </div>
                    <div className={`text-[8.5px] ${mutedCls} truncate`}>
                      {bg.airline}
                    </div>
                  </div>
                  <span className={`text-[9px] ${mutedCls}`}>{bg.currentLocation}</span>
                </button>

                {/* Separador */}
                <div className={`my-2 border-t ${headerBorder} border-dashed`} />
              </div>
            );
          })()}

          {paginatedBaggages.map(bg => {
            const s = statusConfig[bg.status];
            const isSelected = selectedBaggage?.id === bg.id;
            return (
              <button
                key={bg.id}
                onClick={() => onSelectBaggage(isSelected ? null : bg)}
                className={`w-full text-left px-2 py-1.5 rounded-md mb-0.5 flex items-center gap-2 transition-colors ${
                  isSelected ? (isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-blue-600/10 border border-blue-600/30") : `${hoverRow} border border-transparent`
                }`}
              >
                <div className={`shrink-0 ${s.color}`}>{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] ${titleCls}`}>{bg.id}</span>
                    <span className={`text-[9px] ${dimCls}`}>x{bg.quantity}</span>
                  </div>
                  <div className={`text-[9px] truncate ${subCls}`}>
                    {bg.origin} <ChevronRight className="w-2 h-2 inline" /> {bg.destination}
                  </div>
                  <div className={`text-[8.5px] ${mutedCls} truncate`}>
                    {bg.airline}
                  </div>
                </div>
                <span className={`text-[9px] ${mutedCls}`}>{bg.currentLocation}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className={`text-[11px] text-center py-8 ${emptyText}`}>
              {state.baggageGroups.length === 0 ? "Inicia la simulación para ver maletas" : "Sin resultados"}
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
            Página <span className={`font-semibold ${titleCls}`}>{currentPage}</span> de <span className={`font-semibold ${titleCls}`}>{totalPages}</span> ({filtered.length} envíos)
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