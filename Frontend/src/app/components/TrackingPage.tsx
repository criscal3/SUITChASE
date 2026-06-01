import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { SimulationMap } from "./SimulationMap";
import { BaggageTracking } from "./BaggageTracking";
import type { BaggageGroup } from "../engine/types";
import { Plane, Package } from "lucide-react";

export function TrackingPage({ embedded = false }: { embedded?: boolean }) {
  const { state } = useSim();
  const { isDark } = useTheme();
  const [selectedBaggage, setSelectedBaggage] = useState<BaggageGroup | null>(null);
  const [showTracking, setShowTracking] = useState(true);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const panelBg = isDark
    ? "bg-[#0a0f1eee] border-[#1a2744]"
    : "bg-white/90 border-[#cbd5e1]";
  const panelText = isDark ? "text-white" : "text-[#0f172a]";
  const subText = isDark ? "text-white/80" : "text-[#334155]";
  const rootBg = isDark ? "bg-[#080c18]" : "bg-[#eef2f7]";

  return (
    <div className={`${embedded ? "h-full" : "h-[calc(100vh-3rem)] -m-4"} flex flex-col relative transition-colors duration-200 ${rootBg}`}>
      {!embedded && (
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center py-3 pointer-events-none">
        <h1 className={`text-[18px] tracking-wider ${isDark ? "text-cyan-400" : "text-blue-800 font-bold"}`} style={{ textShadow: isDark ? "0 0 20px #00e5ff60" : "none" }}>
          Tracking de Equipaje en Tiempo Real
        </h1>
      </div>
      )}

      <div className="flex-1 flex relative overflow-hidden">
        {/* Panel izquierdo - solo stats (oculto en modo embebido) */}
        {!embedded && (
        <div className="absolute left-4 top-2 bottom-4 z-10 w-52 pointer-events-auto flex flex-col">
          {canScrollUp && (
            <div className={`absolute top-0 left-0 right-0 h-8 z-10 pointer-events-none rounded-t-xl ${isDark ? "bg-gradient-to-b from-[#1a2340ee] to-transparent" : "bg-gradient-to-b from-[#c8d0dcea] to-transparent"}`} />
          )}
          <div
            ref={scrollRef}
            onScroll={checkScroll}
            className="flex-1 flex flex-col gap-3 overflow-y-auto hide-scrollbar"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            <div className="shrink-0 mt-auto" />
            {/* Estado */}
            <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
              <h4 className={`text-[12px] mb-2 ${panelText}`}>Estado</h4>
              <p className={`text-[9px] mb-2 ${subText}`}>Almacenes y aviones</p>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm bg-[#22c55e]"></div>
                <span className={`text-[10px] ${subText}`}>Capacidad Normal (&lt;50%)</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm bg-[#f59e0b]"></div>
                <span className={`text-[10px] ${subText}`}>Capacidad Moderada (&lt;80%)</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-sm bg-[#ef4444]"></div>
                <span className={`text-[10px] ${subText}`}>Saturado (&gt;80%)</span>
              </div>
              <div className={`border-t pt-2 mb-1 ${isDark ? "border-[#1a2744]" : "border-[#cbd5e1]"}`}>
                <p className={`text-[9px] mb-1.5 ${subText}`}>Rutas de vuelo</p>
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-5 h-0.5 rounded ${isDark ? "bg-[#22d3ee]" : "bg-[#0891b2]"}`}></div>
                  <span className={`text-[10px] ${subText}`}>Mismo continente</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-0.5 rounded ${isDark ? "bg-[#fb7185]" : "bg-[#e11d48]"}`}></div>
                  <span className={`text-[10px] ${subText}`}>Distinto continente</span>
                </div>
              </div>
            </div>

            {/* Tarjetas de estadísticas */}
            <div className="space-y-2">
              {(() => {
                const seen = new Set<string>();
                for (const bg of state.baggageGroups) {
                  if (!bg.route) continue;
                  for (const leg of bg.route) {
                    if (state.currentTime >= leg.departureTime && state.currentTime < leg.arrivalTime) {
                      const key = `${leg.from}-${leg.to}-${leg.departureTime}`;
                      seen.add(key);
                    }
                  }
                }
                return <StatCard isDark={isDark} icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Vuelos Activos" value={seen.size.toLocaleString()} />;
              })()}
              <StatCard isDark={isDark} icon={<Package className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} label="Total Maletas" value={state.stats.totalRegistered.toLocaleString()} />
            </div>
            <div className="shrink-0 mb-auto" />
          </div>
          {canScrollDown && (
            <div className={`absolute bottom-0 left-0 right-0 h-8 z-10 pointer-events-none rounded-b-xl ${isDark ? "bg-gradient-to-t from-[#1a2340ee] to-transparent" : "bg-gradient-to-t from-[#c8d0dcea] to-transparent"}`} />
          )}
        </div>
        )}

        {/* Mapa */}
        <div className="flex-1">
          <SimulationMap selectedBaggage={selectedBaggage} onSelectBaggage={setSelectedBaggage} />
        </div>

        {/* Panel derecho - Tracking */}
        {showTracking && (
          <div className={`absolute right-4 ${embedded ? "top-2" : "top-14"} bottom-4 z-10 w-64 border rounded-xl backdrop-blur-sm overflow-hidden flex flex-col pointer-events-auto ${panelBg}`}>
            <BaggageTracking selectedBaggage={selectedBaggage} onSelectBaggage={setSelectedBaggage} />
          </div>
        )}

        <button
          onClick={() => setShowTracking(!showTracking)}
          className={`absolute right-4 ${embedded ? "top-2" : "top-3"} z-20 px-2 py-1 border rounded-lg text-[10px] transition-colors ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`}
        >
          {showTracking ? "Ocultar" : "Rastreo"}
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, isDark }: { icon: React.ReactNode; label: string; value: string; isDark: boolean }) {
  return (
    <div className={`border rounded-xl p-3 backdrop-blur-sm ${isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]"}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className={`text-[10px] ${isDark ? "text-white/80" : "text-[#334155]"}`}>{label}</span>
      </div>
      <div className={`text-[20px] ${isDark ? "text-white" : "text-[#0f172a]"}`} style={{ textShadow: isDark ? "0 0 10px #00e5ff30" : "none" }}>{value}</div>
    </div>
  );
}