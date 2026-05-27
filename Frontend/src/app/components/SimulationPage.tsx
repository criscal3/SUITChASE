import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { SimulationMap } from "./SimulationMap";
import { BaggageTracking } from "./BaggageTracking";
import { TrackingPage } from "./TrackingPage";
import type { BaggageGroup } from "../engine/types";
import { Play, Pause, Square, Plane, Package, Clock, Download, Trophy, AlertTriangle, CheckCircle, XCircle, Warehouse } from "lucide-react";



function formatTimestampShort(ts: number): string {
  if (!ts || isNaN(ts)) return "";
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function SimulationPage() {
  const { state, start, stop, togglePause, updateSpeed, reset, setScenario, confirmFastForward, cancelFastForward, pendingStartDate } = useSim();
  const { isDark } = useTheme();
  const [selectedBaggage, setSelectedBaggage] = useState<BaggageGroup | null>(null);
  const [showTracking, setShowTracking] = useState(true);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [viewMode, setViewMode] = useState<"simulation" | "tracking">("simulation");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showHighlights, setShowHighlights] = useState(false);
  const prevRunning = useRef(false);

  // Show highlights only when stopped (red button) or collapsed — NOT on pause
  useEffect(() => {
    // Detect stop (state has stopped flag) or collapse
    if ((state as any).stopped && state.currentTime > 0) {
      setShowHighlights(true);
    }
  }, [(state as any).stopped]);

  // Auto-show highlights on collapse
  useEffect(() => {
    if (state.collapsed && state.currentTime > 0) {
      setShowHighlights(true);
    }
  }, [state.collapsed, state.currentTime]);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 4);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll]);

  // Timeline: days 1..5 anchored to state.startTime
  const totalDays = 5;
  // current elapsed days from simulation start
  const elapsedMs = state.hasStarted ? Math.max(0, state.currentTime - state.startTime) : 0;
  const elapsedDays = elapsedMs / 86400000; // ms → days
  const currentSimDay = Math.floor(elapsedDays) + 1; // 1-based day number
  const currentSimHour = (elapsedDays % 1) * 24;    // fractional hour within the day
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  // Theme-aware class helpers
  const panelBg = isDark
    ? "bg-[#0a0f1eee] border-[#1a2744]"
    : "bg-white/90 border-[#cbd5e1]";
  const panelText = isDark ? "text-white" : "text-[#0f172a]";
  const subText = isDark ? "text-white/80" : "text-[#334155]";
  const mutedText = isDark ? "text-white/30" : "text-[#94a3b8]";
  const rootBg = isDark ? "bg-[#080c18]" : "bg-[#eef2f7]";

  const exportResults = (format: "json" | "csv") => {
    const data = {
      scenario: state.scenario,
      day: state.day,
      hour: state.hour,
      collapsed: state.collapsed,
      collapseReason: state.collapseReason,
      kpis: {
        totalRegistered: state.stats.totalRegistered,
        totalDelivered: state.stats.totalDelivered,
        totalInTransit: state.stats.totalInTransit,
        totalWaiting: state.stats.totalWaiting,
        totalDelayed: state.stats.totalDelayed,
        totalFailed: state.stats.totalFailed,
        onTimeRate: state.stats.onTimeRate,
        avgDeliveryTime: state.stats.avgDeliveryTime,
        warehouseUtilization: state.stats.warehouseUtilization,
        flightUtilization: state.stats.flightUtilization,
      },
    };
    let blob: Blob;
    let filename: string;
    if (format === "json") {
      blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      filename = `suitchase_sim_${state.scenario}_${Date.now()}.json`;
    } else {
      const headers = Object.keys(data.kpis).join(",");
      const values = Object.values(data.kpis).join(",");
      const csv = `scenario,day,hour,collapsed,collapseReason\n${data.scenario},${data.day},${data.hour},${data.collapsed},"${data.collapseReason}"\n\n${headers}\n${values}`;
      blob = new Blob([csv], { type: "text/csv" });
      filename = `suitchase_sim_${state.scenario}_${Date.now()}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`h-[calc(100vh-3rem)] flex flex-col -m-4 relative transition-colors duration-200 ${rootBg}`}>
      {/* Barra de título */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center py-3 pointer-events-none">
        <h1 className={`text-[18px] tracking-wider ${isDark ? "text-cyan-400" : "text-blue-800 font-bold"}`} style={{ textShadow: isDark ? "0 0 20px #00e5ff60" : "none" }}>
          Panel de Simulación Logística Global
        </h1>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Panel izquierdo - solo visible en modo simulación */}
        {viewMode === "simulation" && (
        <div className="absolute left-4 top-2 bottom-4 z-10 w-52 pointer-events-auto flex flex-col">
          {/* Fade top */}
          {canScrollUp && (
            <div className={`absolute top-0 left-0 right-0 h-8 z-10 pointer-events-none rounded-t-xl ${isDark ? "bg-gradient-to-b from-[#1a2340ee] to-transparent" : "bg-gradient-to-b from-[#c8d0dcea] to-transparent"}`} />
          )}
          <div
            ref={scrollRef}
            onScroll={checkScroll}
            className="flex-1 flex flex-col gap-3 overflow-y-auto hide-scrollbar"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {/* Spacer top for centering */}
            <div className="shrink-0 mt-auto" />
            {/* Estado de Aeropuertos */}
            <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
              <h4 className={`text-[12px] mb-2 ${panelText}`}>Estado de Aeropuertos</h4>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm bg-[#22c55e]"></div>
                <span className={`text-[10px] ${subText}`}>Capacidad Normal (&lt;50%)</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm bg-[#f59e0b]"></div>
                <span className={`text-[10px] ${subText}`}>Capacidad Moderada (&lt;80%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#ef4444]"></div>
                <span className={`text-[10px] ${subText}`}>Saturado (&gt;80%)</span>
              </div>
            </div>

            {/* Línea de tiempo */}
            {viewMode === "simulation" && state.scenario !== "collapse" && (
            <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
              <div className={`text-[12px] mb-3 ${panelText}`}>
                Simulación {state.scenario === "weekly" ? "5 Días" : "1 Día"}
              </div>
              <div className="space-y-1">
                {days.map(d => {
                  const isActive = state.hasStarted && currentSimDay === d;
                  const isPast = state.hasStarted && currentSimDay > d;
                  // Base start time for the timeline
                  const baseStartTime = state.hasStarted
                    ? state.startTime
                    : (pendingStartDate ? pendingStartDate.getTime() : (() => { const td = new Date(); td.setHours(0,0,0,0); return td.getTime(); })());
                  
                  // timestamp for this day's label
                  const dayTs = baseStartTime + (d - 1) * 86400000;
                  const timeStr = isActive
                    ? ` ${String(Math.floor(currentSimHour)).padStart(2,"0")}:${String(Math.round((currentSimHour%1)*60)).padStart(2,"0")}`
                    : "";
                  return (
                    <div key={d} className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        isActive ? (isDark ? "bg-cyan-400 animate-pulse" : "bg-blue-600 animate-pulse") : isPast ? (isDark ? "bg-cyan-400" : "bg-blue-600") : isDark ? "bg-[#1e293b]" : "bg-[#cbd5e1]"
                      }`} />
                      <div className={`flex-1 h-[1px] ${isDark ? "bg-[#1e293b]" : "bg-[#cbd5e1]"}`}>
                        {(isActive || isPast) && <div className={`h-full ${isDark ? "bg-cyan-400/30" : "bg-blue-600/30"}`} style={{ width: isActive ? `${(currentSimHour / 24) * 100}%` : "100%" }} />}
                      </div>
                      <span className={`text-[10px] ${isActive ? (isDark ? "text-cyan-400" : "text-blue-700") : isPast ? isDark ? "text-white/60" : "text-[#475569]" : mutedText}`}>
                        {formatTimestampShort(dayTs)}{timeStr}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            )}

            {/* Tarjetas de estadísticas */}
            <div className="space-y-2">
              <StatCard isDark={isDark} icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Vuelos Activos" value={state.flights.filter(f => !f.cancelled).length.toLocaleString()} />
              <StatCard isDark={isDark} icon={<Package className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Total Maletas" value={state.stats.totalRegistered.toLocaleString()} />
            </div>

            {/* Controles */}
            <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => {
                    if (!state.hasStarted || (state as any).stopped) {
                       start(pendingStartDate);
                    } else {
                       togglePause();
                    }
                  }}
                  className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
                    isDark ? "bg-cyan-500/20 border-cyan-500/40 hover:bg-cyan-500/30" : "bg-blue-600/10 border-blue-600/30 hover:bg-blue-600/20"
                  }`}
                >
                  {state.running ? <Pause className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} /> : <Play className={`w-5 h-5 ml-0.5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />}
                </button>
                <button
                  onClick={stop}
                  className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                >
                  <Square className="w-3 h-3 text-red-400" />
                </button>
              </div>
              {/* Export buttons */}
              <div className="flex items-center gap-1 mb-2">
                <button
                  onClick={() => exportResults("json")}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[9px] border transition-colors ${isDark ? "border-[#1a2744] text-white/60 hover:text-cyan-400 hover:border-cyan-500/30" : "border-[#cbd5e1] text-[#64748b] hover:text-blue-700 hover:border-blue-400"}`}
                >
                  <Download className="w-3 h-3" /> JSON
                </button>
                <button
                  onClick={() => exportResults("csv")}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[9px] border transition-colors ${isDark ? "border-[#1a2744] text-white/60 hover:text-cyan-400 hover:border-cyan-500/30" : "border-[#cbd5e1] text-[#64748b] hover:text-blue-700 hover:border-blue-400"}`}
                >
                  <Download className="w-3 h-3" /> CSV
                </button>
              </div>
              {/* Control de velocidad */}
              <SpeedSlider speed={state.speed} onChange={updateSpeed} isDark={isDark} />
            </div>

            {/* Escenarios */}
            <div className={`border rounded-xl p-2 backdrop-blur-sm space-y-1 ${panelBg}`}>
              <h4 className={`text-[11px] mb-1 px-1 font-semibold ${panelText}`}>Escenarios</h4>
              {([
                { key: "tracking", label: "Simulación en tiempo real" },
                { key: "weekly", label: "Simulación de 5 días" },
                { key: "collapse", label: "Hasta el Colapso" },
              ] as const).map(s => (
                <button
                  key={s.key}
                  onClick={() => {
                    if (s.key === "tracking") {
                      setViewMode("tracking");
                    } else {
                      setViewMode("simulation");
                      setScenario(s.key);
                    }
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-[10px] transition-colors ${
                    (s.key === "tracking" ? viewMode === "tracking" : viewMode === "simulation" && state.scenario === s.key)
                      ? isDark ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20" : "bg-blue-600/10 text-blue-700 border border-blue-600/20"
                      : `${subText} border border-transparent ${isDark ? "hover:bg-[#0f172a] hover:text-cyan-500" : "hover:bg-[#dde6f0] hover:text-blue-700"}`
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Spacer bottom for centering */}
            <div className="shrink-0 mb-auto" />
          </div>
          {/* Fade bottom */}
          {canScrollDown && (
            <div className={`absolute bottom-0 left-0 right-0 h-8 z-10 pointer-events-none rounded-b-xl ${isDark ? "bg-gradient-to-t from-[#1a2340ee] to-transparent" : "bg-gradient-to-t from-[#c8d0dcea] to-transparent"}`} />
          )}
        </div>
        )}

        {/* Selector de modo flotante en tracking */}
        {viewMode === "tracking" && (
          <div className="absolute left-4 top-2 bottom-4 z-30 pointer-events-auto w-52 flex flex-col">
          <div className="flex-1 flex flex-col gap-3 overflow-y-auto hide-scrollbar" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
            <div className="shrink-0 mt-auto" />
            {/* Estado de Aeropuertos */}
            <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
              <h4 className={`text-[12px] mb-2 ${panelText}`}>Estado de Aeropuertos</h4>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm bg-[#22c55e]"></div>
                <span className={`text-[10px] ${subText}`}>Capacidad Normal (&lt;50%)</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm bg-[#f59e0b]"></div>
                <span className={`text-[10px] ${subText}`}>Capacidad Moderada (&lt;80%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#ef4444]"></div>
                <span className={`text-[10px] ${subText}`}>Saturado (&gt;80%)</span>
              </div>
            </div>

            {/* Stats */}
            <div className="space-y-2">
              <StatCard isDark={isDark} icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Vuelos Activos" value={state.flights.filter(f => !f.cancelled).length.toLocaleString()} />
              <StatCard isDark={isDark} icon={<Package className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Total Maletas" value={state.stats.totalRegistered.toLocaleString()} />
            </div>

            {/* Escenarios */}
            <div className={`border rounded-xl p-2 backdrop-blur-sm space-y-1 ${panelBg}`}>
              <h4 className={`text-[11px] mb-1 px-1 font-semibold ${panelText}`}>Escenarios</h4>
              {([
                { key: "tracking", label: "Simulación en tiempo real" },
                { key: "weekly", label: "Simulación de 5 días" },
                { key: "collapse", label: "Hasta el Colapso" },
              ] as const).map(s => (
                <button
                  key={s.key}
                  onClick={() => {
                    if (s.key === "tracking") {
                      setViewMode("tracking");
                    } else {
                      setViewMode("simulation");
                      setScenario(s.key);
                    }
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-[10px] transition-colors ${
                    (s.key === "tracking" ? viewMode === "tracking" : viewMode === "simulation" && state.scenario === s.key)
                      ? isDark ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20" : "bg-blue-600/10 text-blue-700 border border-blue-600/20"
                      : `${subText} border border-transparent ${isDark ? "hover:bg-[#0f172a] hover:text-cyan-500" : "hover:bg-[#dde6f0] hover:text-blue-700"}`
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="shrink-0 mb-auto" />
          </div>
          </div>
        )}

        {/* Mapa / Tracking view */}
        {viewMode === "tracking" ? (
          <div className="flex-1">
            <TrackingPage embedded />
          </div>
        ) : (
          <>
            <div className="flex-1">
              <SimulationMap selectedBaggage={selectedBaggage} onSelectBaggage={setSelectedBaggage} />
            </div>

            {/* Panel derecho - Tracking */}
            {showTracking && (
              <div className={`absolute right-4 top-14 bottom-4 z-10 w-64 border rounded-xl backdrop-blur-sm overflow-hidden flex flex-col pointer-events-auto ${panelBg}`}>
                <BaggageTracking selectedBaggage={selectedBaggage} onSelectBaggage={setSelectedBaggage} />
              </div>
            )}

            <button
              onClick={() => setShowTracking(!showTracking)}
              className={`absolute right-4 top-3 z-20 px-2 py-1 border rounded-lg text-[10px] transition-colors ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`}
            >
              {showTracking ? "Ocultar" : "Rastreo"}
            </button>
          </>
        )}
      </div>

      {/* Highlights overlay (RF70) - shown on stop or collapse. Closing also resets when triggered by stop. */}
      {showHighlights && (
        <HighlightsPanel
          state={state}
          isDark={isDark}
          onClose={() => {
            setShowHighlights(false);
            if ((state as any).stopped) reset("weekly", 1);
          }}
          onReset={() => { setShowHighlights(false); reset("weekly", 1); }}
        />
      )}

      {/* Fast Forward — waiting popup (read-only mode while fast-forwarding) */}
      {state.fastForwardState === "running" && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className={`border rounded-xl w-full max-w-sm mx-4 p-5 ${isDark ? "bg-[#0f172a] border-[#334155]" : "bg-white border-[#cbd5e1]"}`}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-4 h-4 rounded-full border-2 border-t-transparent animate-spin ${isDark ? "border-cyan-400" : "border-blue-600"}`} />
              <h3 className={`text-[16px] font-medium ${isDark ? "text-[#e2e8f0]" : "text-[#0f172a]"}`}>
                Acelerando simulación x10
              </h3>
            </div>
            <p className={`text-[13px] mb-2 ${isDark ? "text-[#94a3b8]" : "text-[#475569]"}`}>
              Esperando a llegar a la fecha {state.targetDateStr}
            </p>
            <p className={`text-[11px] mb-5 ${isDark ? "text-[#64748b]" : "text-[#94a3b8]"}`}>
              Día actual: {state.day} · La simulación está en modo solo lectura mientras avanza.
            </p>
            <div className="flex justify-end">
              <button
                onClick={cancelFastForward}
                className={`px-4 py-2 text-[12px] border rounded-lg ${isDark ? "border-[#334155] text-[#94a3b8] hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]"}`}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fast Forward — reached popup (paused, ready to continue) */}
      {state.fastForwardState === "reached" && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className={`border rounded-xl w-full max-w-sm mx-4 p-5 ${isDark ? "bg-[#0f172a] border-[#334155]" : "bg-white border-[#cbd5e1]"}`}>
            <h3 className={`text-[16px] font-medium mb-3 ${isDark ? "text-[#e2e8f0]" : "text-[#0f172a]"}`}>
              Comenzar a partir de la fecha {state.targetDateStr}
            </h3>
            <p className={`text-[13px] mb-6 ${isDark ? "text-[#94a3b8]" : "text-[#475569]"}`}>
              La simulación está pausada y lista para comenzar.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelFastForward}
                className={`px-4 py-2 text-[12px] border rounded-lg ${isDark ? "border-[#334155] text-[#94a3b8] hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]"}`}
              >
                Cancelar
              </button>
              <button
                onClick={confirmFastForward}
                className={`px-4 py-2 text-[12px] rounded-lg text-white ${isDark ? "bg-cyan-600 hover:bg-cyan-700" : "bg-blue-600 hover:bg-blue-700"}`}
              >
                Iniciar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay de colapso - hidden when highlights are shown */}
      {state.collapsed && !showHighlights && (
        <div className="absolute inset-0 z-30 bg-red-900/20 flex items-center justify-center pointer-events-none">
          <div className="bg-[#0f172aee] border border-red-500/40 rounded-2xl px-8 py-6 text-center max-w-md pointer-events-auto">
            <div className="text-red-400 text-[16px] mb-2">Sistema Colapsado</div>
            <div className="text-[12px] text-white mb-4">{state.collapseReason}</div>
            <div className="flex items-center gap-2 justify-center">
              <button onClick={() => { setShowHighlights(true); }} className={`px-4 py-2 border rounded-lg text-[12px] ${isDark ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-600/10 border-blue-600/20 text-blue-700 hover:bg-blue-600/20"}`}>
                Ver Highlights
              </button>
              <button onClick={() => reset("weekly", 1)} className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-[12px] hover:bg-red-500/30">
                Reiniciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, isDark }: { icon: React.ReactNode; label: string; value: string; sub?: string; isDark: boolean }) {
  return (
    <div className={`border rounded-xl p-3 backdrop-blur-sm ${isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]"}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className={`text-[10px] ${isDark ? "text-white/80" : "text-[#334155]"}`}>{label}</span>
      </div>
      <div className={`text-[20px] ${isDark ? "text-white" : "text-[#0f172a]"}`} style={{ textShadow: isDark ? "0 0 10px #00e5ff30" : "none" }}>{value}</div>
      {sub && <div className={`text-[10px] ${isDark ? "text-white/50" : "text-[#64748b]"}`}>{sub}</div>}
    </div>
  );
}

function SpeedSlider({ speed, onChange, isDark }: { speed: number; onChange: (speed: number) => void; isDark: boolean }) {
  const speeds = [1, 2, 5, 10];
  const currentIdx = Math.max(0, speeds.indexOf(speed));
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const getIndexFromX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return currentIdx;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Snap to nearest index
    return Math.round(ratio * (speeds.length - 1));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const idx = getIndexFromX(e.clientX);
    if (speeds[idx] !== speed) onChange(speeds[idx]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const idx = getIndexFromX(e.clientX);
    if (speeds[idx] !== speed) onChange(speeds[idx]);
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  const thumbLeft = `${(currentIdx / (speeds.length - 1)) * 100}%`;

  return (
    <div className="flex flex-col gap-0.5 px-1">
      {/* Track area */}
      <div
        ref={trackRef}
        className="relative h-6 cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: "none" }}
      >
        {/* Background track */}
        <div className={`absolute top-[11px] left-0 right-0 h-[2px] rounded-full ${isDark ? "bg-[#1e293b]" : "bg-[#cbd5e1]"}`} />
        {/* Active track */}
        <div
          className={`absolute top-[11px] left-0 h-[2px] rounded-full transition-[width] duration-150 ${isDark ? "bg-cyan-400" : "bg-blue-600"}`}
          style={{ width: thumbLeft }}
        />
        {/* Tick marks */}
        {speeds.map((s, i) => (
          <div
            key={s}
            className={`absolute top-[6px] w-[2px] h-3 rounded-full -translate-x-1/2 ${
              i <= currentIdx ? (isDark ? "bg-cyan-400" : "bg-blue-600") : isDark ? "bg-[#475569]" : "bg-[#94a3b8]"
            }`}
            style={{ left: `${(i / (speeds.length - 1)) * 100}%` }}
          />
        ))}
        {/* Draggable thumb */}
        <div
          className={`absolute top-[6px] w-3 h-3 -translate-x-1/2 rounded-full border-2 transition-[left] duration-150 cursor-grab active:cursor-grabbing ${isDark ? "bg-cyan-400 border-cyan-300 shadow-[0_0_6px_#00e5ff80]" : "bg-blue-600 border-blue-400 shadow-[0_0_6px_#2563eb80]"}`}
          style={{ left: thumbLeft }}
        />
      </div>
      {/* Labels */}
      <div className="relative h-3">
        {speeds.map((s, i) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`absolute -translate-x-1/2 text-[9px] transition-colors ${
              i === currentIdx ? (isDark ? "text-cyan-400" : "text-blue-700") : isDark ? "text-[#64748b]" : "text-[#94a3b8]"
            }`}
            style={{ left: `${(i / (speeds.length - 1)) * 100}%` }}
          >
            x{s}
          </button>
        ))}
      </div>
    </div>
  );
}

function HighlightsPanel({ state, isDark, onClose, onReset }: {
  state: import("../engine/types").SimulationState;
  isDark: boolean;
  onClose: () => void;
  onReset: () => void;
}) {
  const { stats, airports, baggageGroups, collapsed, collapseReason, day } = state;

  // Top saturated airports
  const airportEntries = Object.values(airports);
  const topSaturated = [...airportEntries]
    .filter(a => a.capacity > 0)
    .map(a => ({ code: a.code, pct: (a.currentStock / a.capacity) * 100, stock: a.currentStock, cap: a.capacity }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const failedGroups = baggageGroups.filter(bg => bg.status === "failed");
  const cancelledFlights = state.flights.filter(f => f.cancelled).length;

  const cardBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const textPrimary = isDark ? "text-white" : "text-[#0f172a]";
  const textSecondary = isDark ? "text-[#94a3b8]" : "text-[#64748b]";

  return (
    <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center pointer-events-none">
      <div className={`border rounded-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto pointer-events-auto ${cardBg}`}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <div className="flex items-center gap-2">
            <Trophy className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
            <h2 className={`text-[16px] ${textPrimary}`}>Highlights de Simulación</h2>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-white/60" : "hover:bg-[#e2e8f0] text-[#64748b]"}`}>
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* KPI Summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Registradas", value: stats.totalRegistered, icon: <Package className="w-4 h-4 text-blue-400" />, color: "bg-blue-500/15" },
              { label: "Entregadas", value: stats.totalDelivered, icon: <CheckCircle className="w-4 h-4 text-green-400" />, color: "bg-green-500/15" },
              { label: "Fallidas", value: stats.totalFailed, icon: <XCircle className="w-4 h-4 text-red-400" />, color: "bg-red-500/15" },
            ].map(k => (
              <div key={k.label} className={`rounded-xl p-3 border ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${k.color}`}>{k.icon}</div>
                <div className={`text-[18px] ${textPrimary}`}>{k.value.toLocaleString()}</div>
                <div className={`text-[10px] ${textSecondary}`}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Rate & Duration */}
          <div className={`rounded-xl p-4 border ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[12px] ${textSecondary}`}>Tasa a Tiempo</span>
              <span className={`text-[14px] ${stats.onTimeRate >= 90 ? "text-green-400" : stats.onTimeRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                {stats.onTimeRate.toFixed(1)}%
              </span>
            </div>
            <div className={`w-full h-2 rounded-full ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"}`}>
              <div className={`h-full rounded-full ${stats.onTimeRate >= 90 ? "bg-green-500" : stats.onTimeRate >= 70 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, stats.onTimeRate)}%` }} />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className={`text-[11px] ${textSecondary}`}>Duración: {day} días simulados</span>
              <span className={`text-[11px] ${textSecondary}`}>Vuelos cancelados: {cancelledFlights}</span>
            </div>
          </div>

          {/* Peak Saturation */}
          {topSaturated.length > 0 && (
            <div>
              <h3 className={`text-[12px] mb-2 flex items-center gap-1.5 ${textPrimary}`}>
                <Warehouse className="w-3.5 h-3.5 text-amber-400" /> Picos de Saturación
              </h3>
              <div className="space-y-1.5">
                {topSaturated.map(a => (
                  <div key={a.code} className="flex items-center gap-2">
                    <span className={`font-mono text-[11px] w-10 ${textPrimary}`}>{a.code}</span>
                    <div className={`flex-1 h-2 rounded-full ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"}`}>
                      <div className={`h-full rounded-full ${a.pct > 80 ? "bg-red-500" : a.pct > 50 ? "bg-amber-500" : "bg-green-500"}`}
                        style={{ width: `${Math.min(100, a.pct)}%` }} />
                    </div>
                    <span className={`text-[10px] w-16 text-right ${a.pct > 80 ? "text-red-400" : textSecondary}`}>
                      {a.pct.toFixed(0)}% ({a.stock}/{a.cap})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Critical Failures */}
          {failedGroups.length > 0 && (
            <div>
              <h3 className={`text-[12px] mb-2 flex items-center gap-1.5 ${textPrimary}`}>
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> Fallos Críticos ({failedGroups.length})
              </h3>
              <div className={`rounded-lg p-2 space-y-1 max-h-24 overflow-y-auto ${isDark ? "bg-[#1e293b]/50" : "bg-[#f1f5f9]"}`}>
                {failedGroups.slice(0, 10).map(bg => (
                  <div key={bg.id} className={`text-[10px] flex items-center gap-2 ${textSecondary}`}>
                    <span className="text-red-400 font-mono">{bg.id}</span>
                    <span>{bg.origin} → {bg.destination}</span>
                    <span>{bg.quantity} maletas</span>
                  </div>
                ))}
                {failedGroups.length > 10 && <div className={`text-[10px] ${textSecondary}`}>+{failedGroups.length - 10} más...</div>}
              </div>
            </div>
          )}

          {/* Collapse reason if applicable */}
          {collapsed && collapseReason && (
            <div className={`rounded-xl p-3 border border-red-500/30 ${isDark ? "bg-red-500/10" : "bg-red-50"}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-red-400 text-[12px]">Motivo de Colapso</span>
              </div>
              <p className={`text-[11px] ${textSecondary}`}>{collapseReason}</p>
            </div>
          )}
        </div>

        <div className={`flex items-center justify-center gap-2 px-6 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <button onClick={onClose}
            className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}>
            Cerrar
          </button>
          <button onClick={onReset}
            className={`px-4 py-1.5 rounded-lg text-[12px] text-white transition-colors ${isDark ? "bg-cyan-600 hover:bg-cyan-500" : "bg-blue-600 hover:bg-blue-700"}`}>
            Nueva Simulación
          </button>
        </div>
      </div>
    </div>
  );
}