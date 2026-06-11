import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../context/ThemeContext";
import { RealTimeMap } from "./RealTimeMap";
import { RealTimeWebSocketClient } from "../services/realTimeWebSocket";
import { api } from "../services/api";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Search, Package, MapPin, Plane, CheckCircle, AlertTriangle, Clock, ChevronRight, X, Radio } from "lucide-react";

interface Tramo {
  orden: number;
  origenOaci: string;
  destinoOaci: string;
  fechaSalida: string;
  fechaLlegada: string;
  estado: string;
}

interface Pedido {
  id: string;
  origenOaci: string;
  destinoOaci: string;
  fechaHoraRegistro: string;
  cantidadMaletas: number;
  aerolineaId: number;
  nombreAerolinea: string;
  estado: string;
  totalTramos: number;
  ubicacionActual: string;
  tramos: Tramo[];
}

interface Resumen {
  totalActivos: number;
  pendientes: number;
  planificados: number;
  enRuta: number;
  ultimaActualizacion: string;
}

const statusConfig: Record<string, { color: string; bg: string; lightBg: string; lightColor: string; label: string; icon: React.ReactNode }> = {
  PENDIENTE:   { color: "text-amber-500",  bg: "bg-amber-500/20",  lightBg: "bg-amber-100", lightColor: "text-amber-700", label: "Sin vuelo",   icon: <Clock className="w-3 h-3" /> },
  PLANIFICADO: { color: "text-blue-500",   bg: "bg-blue-500/20",   lightBg: "bg-blue-100",  lightColor: "text-blue-800",  label: "Asignado",    icon: <CheckCircle className="w-3 h-3" /> },
  EN_RUTA:     { color: "text-cyan-500",   bg: "bg-cyan-500/20",   lightBg: "bg-cyan-100",  lightColor: "text-cyan-800",  label: "En ruta",     icon: <Plane className="w-3 h-3" /> },
  ENTREGADO:   { color: "text-green-500",  bg: "bg-green-500/20",  lightBg: "bg-green-100", lightColor: "text-green-700", label: "Entregado",   icon: <CheckCircle className="w-3 h-3" /> },
  SIN_RUTA:    { color: "text-red-500",    bg: "bg-red-500/20",    lightBg: "bg-red-100",   lightColor: "text-red-700",   label: "Sin ruta",    icon: <AlertTriangle className="w-3 h-3" /> },
  COLAPSO:     { color: "text-red-500",    bg: "bg-red-500/20",    lightBg: "bg-red-100",   lightColor: "text-red-700",   label: "Colapso",     icon: <AlertTriangle className="w-3 h-3" /> },
};

function formatTimestamp(isoStr: string): string {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day}-${month}-${year} ${hh}:${mm}`;
  } catch (e) {
    return "—";
  }
}

export function RealTimePage() {
  const { isDark } = useTheme();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);
  const [airportsList, setAirportsList] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showRightPanel, setShowRightPanel] = useState(true);

  // Load initial data
  useEffect(() => {
    // 1. Fetch airports
    api.getAirports().then(data => {
      if (data) {
        setAirportsList(data.map((a: any) => ({
          code: a.oaci,
          city: a.ciudad,
          country: a.pais,
          continent: a.continente || "America",
          timezone: `UTC${a.gmt >= 0 ? `+${a.gmt}` : a.gmt}`,
          lat: a.latitud,
          lng: a.longitud,
          warehouseCapacity: a.capacidadAlmacen,
          currentStock: a.stockActual || 0
        })));
      }
    });

    // 2. Fetch real-time orders
    api.getOperacionesRT().then(setPedidos).catch(console.error);

    // 3. Fetch summary KPIs
    api.getResumenRT().then(setResumen).catch(console.error);

    // 4. Setup Websocket client
    const ws = new RealTimeWebSocketClient("ADMIN", undefined, {
      onNuevoPedido: (p) => {
        setPedidos(prev => {
          if (prev.some(x => x.id === p.id)) return prev;
          return [p, ...prev];
        });
      },
      onActualizacion: (r) => {
        setResumen(r);
      },
      onPedidosActualizados: (lista: Pedido[]) => {
        setPedidos(prev => {
          const map = new Map(prev.map(p => [p.id, p]));
          lista.forEach(p => {
            // If the order has finished, remove it from active list
            if (["ENTREGADO", "SIN_RUTA", "COLAPSO"].includes(p.estado)) {
              map.delete(p.id);
            } else {
              map.set(p.id, p);
            }
          });
          return Array.from(map.values()).sort((a, b) => new Date(b.fechaHoraRegistro).getTime() - new Date(a.fechaHoraRegistro).getTime());
        });
      }
    });

    ws.connect();
    return () => ws.disconnect();
  }, []);

  const getCity = (code: string) => airportsList.find(a => a.code === code)?.city || code;

  const filtered = pedidos.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return p.id.toLowerCase().includes(s) ||
      p.origenOaci.toLowerCase().includes(s) ||
      p.destinoOaci.toLowerCase().includes(s) ||
      p.nombreAerolinea.toLowerCase().includes(s);
  });

  const rootBg = isDark ? "bg-[#080c18]" : "bg-[#eef2f7]";
  const panelBg = isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]";
  const titleCls = isDark ? "text-white" : "text-[#111827]";
  const subCls = isDark ? "text-white/70" : "text-[#374151]";
  const mutedCls = isDark ? "text-white/50" : "text-[#6b7280]";
  const dimCls = isDark ? "text-white/40" : "text-[#9ca3af]";
  const headerBorder = isDark ? "border-[#1e293b]" : "border-[#c8d0d8]";
  const searchBg = isDark ? "bg-[#0a0f1e] border-[#1e293b] text-white placeholder:text-white/30" : "bg-white border-[#c8d0d8] text-[#111827] placeholder:text-[#9ca3af]";
  const searchIcon = isDark ? "text-white/40" : "text-[#9ca3af]";
  const detailBg = isDark ? "bg-[#0f172a]" : "bg-[#dde3ea]";
  const trackLineBg = isDark ? "bg-[#1e293b]" : "bg-[#c8d0d8]";
  const dotInactive = isDark ? "bg-[#334155]" : "bg-[#a0aec0]";
  const hoverRow = isDark ? "hover:bg-[#0f172a]" : "hover:bg-[#cfd6df]";

  const sc = selectedPedido ? statusConfig[selectedPedido.estado] : null;

  return (
    <div className={`h-[calc(100vh-3rem)] -m-4 flex flex-col relative transition-colors duration-200 ${rootBg}`}>
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center py-3 pointer-events-none">
        <h1 className={`text-[18px] tracking-wider flex items-center gap-2 ${isDark ? "text-cyan-400" : "text-blue-800 font-bold"}`} style={{ textShadow: isDark ? "0 0 20px #00e5ff60" : "none" }}>
          <Radio className="w-5 h-5 animate-pulse text-red-500" /> Operaciones en Tiempo Real
        </h1>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Panel izquierdo - Stats y Leyenda */}
        <div className="absolute left-4 top-14 bottom-4 z-10 w-52 pointer-events-auto flex flex-col gap-3 overflow-y-auto hide-scrollbar" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          
          {/* Leyenda de Estados */}
          <div className={`border rounded-xl p-3 backdrop-blur-sm ${panelBg}`}>
            <h4 className={`text-[11px] font-semibold mb-2 ${titleCls}`}>Estados de Pedido</h4>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className={`text-[9px] ${subCls}`}>Falta asignar vuelo (Pendiente)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className={`text-[9px] ${subCls}`}>Vuelo asignado (Planificado)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
                <span className={`text-[9px] ${subCls}`}>En tránsito (En ruta)</span>
              </div>
            </div>
          </div>

          {/* KPIs Globales */}
          <div className="space-y-2">
            <StatCard isDark={isDark} label="Total Activos" value={resumen?.totalActivos ?? 0} />
            <StatCard isDark={isDark} label="Falta asignar vuelo" value={resumen?.pendientes ?? 0} colorClass="text-amber-500" />
            <StatCard isDark={isDark} label="Vuelo asignado" value={resumen?.planificados ?? 0} colorClass="text-blue-500" />
            <StatCard isDark={isDark} label="En tránsito" value={resumen?.enRuta ?? 0} colorClass="text-cyan-500" />
          </div>
        </div>

        {/* Mapa central */}
        <div className="flex-1">
          <RealTimeMap
            pedidos={pedidos}
            selectedPedido={selectedPedido}
            onSelectPedido={setSelectedPedido}
            airportsList={airportsList}
          />
        </div>

        {/* Panel derecho - Rastreo y búsqueda */}
        {showRightPanel && (
          <div className={`absolute right-4 top-14 bottom-4 z-10 w-72 border rounded-xl backdrop-blur-sm overflow-hidden flex flex-col pointer-events-auto ${panelBg}`}>
            <div className={`flex items-center gap-2 px-3 py-2 border-b ${headerBorder}`}>
              <Package className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
              <span className={`text-[13px] ${titleCls}`}>Monitoreo de Pedidos</span>
            </div>

            {/* Búsqueda */}
            <div className={`px-3 py-2 border-b ${headerBorder}`}>
              <div className="relative">
                <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${searchIcon}`} />
                <Input
                  placeholder="Buscar ID, origen, destino..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setSelectedPedido(null); }}
                  className={`pl-7 h-7 text-[11px] ${searchBg}`}
                />
                {search && (
                  <button onClick={() => { setSearch(""); setSelectedPedido(null); }} className={`absolute right-2 top-1/2 -translate-y-1/2 ${dimCls}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Detalle del pedido seleccionado */}
            {selectedPedido && sc && (
              <div className={`px-3 py-2 border-b ${headerBorder} ${detailBg}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[12px] font-bold ${titleCls}`}>{selectedPedido.id}</span>
                  <Badge className={`text-[9px] ${isDark ? sc.bg : sc.lightBg} ${isDark ? sc.color : sc.lightColor}`}>
                    {sc.icon} <span className="ml-1">{sc.label}</span>
                  </Badge>
                </div>
                <div className={`text-[10px] mb-2 ${subCls}`}>
                  {selectedPedido.nombreAerolinea} | {selectedPedido.cantidadMaletas} maletas
                </div>

                {/* Ruta / Línea de tiempo */}
                <div className="space-y-0 mt-2 max-h-48 overflow-y-auto">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-cyan-500 shrink-0" />
                    <div className="flex-1">
                      <div className={`text-[10px] font-semibold ${titleCls}`}>
                        Origen: {getCity(selectedPedido.origenOaci)} ({selectedPedido.origenOaci})
                      </div>
                      <div className={`text-[9px] ${mutedCls}`}>
                        Registro: {formatTimestamp(selectedPedido.fechaHoraRegistro)}
                      </div>
                    </div>
                  </div>

                  {selectedPedido.tramos && selectedPedido.tramos.map((leg, i) => {
                    const isCompleted = leg.estado === "COMPLETADO";
                    const isCurrent = leg.estado === "EN_VUELO";
                    return (
                      <React.Fragment key={i}>
                        <div className={`ml-[4px] w-[2px] h-3.5 ${trackLineBg} relative`}>
                          {(isCompleted || isCurrent) && (
                            <div className="absolute inset-0 bg-cyan-500" style={{ height: isCurrent ? "50%" : "100%" }} />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isCompleted ? "bg-green-500" : isCurrent ? "bg-cyan-500 animate-pulse" : dotInactive}`} />
                          <div className="flex-1">
                            <div className={`text-[10px] font-semibold ${titleCls}`}>
                              Tramo {i+1}: {getCity(leg.destinoOaci)} ({leg.destinoOaci})
                            </div>
                            <div className={`text-[9px] ${mutedCls}`}>
                              Salida: {formatTimestamp(leg.fechaSalida)} | Llegada: {formatTimestamp(leg.fechaLlegada)}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {(!selectedPedido.tramos || selectedPedido.tramos.length === 0) && (
                    <div className={`pl-5 text-[10px] py-2 ${dimCls}`}>
                      Esperando asignación de vuelo...
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setSelectedPedido(null)}
                  className={`mt-2.5 text-[10px] transition-colors font-medium ${isDark ? "text-cyan-500 hover:text-cyan-400" : "text-blue-700 hover:text-blue-800"}`}
                >
                  Cerrar detalle
                </button>
              </div>
            )}

            {/* Lista de Pedidos */}
            <ScrollArea className="flex-1">
              <div className="px-2 py-1">
                {filtered.map(p => {
                  const s = statusConfig[p.estado] || statusConfig.PENDIENTE;
                  const isSelected = selectedPedido?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPedido(isSelected ? null : p)}
                      className={`w-full text-left px-2 py-2 rounded-md mb-1 flex items-center gap-2 transition-colors ${
                        isSelected ? (isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-blue-600/10 border border-blue-600/30") : `${hoverRow} border border-transparent`
                      }`}
                    >
                      <div className={`shrink-0 ${s.color}`}>{s.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10.5px] font-semibold ${titleCls}`}>{p.id}</span>
                          <span className={`text-[9px] ${dimCls}`}>x{p.cantidadMaletas}</span>
                        </div>
                        <div className={`text-[9px] truncate ${subCls}`}>
                          {p.origenOaci} <ChevronRight className="w-2.5 h-2.5 inline" /> {p.destinoOaci}
                        </div>
                        <div className={`text-[8.5px] ${mutedCls} truncate`}>
                          {p.nombreAerolinea}
                        </div>
                      </div>
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded-full ${s.bg} ${s.color} font-medium`}>
                        {s.label}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className={`text-[11px] text-center py-12 ${dimCls}`}>
                    No hay pedidos activos en este momento.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        <button
          onClick={() => setShowRightPanel(!showRightPanel)}
          className={`absolute right-4 top-3 z-20 px-2.5 py-1 border rounded-lg text-[10px] transition-colors ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`}
        >
          {showRightPanel ? "Ocultar" : "Monitoreo"}
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, colorClass = "", isDark }: { label: string; value: number; colorClass?: string; isDark: boolean }) {
  return (
    <div className={`border rounded-xl p-2.5 backdrop-blur-sm ${isDark ? "bg-[#0a0f1eee] border-[#1a2744]" : "bg-white/90 border-[#cbd5e1]"}`}>
      <span className={`text-[9px] ${isDark ? "text-white/80" : "text-[#334155]"}`}>{label}</span>
      <div className={`text-[18px] font-bold mt-0.5 ${colorClass} ${isDark && colorClass === "" ? "text-white" : ""}`}>{value}</div>
    </div>
  );
}
