import React, { useState, useCallback } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { SimulationMap } from "./SimulationMap";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import type { BaggageGroup } from "../engine/types";
import { Search, Package, Plane, CheckCircle, AlertTriangle, Clock, ChevronRight, X } from "lucide-react";

const statusConfig: Record<string, { color: string; bg: string; lightBg: string; lightColor: string; label: string; icon: React.ReactNode }> = {
  waiting:    { color: "text-amber-500",  bg: "bg-amber-500/20",  lightBg: "bg-amber-100", lightColor: "text-amber-700", label: "En espera",   icon: <Clock className="w-3 h-3" /> },
  in_transit: { color: "text-blue-700",   bg: "bg-blue-600/20",   lightBg: "bg-blue-100",  lightColor: "text-blue-800",  label: "En tránsito", icon: <Plane className="w-3 h-3" /> },
  delivered:  { color: "text-green-500",  bg: "bg-green-500/20",  lightBg: "bg-green-100", lightColor: "text-green-700", label: "Entregado",   icon: <CheckCircle className="w-3 h-3" /> },
  delayed:    { color: "text-orange-500", bg: "bg-orange-500/20", lightBg: "bg-orange-100",lightColor: "text-orange-700",label: "Retrasado",   icon: <AlertTriangle className="w-3 h-3" /> },
  failed:     { color: "text-red-500",    bg: "bg-red-500/20",    lightBg: "bg-red-100",   lightColor: "text-red-700",   label: "Fallido",     icon: <AlertTriangle className="w-3 h-3" /> },
};

function formatSimTime(ts: number): string {
  if (!ts || isNaN(ts)) return "—";
  const d = new Date(ts);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} ${hh}:${mm}`;
}

export function AirlineTracking() {
  const { state, airportsList } = useSim();
  const { isDark } = useTheme();
  const [search, setSearch] = useState("");
  const [selectedBaggage, setSelectedBaggage] = useState<BaggageGroup | null>(null);
  const [showPanel, setShowPanel] = useState(true);

  const getCity = (code: string) => airportsList.find(a => a.code === code)?.city || code;

  const isIntercontinental = (bg: BaggageGroup): boolean => {
    if (bg.route.length === 0) return false;
    const firstFlight = state.flights.find(f => f.id === bg.route[0].flightId);
    return firstFlight?.intercontinental ?? false;
  };

  const getDeadline = (bg: BaggageGroup): number => {
    return bg.deadlineAt ?? (bg.registeredAt + (isIntercontinental(bg) ? 48 : 24) * 3600000);
  };

  const filtered = state.baggageGroups.filter(bg => {
    if (!search) return true;
    const s = search.toLowerCase();
    return bg.id.toLowerCase().includes(s) ||
      bg.origin.toLowerCase().includes(s) ||
      bg.destination.toLowerCase().includes(s) ||
      bg.airline.toLowerCase().includes(s);
  });

  const handleSelectBaggage = (bg: BaggageGroup | null) => {
    setSelectedBaggage(bg);
    if (bg) setSearch(bg.id);
  };

  const handleClear = () => {
    setSearch("");
    setSelectedBaggage(null);
  };

  const rootBg = isDark ? "bg-[#080c18]" : "bg-[#eef2f7]";
  const panelBg = isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]";
  const titleCls = isDark ? "text-white" : "text-[#111827]";
  const subCls = isDark ? "text-white/70" : "text-[#374151]";
  const mutedCls = isDark ? "text-white/50" : "text-[#6b7280]";
  const dimCls = isDark ? "text-white/40" : "text-[#9ca3af]";
  const searchBg = isDark
    ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30"
    : "bg-white border-[#c8d0d8] text-[#111827] placeholder:text-[#9ca3af]";
  const searchIcon = isDark ? "text-white/40" : "text-[#9ca3af]";
  const headerBorder = isDark ? "border-[#1e293b]" : "border-[#c8d0d8]";
  const trackLineBg = isDark ? "bg-[#1e293b]" : "bg-[#c8d0d8]";
  const dotInactive = isDark ? "bg-[#334155]" : "bg-[#a0aec0]";
  const hoverRow = isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]";
  const detailBg = isDark ? "bg-[#0f172a]" : "bg-[#dde3ea]";

  const sc = selectedBaggage ? statusConfig[selectedBaggage.status] : null;

  return (
    <div className={`h-full flex flex-col relative transition-colors duration-200 ${rootBg}`}>
      {/* Título */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center py-3 pointer-events-none">
        <h1 className={`text-[18px] tracking-wider ${isDark ? "text-cyan-400" : "text-blue-800 font-bold"}`} style={{ textShadow: isDark ? "0 0 20px #00e5ff60" : "none" }}>
          Tracking de Equipaje — Aerolínea
        </h1>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Mapa */}
        <div className="flex-1">
          <SimulationMap selectedBaggage={selectedBaggage} onSelectBaggage={handleSelectBaggage} />
        </div>

        {/* Panel derecho - Tracking */}
        {showPanel && (
          <div className={`absolute right-4 top-14 bottom-4 z-10 w-72 border rounded-xl backdrop-blur-sm overflow-hidden flex flex-col pointer-events-auto ${panelBg}`}>
            {/* Header */}
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
                  onChange={e => { setSearch(e.target.value); setSelectedBaggage(null); }}
                  className={`pl-7 h-7 text-[11px] ${searchBg}`}
                />
                {search && (
                  <button onClick={handleClear} className={`absolute right-2 top-1/2 -translate-y-1/2 ${dimCls} ${isDark ? "hover:text-cyan-500" : "hover:text-blue-700"}`}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Detalle de maleta seleccionada */}
            {selectedBaggage && sc && (
              <div className={`px-3 py-2 border-b ${headerBorder} ${detailBg}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[12px] ${titleCls}`}>{selectedBaggage.id}</span>
                  <Badge className={`text-[9px] ${isDark ? sc.bg : sc.lightBg} ${isDark ? sc.color : sc.lightColor}`}>
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
                          ? `Salida: ${formatSimTime(selectedBaggage.route[0].departureTime)} | Llegada: ${formatSimTime(selectedBaggage.route[0].arrivalTime)}`
                          : `Registro: ${formatSimTime(selectedBaggage.registeredAt)}`}
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
                              Salida: {formatSimTime(leg.departureTime)} | Llegada: {formatSimTime(leg.arrivalTime)}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {selectedBaggage.route.length === 0 && (
                    <div className={`ml-5 text-[10px] py-2 ${dimCls}`}>Sin ruta planificada</div>
                  )}

                  <div className={`ml-[3px] w-[2px] h-2 ${trackLineBg}`} />
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 shrink-0 ${selectedBaggage.status === "delivered" ? "bg-green-500" : selectedBaggage.status === "failed" ? "bg-red-500" : dotInactive}`}
                      style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
                    />
                    <div className={`text-[9px] ${mutedCls}`}>
                      Plazo: {formatSimTime(getDeadline(selectedBaggage))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleClear}
                  className={`mt-2 text-[10px] transition-colors ${isDark ? "text-cyan-500 hover:text-cyan-400" : "text-blue-700 hover:text-blue-800"}`}
                >
                  Cerrar detalle
                </button>
              </div>
            )}

            {/* Lista de resultados */}
            <ScrollArea className="flex-1">
              <div className="px-2 py-1">
                {!search && filtered.length === 0 && (
                  <div className={`text-[11px] text-center py-8 ${dimCls}`}>
                    Inicia la simulación para ver maletas
                  </div>
                )}
                {search && !selectedBaggage && filtered.length === 0 && (
                  <div className={`text-[11px] text-center py-8 ${dimCls}`}>
                    Sin resultados
                  </div>
                )}
                {!selectedBaggage && filtered.slice(0, 50).reverse().map(bg => {
                  const s = statusConfig[bg.status];
                  return (
                    <button
                      key={bg.id}
                      onClick={() => handleSelectBaggage(bg)}
                      className={`w-full text-left px-2 py-1.5 rounded-md mb-0.5 flex items-center gap-2 transition-colors ${hoverRow} border border-transparent`}
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
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Botón toggle panel */}
        <button
          onClick={() => setShowPanel(!showPanel)}
          className={`absolute right-4 top-3 z-20 px-2 py-1 border rounded-lg text-[10px] transition-colors ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`}
        >
          {showPanel ? "Ocultar" : "Rastreo"}
        </button>
      </div>
    </div>
  );
}