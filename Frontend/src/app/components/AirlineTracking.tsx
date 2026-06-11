import React, { useState, useEffect, useCallback } from "react";
import { useTheme } from "../context/ThemeContext";
import { RealTimeMap } from "./RealTimeMap";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { api } from "../services/api";
import { RealTimeWebSocketClient } from "../services/realTimeWebSocket";
import { Search, Package, Plane, CheckCircle, AlertTriangle, Clock, ChevronRight, X } from "lucide-react";

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
    const utc = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z';
    const d = new Date(utc);
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

export function AirlineTracking() {
  const { isDark } = useTheme();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);
  const [airportsList, setAirportsList] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showPanel, setShowPanel] = useState(true);

  const aerolineaIdStr = localStorage.getItem("suitchase_aerolinea_id");
  const aerolineaId = aerolineaIdStr ? Number(aerolineaIdStr) : null;

  useEffect(() => {
    // 1. Fetch airports list
    api.getAirports().then(data => {
      if (data) {
        setAirportsList(data.map((a: any) => ({
          code: a.oaci,
          city: a.ciudad,
          country: a.pais,
          continent: a.continente || "America",
          timezone: `UTC${a.gmt >= 0 ? `+${a.gmt}` : a.gmt}`,
          gmt: a.gmt,
          lat: a.latitud,
          lng: a.longitud,
          warehouseCapacity: a.capacidadAlmacen,
          currentStock: a.stockActual || 0
        })));
      }
    });

    if (aerolineaId) {
      // 2. Fetch initial real-time orders for this airline
      api.getMisPedidosRT().then(setPedidos).catch(console.error);

      // 3. Connect to WebSocket
      const ws = new RealTimeWebSocketClient("AEROLINEA", aerolineaId, {
        onMisPedidos: (lista) => {
          setPedidos(lista);
          // If selected order was removed from active list, deselect it
          setSelectedPedido(prev => {
            if (!prev) return null;
            const updated = lista.find(p => p.id === prev.id);
            return updated || null;
          });
        }
      });
      ws.connect();
      return () => ws.disconnect();
    }
  }, [aerolineaId]);

  const getCity = (code: string) => airportsList.find(a => a.code === code)?.city || code;

  const filtered = pedidos.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return p.id.toLowerCase().includes(s) ||
      p.origenOaci.toLowerCase().includes(s) ||
      p.destinoOaci.toLowerCase().includes(s) ||
      p.nombreAerolinea.toLowerCase().includes(s);
  });

  const handleSelectPedido = (p: Pedido | null) => {
    setSelectedPedido(p);
    if (p) setSearch(p.id);
  };

  const handleClear = () => {
    setSearch("");
    setSelectedPedido(null);
  };

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
          <RealTimeMap
            pedidos={pedidos}
            selectedPedido={selectedPedido}
            onSelectPedido={handleSelectPedido}
            airportsList={airportsList}
          />
        </div>

        {/* Panel derecho - Tracking */}
        {showPanel && (
          <div className={`absolute right-4 top-14 bottom-4 z-10 w-72 border rounded-xl backdrop-blur-sm overflow-hidden flex flex-col pointer-events-auto ${panelBg}`}>
            {/* Header */}
            <div className={`flex items-center gap-2 px-3 py-2 border-b ${headerBorder}`}>
              <Package className={`w-4 h-4 ${isDark ? "text-cyan-500" : "text-blue-700"}`} />
              <span className={`text-[13px] ${titleCls}`}>Rastreo de Pedidos</span>
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
                  <button onClick={handleClear} className={`absolute right-2 top-1/2 -translate-y-1/2 ${dimCls} ${isDark ? "hover:text-cyan-500" : "hover:text-blue-700"}`}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Detalle de pedido seleccionado */}
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

                {/* Ruta / Línea de tiempo con huso horario por aeropuerto */}
                {(() => {
                  const tramos = selectedPedido.tramos || [];
                  const fmtLocal = (isoStr: string, gmtOffset: number) => {
                    if (!isoStr) return "—";
                    try {
                      const utc = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z';
                      const ms = new Date(utc).getTime() + gmtOffset * 3600_000;
                      const d = new Date(ms);
                      return `${String(d.getUTCDate()).padStart(2,"0")}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
                    } catch { return "—"; }
                  };
                  const getGmt = (oaci: string) => airportsList.find((a: any) => a.code === oaci)?.gmt ?? 0;
                  const gmtLabel = (g: number) => `GMT${g >= 0 ? `+${g}` : g}`;
                  const registroAirport = selectedPedido.operarioOaci || selectedPedido.origenOaci;
                  const registroGmt = getGmt(registroAirport);

                  return (
                    <div className="space-y-0 mt-2 max-h-56 overflow-y-auto">
                      {/* Nodo origen */}
                      <div className="flex items-start gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} />
                        <div className="flex-1">
                          <div className={`text-[10px] font-semibold ${titleCls}`}>
                            {getCity(selectedPedido.origenOaci)} ({selectedPedido.origenOaci})
                          </div>
                          <div className={`text-[9px] ${mutedCls}`}>
                            Registro: {fmtLocal(selectedPedido.fechaHoraRegistro, registroGmt)} {gmtLabel(registroGmt)}
                          </div>
                          {tramos.length > 0 && (
                            <div className={`text-[9px] ${isDark ? "text-cyan-400/80" : "text-cyan-700"}`}>
                              Salida: {fmtLocal(tramos[0].fechaSalida, getGmt(tramos[0].origenOaci))} {gmtLabel(getGmt(tramos[0].origenOaci))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Nodos intermedios y final */}
                      {tramos.map((leg: any, i: number) => {
                        const isCompleted = leg.estado === "COMPLETADO";
                        const isCurrent = leg.estado === "EN_VUELO";
                        const isLast = i === tramos.length - 1;
                        const arriGmt = getGmt(leg.destinoOaci);
                        const nextLeg = !isLast ? tramos[i + 1] : null;
                        return (
                          <React.Fragment key={i}>
                            <div className={`ml-[4px] w-[2px] h-3.5 ${trackLineBg} relative`}>
                              {(isCompleted || isCurrent) && (
                                <div className="absolute inset-0 bg-cyan-500" style={{ height: isCurrent ? "50%" : "100%" }} />
                              )}
                            </div>
                            <div className="flex items-start gap-2">
                              <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isCompleted ? "bg-green-500" : isCurrent ? "bg-cyan-500 animate-pulse" : dotInactive}`} />
                              <div className="flex-1">
                                <div className={`text-[10px] font-semibold ${titleCls}`}>
                                  {getCity(leg.destinoOaci)} ({leg.destinoOaci})
                                </div>
                                <div className={`text-[9px] ${mutedCls}`}>
                                  Llegada: {fmtLocal(leg.fechaLlegada, arriGmt)} {gmtLabel(arriGmt)}
                                </div>
                                {!isLast && nextLeg && (
                                  <div className={`text-[9px] ${isDark ? "text-cyan-400/80" : "text-cyan-700"}`}>
                                    Salida: {fmtLocal(nextLeg.fechaSalida, arriGmt)} {gmtLabel(arriGmt)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      })}

                      {tramos.length === 0 && (
                        <div className={`pl-5 text-[10px] py-2 ${dimCls}`}>Sin ruta planificada</div>
                      )}
                    </div>
                  );
                })()}

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
                {filtered.length === 0 && (
                  <div className={`text-[11px] text-center py-8 ${dimCls}`}>
                    No se encontraron pedidos activos.
                  </div>
                )}
                {!selectedPedido && filtered.map(p => {
                  const s = statusConfig[p.estado] || statusConfig.PENDIENTE;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleSelectPedido(p)}
                      className={`w-full text-left px-2 py-1.5 rounded-md mb-0.5 flex items-center gap-2 transition-colors ${hoverRow} border border-transparent`}
                    >
                      <div className={`shrink-0 ${s.color}`}>{s.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] ${titleCls}`}>{p.id}</span>
                          <span className={`text-[9px] ${dimCls}`}>x{p.cantidadMaletas}</span>
                        </div>
                        <div className={`text-[9px] truncate ${subCls}`}>
                          {p.origenOaci} <ChevronRight className="w-2 h-2 inline" /> {p.destinoOaci}
                        </div>
                      </div>
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded-full ${s.bg} ${s.color} font-medium`}>
                        {s.label}
                      </span>
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