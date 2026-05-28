import React, { useState } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import type { BaggageGroup } from "../engine/types";
import { Search, Package, MapPin, Plane, CheckCircle, AlertTriangle, Clock, ChevronRight } from "lucide-react";

const statusConfig: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  waiting:    { color: "text-amber-500",  bg: "bg-amber-500/20",  label: "En espera",   icon: <Clock className="w-3 h-3" /> },
  in_transit: { color: "text-blue-700",   bg: "bg-blue-600/20",   label: "En tránsito", icon: <Plane className="w-3 h-3" /> },
  delivered:  { color: "text-green-500",  bg: "bg-green-500/20",  label: "Entregado",   icon: <CheckCircle className="w-3 h-3" /> },
  delayed:    { color: "text-orange-500", bg: "bg-orange-500/20", label: "Retrasado",   icon: <AlertTriangle className="w-3 h-3" /> },
  failed:     { color: "text-red-500",    bg: "bg-red-500/20",    label: "Fallido",     icon: <AlertTriangle className="w-3 h-3" /> },
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
}

export function BaggageTracking({ selectedBaggage, onSelectBaggage }: BaggageTrackingProps) {
  const { state, airportsList } = useSim();
  const { isDark } = useTheme();
  const [search, setSearch] = useState("");

  const getCity = (code: string) => airportsList.find(a => a.code === code)?.city || code;

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
      const finalArrival = bg.route && bg.route.length > 0
        ? bg.route[bg.route.length - 1].arrivalTime
        : bg.deadlineAt;

      if (finalArrival && finalArrival < state.currentTime) {
        return false;
      }

      if (!search) return true;
      const s = search.toLowerCase();
      return String(bg.id).toLowerCase().includes(s) ||
        bg.origin.toLowerCase().includes(s) ||
        bg.destination.toLowerCase().includes(s) ||
        bg.airline.toLowerCase().includes(s);
    })
    .slice(-50)
    .reverse();

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
    <div className="flex flex-col h-full">
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${headerBorder}`}>
        <Package className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
        <span className={`text-[13px] ${titleCls}`}>Rastreo de Maletas</span>
      </div>

      {/* Búsqueda */}
      <div className={`px-3 py-2 border-b ${headerBorder}`}>
        <div className="relative">
          <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${searchIcon}`} />
          <Input
            placeholder="Buscar ID, origen, destino..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`pl-7 h-7 text-[11px] ${searchBg}`}
          />
        </div>
      </div>

      {/* Detalle de maleta seleccionada */}
      {selectedBaggage && sc && (
        <div className={`px-3 py-2 border-b ${headerBorder} ${detailBg}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[12px] ${titleCls}`}>{selectedBaggage.id}</span>
            <Badge className={`text-[9px] ${sc.bg} ${sc.color}`}>
              {sc.icon} <span className="ml-1">{sc.label}</span>
            </Badge>
          </div>
          <div className={`text-[10px] mb-2 ${subCls}`}>
            {selectedBaggage.airline} | {selectedBaggage.quantity} maletas
          </div>

          {/* Línea de tiempo de la ruta */}
          <div className="space-y-0">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full shrink-0 ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} />
              <div className="flex-1">
                <div className={`text-[10px] ${titleCls}`}>
                  {getCity(selectedBaggage.origin)} ({selectedBaggage.origin})
                </div>
                <div className={`text-[9px] ${mutedCls}`}>
                  {selectedBaggage.route.length > 0
                    ? `Salida: ${formatTimestamp(selectedBaggage.route[0].departureTime)} | Llegada: ${formatTimestamp(selectedBaggage.route[0].arrivalTime)}`
                    : `Registro: ${formatTimestamp(selectedBaggage.registeredAt)}`}
                </div>
              </div>
            </div>

            {selectedBaggage.route.map((leg, i) => {
              const isCompleted = i < selectedBaggage.currentLegIndex;
              const isCurrent = i === selectedBaggage.currentLegIndex && selectedBaggage.status === "in_transit";
              return (
                <React.Fragment key={i}>
                  <div className={`ml-[3px] w-[2px] h-3 ${trackLineBg} relative`}>
                    {(isCompleted || isCurrent) && (
                      <div className={`absolute inset-0 ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} style={{ height: isCurrent ? "50%" : "100%" }} />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isCompleted ? (isDark ? "bg-cyan-500" : "bg-blue-600") : isCurrent ? (isDark ? "bg-cyan-500 animate-pulse" : "bg-blue-600 animate-pulse") : dotInactive}`} />
                    <div className="flex-1">
                      <div className={`text-[10px] ${titleCls}`}>
                        {getCity(leg.to)} ({leg.to})
                      </div>
                      <div className={`text-[9px] ${mutedCls}`}>
                        Salida: {formatTimestamp(leg.departureTime)} | Llegada: {formatTimestamp(leg.arrivalTime)}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            <div className={`ml-[3px] w-[2px] h-2 ${trackLineBg}`} />
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 shrink-0 ${selectedBaggage.status === "delivered" ? "bg-green-500" : selectedBaggage.status === "failed" ? "bg-red-500" : dotInactive}`}
                style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
              />
              <div className={`text-[9px] ${mutedCls}`}>
                Plazo: {formatTimestamp(getDeadline(selectedBaggage))}
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
      <ScrollArea className="flex-1">
        <div className="px-2 py-1">
          {filtered.map(bg => {
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
    </div>
  );
}