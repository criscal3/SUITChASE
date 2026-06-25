import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plane, CalendarX2, AlertTriangle, ChevronDown } from "lucide-react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { api } from "../services/api";
import { toast } from "sonner";

export function FlightCancellationCard() {
  const { state, activeSimId } = useSim();
  const { isDark } = useTheme();

  const [flights, setFlights] = useState<any[]>([]);
  const [cancelledFlightIds, setCancelledFlightIds] = useState<number[]>([]);
  const [cancelledSimKeys, setCancelledSimKeys] = useState<string[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [timeValue, setTimeValue] = useState("");

  const [confirmCancel, setConfirmCancel] = useState<{ origin: string; destination: string; date: string; simId: number; tzLabel: string; gmt: number } | null>(null);
  const [affectedOrders, setAffectedOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    api.getFlights().then(data => {
      if (data && data.length > 0) {
        setFlights(data);
      }
    }).catch(console.error);
    
    // Obtener vuelos cancelados
    api.getCancelacionesActivas().then(data => {
      if (data) {
        setCancelledFlightIds(data);
      }
    }).catch(console.error);
  }, []);

  const simIdToUse = activeSimId ?? state.activeSimId;

  useEffect(() => {
    if (simIdToUse) {
      api.getVuelosCanceladosSimulacion(simIdToUse).then(data => {
        if (data) {
          setCancelledSimKeys(data);
        }
      }).catch(console.error);
    } else {
      setCancelledSimKeys([]);
    }
  }, [simIdToUse]);

  const origins = useMemo(() => {
    const orgs = new Set(flights.map(f => f.origenOaci || f.origin));
    return Array.from(orgs).filter(Boolean).sort();
  }, [flights]);

  const destinations = useMemo(() => {
    if (!origin) return [];
    const dests = new Set(
      flights
        .filter(f => (f.origenOaci || f.origin) === origin)
        .map(f => f.destinoOaci || f.destination)
    );
    return Array.from(dests).filter(Boolean).sort();
  }, [origin, flights]);

  const occurrences = useMemo(() => {
    if (!origin || !destination) return [];

    const matchingFlights = flights.filter(
      f => (f.origenOaci || f.origin) === origin && (f.destinoOaci || f.destination) === destination && !cancelledFlightIds.includes(f.id || f.vueloId)
    );

    const options: { label: string; value: string; date: Date; tzLabel?: string }[] = [];
    const simTime = new Date(state.currentTime);

    matchingFlights.forEach(f => {
      const hourStr = f.horaSalida || "00:00:00";
      const [hStr, mStr, sStr] = hourStr.split(":");
      const h = parseInt(hStr || "0", 10);
      const m = parseInt(mStr || "0", 10);
      const s = parseInt(sStr || "0", 10);
      
      const gmt = f.origenGmt || 0;
      const gmtStr = gmt >= 0 ? `+${gmt}` : `${gmt}`;
      const tzLabel = `UTC${gmtStr}`;

      // Convertir simTime de UTC a hora local del aeropuerto (simulando como UTC)
      const simTimeInLocalTimezone = new Date(simTime.getTime() + gmt * 60 * 60 * 1000);
      
      // Extraer componentes: año, mes, día en la zona local
      const localYear = simTimeInLocalTimezone.getUTCFullYear();
      const localMonth = simTimeInLocalTimezone.getUTCMonth();
      const localDate = simTimeInLocalTimezone.getUTCDate();

      // Crear candidatos en hora local usando Date.UTC (porque ya hemos sumado el offset)
      const candidate1LocalTime = new Date(Date.UTC(localYear, localMonth, localDate, h, m, s, 0));
      const candidate2LocalTime = new Date(Date.UTC(localYear, localMonth, localDate + 1, h, m, s, 0));

      // Convertir candidatos de vuelta a UTC para comparación
      const candidate1UTC = new Date(candidate1LocalTime.getTime() - gmt * 60 * 60 * 1000);
      const candidate2UTC = new Date(candidate2LocalTime.getTime() - gmt * 60 * 60 * 1000);

      [candidate1UTC, candidate2UTC].forEach(cand => {
        // Solo permitir cancelación si faltan al menos 1 hora para el despegue
        if (cand > simTime && cand.getTime() - simTime.getTime() >= 60 * 60 * 1000 && cand.getTime() - simTime.getTime() <= 24 * 3600 * 1000) {
          // Check if already cancelled in simulation
          const pad = (n: number) => String(n).padStart(2, "0");
          const utcKey = `${origin}-${destination}-${cand.getUTCFullYear()}-${pad(cand.getUTCMonth() + 1)}-${pad(cand.getUTCDate())}T${pad(cand.getUTCHours())}:${pad(cand.getUTCMinutes())}`;
          
          if (cancelledSimKeys.includes(utcKey)) {
            return;
          }

          // Convert cand de UTC a hora local del aeropuerto para mostrar y enviar
          const candInLocalTimezone = new Date(cand.getTime() + gmt * 60 * 60 * 1000);
          
          // ISO format sin milliseconds en HORA LOCAL (lo que espera el backend)
          // Example: 2026-06-17T14:30:00
          const value = `${candInLocalTimezone.getUTCFullYear()}-${pad(candInLocalTimezone.getUTCMonth() + 1)}-${pad(candInLocalTimezone.getUTCDate())}T${pad(candInLocalTimezone.getUTCHours())}:${pad(candInLocalTimezone.getUTCMinutes())}:${pad(candInLocalTimezone.getUTCSeconds())}`;
          const label = `${pad(candInLocalTimezone.getUTCDate())}/${pad(candInLocalTimezone.getUTCMonth() + 1)}/${candInLocalTimezone.getUTCFullYear()} ${pad(candInLocalTimezone.getUTCHours())}:${pad(candInLocalTimezone.getUTCMinutes())} (${tzLabel})`;
          
          options.push({
            label,
            value,
            date: cand,
            tzLabel
          });
        }
      });
    });

    return options.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [origin, destination, flights, state.currentTime, cancelledFlightIds, cancelledSimKeys]);

  const handleSelectTime = (val: string) => {
    setTimeValue(val);
  };

  const handleCancelClick = async () => {
    const simIdToUse = activeSimId ?? state.activeSimId;
    if (!simIdToUse) {
      toast.error("No hay una simulación activa en este momento.");
      return;
    }
    if (!origin || !destination || !timeValue) {
      toast.error("Seleccione origen, destino y hora del vuelo");
      return;
    }
    
    const selectedOption = occurrences.find(o => o.value === timeValue);
    const tzLabelToUse = selectedOption ? selectedOption.tzLabel : "UTC";
    
    // Obtener el GMT del aeropuerto origen
    const originFlight = flights.find(f => (f.origenOaci || f.origin) === origin);
    const gmtToUse = originFlight ? (originFlight.origenGmt || 0) : 0;
    
    setConfirmCancel({ origin, destination, date: timeValue, simId: simIdToUse, tzLabel: tzLabelToUse, gmt: gmtToUse });
    setAffectedOrders([]);
    setLoadingOrders(true);
    try {
      const orders = await api.getPedidosAfectadosSimulacion(simIdToUse, origin, destination, timeValue);
      setAffectedOrders(orders || []);
    } catch (err) {
      console.error(err);
      toast.error("Error al obtener envíos afectados");
      setConfirmCancel(null);
    } finally {
      setLoadingOrders(false);
    }
  };

  const doConfirmCancel = async () => {
    if (!confirmCancel) return;
    setCancelLoading(true);
    try {
      await api.cancelarVueloSimulacion(confirmCancel.simId, confirmCancel.origin, confirmCancel.destination, confirmCancel.date);
      toast.warning(
        affectedOrders.length > 0
          ? `Vuelo de simulación cancelado. ${affectedOrders.length} pedido(s) afectados.`
          : `Vuelo de simulación cancelado. No había pedidos afectados.`,
        { duration: 6000 }
      );
      setConfirmCancel(null);
      
      // Refrescar la lista de cancelaciones activas
      api.getCancelacionesActivas().then(data => {
        if (data) {
          setCancelledFlightIds(data);
        }
      }).catch(console.error);

      if (confirmCancel.simId) {
        api.getVuelosCanceladosSimulacion(confirmCancel.simId).then(data => {
          if (data) {
            setCancelledSimKeys(data);
          }
        }).catch(console.error);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Error al cancelar el vuelo en la simulación");
    } finally {
      setCancelLoading(false);
    }
  };

  const textPrimary = isDark ? "text-[#e2e8f0]" : "text-[#0f172a]";
  const textSecondary = isDark ? "text-[#94a3b8]" : "text-[#64748b]";
  const overlayBg = isDark ? "bg-[#020617cc] backdrop-blur-md" : "bg-white/40 backdrop-blur-sm";
  const modalBg = isDark ? "bg-[#0f172a] border-[#1e293b] shadow-2xl shadow-black/50" : "bg-white border-[#e2e8f0] shadow-xl";

  return (
    <div className={`p-4 ${isDark ? "" : "bg-white"} w-full h-full flex flex-col`}>
      <div className="flex items-center gap-2 mb-4">
        <Plane className={`w-4 h-4 ${isDark ? "text-orange-400" : "text-orange-600"}`} />
        <h3 className={`text-xs font-semibold ${textPrimary}`}>Cancelar Vuelo</h3>
      </div>
      
      <div className="flex flex-col gap-3 flex-1">
        <div className="flex flex-col gap-1">
          <label className={`text-[10px] uppercase font-bold tracking-wider ${textSecondary}`}>Origen</label>
          <select 
            className={`w-full text-xs p-1.5 rounded border outline-none ${isDark ? "bg-[#1e293b] border-[#334155] text-white" : "bg-white border-gray-300"}`}
            value={origin} 
            onChange={e => {
              setOrigin(e.target.value);
              setDestination("");
              setTimeValue("");
            }}
          >
            <option value="">Seleccione origen</option>
            {origins.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        
        <div className="flex flex-col gap-1">
          <label className={`text-[10px] uppercase font-bold tracking-wider ${textSecondary}`}>Destino</label>
          <select 
            className={`w-full text-xs p-1.5 rounded border outline-none ${isDark ? "bg-[#1e293b] border-[#334155] text-white" : "bg-white border-gray-300"}`}
            value={destination} 
            onChange={e => {
              setDestination(e.target.value);
              setTimeValue("");
            }}
            disabled={!origin}
          >
            <option value="">Seleccione destino</option>
            {destinations.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        
        <div className="flex flex-col gap-1">
          <label className={`text-[10px] uppercase font-bold tracking-wider ${textSecondary}`}>Hora de Salida (Próx. 24h)</label>
          <select 
            className={`w-full text-xs p-1.5 rounded border outline-none ${isDark ? "bg-[#1e293b] border-[#334155] text-white" : "bg-white border-gray-300"}`}
            value={timeValue} 
            onChange={e => handleSelectTime(e.target.value)}
            disabled={!destination}
          >
            <option value="">Seleccione hora</option>
            {occurrences.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <button 
          onClick={handleCancelClick}
          disabled={!timeValue}
          className={`mt-auto w-full py-2 rounded text-xs font-semibold text-white transition-colors disabled:opacity-50 ${isDark ? "bg-red-600 hover:bg-red-500" : "bg-red-600 hover:bg-red-700"}`}
        >
          Cancelar Vuelo
        </button>
      </div>

      {/* Modal: Confirm Cancel */}
      {confirmCancel && createPortal(
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => !cancelLoading && setConfirmCancel(null)}>
          <div className={`border rounded-xl w-full max-w-md mx-4 ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4">
              <div className="flex items-start gap-3 mb-3">
                <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-orange-500/15" : "bg-orange-100"}`}>
                  <CalendarX2 className={`w-5 h-5 ${isDark ? "text-orange-400" : "text-orange-600"}`} />
                </div>
                <div>
                  <h3 className={`text-[14px] font-medium mb-0.5 ${textPrimary}`}>Cancelar vuelo de simulación</h3>
                  <p className={`text-[11px] ${textSecondary}`}>
                    El vuelo con destino <span className={`font-semibold ${isDark ? "text-orange-400" : "text-orange-600"}`}>{confirmCancel.destination}</span> será cancelado para la fecha y hora indicadas.
                  </p>
                </div>
              </div>

              <div className={`rounded-lg p-3 mb-3 ${isDark ? "bg-[#1e293b] border border-[#334155]" : "bg-[#f8fafc] border border-[#e2e8f0]"}`}>
                <div className="flex items-center gap-2 text-[12px]">
                  <Plane className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                  <span className={`font-mono font-medium ${textPrimary}`}>
                    {confirmCancel.origin} → {confirmCancel.destination}
                  </span>
                  <span className={`ml-auto font-mono text-[11px] ${textSecondary}`}>
                    Salida: {confirmCancel.date.replace("T", " ")} ({confirmCancel.tzLabel})
                  </span>
                </div>
              </div>

              <div className={`rounded-lg border overflow-hidden ${isDark ? "border-[#334155]" : "border-[#e2e8f0]"}`}>
                <div className={`px-3 py-2 flex items-center gap-2 border-b ${isDark ? "bg-[#1e293b]/70 border-[#334155]" : "bg-[#f1f5f9] border-[#e2e8f0]"}`}>
                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
                  <span className={`text-[11px] font-medium ${isDark ? "text-amber-300" : "text-amber-700"}`}>
                    Envíos perjudicados
                  </span>
                  {!loadingOrders && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${affectedOrders.length > 0
                        ? isDark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-700"
                        : isDark ? "bg-[#334155] text-[#94a3b8]" : "bg-[#e2e8f0] text-[#64748b]"
                      }`}>{affectedOrders.length}</span>
                  )}
                </div>

                {loadingOrders ? (
                  <div className={`flex items-center justify-center gap-2 py-6 ${isDark ? "bg-[#0f172a]" : "bg-white"}`}>
                    <span className={`animate-spin w-4 h-4 rounded-full border-2 border-t-transparent ${isDark ? "border-cyan-400" : "border-blue-600"}`} />
                    <span className={`text-[11px] ${textSecondary}`}>Consultando envíos afectados…</span>
                  </div>
                ) : affectedOrders.length === 0 ? (
                  <div className={`py-5 text-center text-[11px] ${textSecondary} ${isDark ? "bg-[#0f172a]" : "bg-white"}`}>
                    Ningún envío de la simulación usa este vuelo a esa hora.
                  </div>
                ) : (
                  <div className={`divide-y max-h-44 overflow-y-auto ${isDark ? "divide-[#1e293b] bg-[#0f172a]" : "divide-[#f1f5f9] bg-white"}`}>
                    <div className={`grid grid-cols-3 px-3 py-1.5 ${isDark ? "bg-[#1e293b]/40" : "bg-[#f8fafc]"}`}>
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${textSecondary}`}>ID Envío</span>
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${textSecondary}`}>Aerolínea</span>
                      <span className={`text-[10px] font-medium uppercase tracking-wide text-right ${textSecondary}`}>Maletas</span>
                    </div>
                    {affectedOrders.map((o: any) => (
                      <div key={o.id} className={`grid grid-cols-3 items-center px-3 py-2 transition-colors ${isDark ? "hover:bg-[#1e293b]/40" : "hover:bg-[#f8fafc]"}`}>
                        <span className={`font-mono text-[11px] ${isDark ? "text-cyan-400" : "text-blue-700"}`}>{o.id}</span>
                        <span className={`text-[11px] truncate ${textPrimary}`}>{o.nombreAerolinea ?? "—"}</span>
                        <span className={`text-[11px] text-right font-medium ${isDark ? "text-orange-400" : "text-orange-700"}`}>{o.cantidadMaletas}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button
                disabled={cancelLoading}
                onClick={() => setConfirmCancel(null)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors disabled:opacity-40 ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}>
                Volver
              </button>
              <button
                disabled={cancelLoading}
                onClick={doConfirmCancel}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] text-white transition-colors disabled:opacity-60 ${isDark ? "bg-red-600 hover:bg-red-500" : "bg-red-600 hover:bg-red-500"}`}>
                {cancelLoading ? (
                  <><span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" /> Procesando…</>
                ) : (
                  <><CalendarX2 className="w-3.5 h-3.5" /> Confirmar cancelación</>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
