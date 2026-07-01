import React, { useState, useMemo, useRef, useEffect } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import {
  Search, Plane, XCircle, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight,
  AlertTriangle, Upload, FileText, CheckCircle2, Clock, Globe,
  ArrowUpDown, Trash2, CalendarX2
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../services/api";

const SIM_BASE_DATE = new Date(2026, 3, 2, 0, 0, 0);

/** Devuelve la hora actual del día como número decimal (ej: 14.5 = 14:30) */
function getCurrentDayHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}
const ROWS_PER_PAGE = 12;

type SortField = "none" | "departure" | "arrival" | "capacity";

function formatFlightTime(departureHour: number): string {
  const d = new Date(SIM_BASE_DATE);
  const totalMinutes = Math.round(departureHour * 60);
  d.setMinutes(d.getMinutes() + totalMinutes);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function FlightsPanel() {
  const { state, cancelFlight, clearFlights, airportsList, batchImportFlights } = useSim();
  const { isDark } = useTheme();
  const [flightsList, setFlightsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterOrigin, setFilterOrigin] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortField, setSortField] = useState<SortField>("none");
  const [page, setPage] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState<{ id: string; origin: string; destination: string } | null>(null);
  const [confirmCancelHoy, setConfirmCancelHoy] = useState<{ id: string; origin: string; destination: string; hour: string } | null>(null);
  const [cancelHoyLoading, setCancelHoyLoading] = useState(false);
  const [affectedOrders, setAffectedOrders] = useState<any[]>([]);
  const [affectedOrdersLoading, setAffectedOrdersLoading] = useState(false);
  const [canceledFlights, setCanceledFlights] = useState<number[]>([]);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<{ count: number; visible: boolean } | null>(null);
  // Tick cada minuto para recalcular el vuelo próximo
  const [nowHour, setNowHour] = useState(getCurrentDayHour);
  useEffect(() => {
    const id = setInterval(() => setNowHour(getCurrentDayHour()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchFlights();
  }, []);

  const fetchFlights = async () => {
    setLoading(true);
    try {
      const [data, cancelaciones] = await Promise.all([
        api.getFlights(),
        api.getCancelacionesActivas()
      ]);
      setFlightsList(data);
      setCanceledFlights(cancelaciones);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(l => l.trim().length > 0);
      const count = batchImportFlights(lines);
      setImportResult({ count, visible: true });
      setTimeout(() => setImportResult(null), 5000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const filtered = useMemo(() => {
    let list = flightsList;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(f => {
        const depTime = formatFlightTime(f.departureHour);
        const arrTime = formatFlightTime(f.departureHour + (f.transitHours || 0));
        return (
          f.id.toLowerCase().includes(q) ||
          f.origin.toLowerCase().includes(q) ||
          f.destination.toLowerCase().includes(q) ||
          depTime.includes(q) ||
          arrTime.includes(q)
        );
      });
    }
    if (filterOrigin !== "all") list = list.filter(f => f.origin === filterOrigin);
    if (filterType === "inter") list = list.filter(f => f.intercontinental);
    if (filterType === "intra") list = list.filter(f => !f.intercontinental);
    if (filterStatus === "active") list = list.filter(f => !f.cancelled);
    if (filterStatus === "cancelled") list = list.filter(f => f.cancelled);

    if (sortField === "departure") {
      list = [...list].sort((a, b) => a.departureHour - b.departureHour);
    } else if (sortField === "arrival") {
      list = [...list].sort((a, b) =>
        (a.departureHour + (a.transitHours || 0)) - (b.departureHour + (b.transitHours || 0))
      );
    } else if (sortField === "capacity") {
      list = [...list].sort((a, b) => b.capacity - a.capacity);
    }

    return list;
  }, [flightsList, search, filterOrigin, filterType, filterStatus, sortField]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  /** ID del próximo vuelo a despegar (el primero con departureHour >= hora actual) */
  const nextFlightId = useMemo(() => {
    // Solo sobre vuelos activos, sin cancelar
    const activos = flightsList.filter(f => !f.cancelled);
    if (!activos.length) return null;
    // Ordenar por horaSalida
    const sorted = [...activos].sort((a, b) => a.departureHour - b.departureHour);
    const next = sorted.find(f => f.departureHour >= nowHour);
    // Si todos ya pasaron, el próximo es el que salga más tarde (último del día)
    return (next ?? sorted[sorted.length - 1])?.id ?? null;
  }, [flightsList, nowHour]);

  const handleCancelHoy = async (flightId: string, origin: string, destination: string, depHour: number) => {
    setConfirmCancelHoy({ id: flightId, origin, destination, hour: formatFlightTime(depHour) });
    setAffectedOrders([]);
    setAffectedOrdersLoading(true);
    try {
      const orders = await api.getPedidosAfectadosHoy(flightId);
      setAffectedOrders(orders);
    } catch {
      setAffectedOrders([]);
    } finally {
      setAffectedOrdersLoading(false);
    }
  };

  const doConfirmCancelHoy = async () => {
    if (!confirmCancelHoy) return;
    setCancelHoyLoading(true);
    try {
      const res = await api.cancelarVueloHoy(confirmCancelHoy.id);
      toast.warning(
        res.pedidosAfectados > 0
          ? `Vuelo del día cancelado. ${res.pedidosAfectados} pedido(s) regresado(s) a replanificación.`
          : `Vuelo del día cancelado. No había pedidos afectados.`,
        { duration: 6000 }
      );
      // Reload active cancellations after success
      const cancelaciones = await api.getCancelacionesActivas();
      setCanceledFlights(cancelaciones);
    } catch (err: any) {
      toast.error(err?.message ?? "Error al cancelar el vuelo del día");
    } finally {
      setCancelHoyLoading(false);
      setConfirmCancelHoy(null);
    }
  };

  const handleCancel = (flightId: string, origin: string, destination: string) => {
    setConfirmCancel({ id: flightId, origin, destination });
  };

  const doConfirmCancel = () => {
    if (!confirmCancel) return;
    cancelFlight(confirmCancel.id);
    toast.warning(`Vuelo cancelado: ${confirmCancel.origin} → ${confirmCancel.destination}. Maletas afectadas replanificadas.`);
    setConfirmCancel(null);
  };

  const doConfirmClearAll = () => {
    clearFlights();
    toast.success("Todos los vuelos han sido eliminados.");
    setConfirmClearAll(false);
  };

  const toggleSort = (field: SortField) => {
    setSortField(prev => prev === field ? "none" : field);
    setPage(0);
  };

  // Styles
  const cardBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const thBg = isDark ? "bg-[#1e293b]/60" : "bg-[#e2e8f0]";
  const rowHover = isDark ? "hover:bg-[#1e293b]/40" : "hover:bg-[#f1f5f9]";
  const textPrimary = isDark ? "text-white" : "text-[#0f172a]";
  const textSecondary = isDark ? "text-[#94a3b8]" : "text-[#64748b]";
  const modalBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const overlayBg = "bg-black/60";
  const selectCls = `rounded-lg text-[12px] px-2 py-1.5 border ${isDark ? "bg-[#1e293b] border-[#334155] text-white" : "bg-white border-[#cbd5e1] text-[#0f172a]"
    }`;
  const sortBtnCls = (active: boolean) => `flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-colors ${active
      ? (isDark ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-400" : "bg-blue-600/10 border-blue-600/30 text-blue-700")
      : isDark ? "border-[#334155] text-[#94a3b8] hover:text-white" : "border-[#cbd5e1] text-[#64748b] hover:text-[#0f172a]"
    }`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Plane className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />
          <h1 className={`text-[20px] ${textPrimary}`}>Vuelos</h1>
          <span className={`text-[12px] px-2 py-0.5 rounded-full ${isDark ? "bg-[#1e293b] text-[#94a3b8]" : "bg-[#e2e8f0] text-[#64748b]"}`}>
            {loading ? "..." : flightsList.length} registrados
          </span>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <select value={filterOrigin} onChange={e => { setFilterOrigin(e.target.value); setPage(0); }} className={selectCls}>
            <option value="all">Todos los orígenes</option>
            {airportsList.map(a => <option key={a.code} value={a.code}>{a.code} — {a.city}</option>)}
          </select>
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(0); }} className={selectCls}>
            <option value="all">Todos los tipos</option>
            <option value="intra">Intracontinental</option>
            <option value="inter">Intercontinental</option>
          </select>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0); }} className={selectCls}>
            <option value="all">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="cancelled">Cancelados</option>
          </select>
          <div className="relative flex-1 sm:flex-none">
            <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${textSecondary}`} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Vuelo, origen, destino, hora..."
              className={`pl-8 pr-3 py-1.5 rounded-lg text-[12px] border w-full sm:w-64 ${isDark ? "bg-[#1e293b] border-[#334155] text-white placeholder:text-white/30" : "bg-white border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8]"
                }`}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`border rounded-xl overflow-hidden ${cardBg}`}>
        {/* Toolbar */}
        <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <span className={`text-[11px] ${textSecondary}`}>{filtered.length} vuelos encontrados</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => toggleSort("departure")} className={sortBtnCls(sortField === "departure")}>
              <ArrowUpDown className="w-3 h-3" /> Salida
            </button>
            <button onClick={() => toggleSort("arrival")} className={sortBtnCls(sortField === "arrival")}>
              <ArrowUpDown className="w-3 h-3" /> Llegada
            </button>
            <button onClick={() => toggleSort("capacity")} className={sortBtnCls(sortField === "capacity")}>
              <ArrowUpDown className="w-3 h-3" /> Capacidad
            </button>
            <button
              onClick={() => { if (state.flights.length > 0) setConfirmClearAll(true); }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-colors ${isDark ? "border-red-500/30 text-red-400 hover:bg-red-500/10" : "border-red-200 text-red-500 hover:bg-red-50"
                }`}
            >
              <Trash2 className="w-3 h-3" /> Borrar todos
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className={thBg}>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Origen</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Destino</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary} hidden md:table-cell`}>Salida</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary} hidden md:table-cell`}>Llegada</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Capacidad</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Tipo</th>
                <th className={`text-center px-3 py-2.5 ${textSecondary}`}>Cancelar hoy</th>
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={7} className={`text-center py-12 ${textSecondary}`}>
                    {search || filterOrigin !== "all" || filterType !== "all" || filterStatus !== "all"
                      ? "No se encontraron vuelos con los filtros aplicados"
                      : "No hay vuelos registrados"}
                  </td>
                </tr>
              ) : pageData.map(f => {
                const arrivalHour = f.departureHour + (f.transitHours || 0);
                const originAirport = airportsList.find((a: any) => a.code === f.origin);
                const destAirport = airportsList.find((a: any) => a.code === f.destination);
                const originTz = originAirport?.timezone ?? "";
                const destTz = destAirport?.timezone ?? "";
                const isNext = f.id === nextFlightId && !f.cancelled;
                return (
                  <tr key={f.id} className={`border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"
                    } ${isNext
                      ? isDark ? "bg-orange-500/5" : "bg-orange-50"
                      : f.cancelled ? "opacity-50" : rowHover
                    } transition-colors`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-600/10 text-blue-800"}`}>{f.origin}</span>
                        {isNext && (
                          <span className={`animate-pulse px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide ${isDark ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "bg-orange-100 text-orange-700 border border-orange-300"
                            }`}>PRÓXIMO</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-600/10 text-blue-800"}`}>{f.destination}</span>
                    </td>
                    <td className={`px-3 py-2.5 hidden md:table-cell`}>
                      <span className={`font-mono text-[11px] ${isNext ? (isDark ? "text-orange-400" : "text-orange-600") : textSecondary}`}>{formatFlightTime(f.departureHour)}</span>
                      {originTz && <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded ${isDark ? "bg-[#1e293b] text-[#64748b]" : "bg-[#e2e8f0] text-[#94a3b8]"}`}>{originTz}</span>}
                    </td>
                    <td className={`px-3 py-2.5 hidden md:table-cell`}>
                      <span className={`font-mono text-[11px] ${textSecondary}`}>{formatFlightTime(arrivalHour)}</span>
                      {destTz && <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded ${isDark ? "bg-[#1e293b] text-[#64748b]" : "bg-[#e2e8f0] text-[#94a3b8]"}`}>{destTz}</span>}
                    </td>
                    <td className={`px-3 py-2.5 ${textPrimary}`}>{f.capacity}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${f.intercontinental
                          ? isDark ? "bg-purple-500/15 text-purple-400" : "bg-purple-100 text-purple-700"
                          : isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-700"
                        }`}>{f.intercontinental ? "Inter" : "Intra"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center">
                        {!f.cancelled && (
                          canceledFlights.includes(f.id) ? (
                            <span className={`text-[10px] italic ${textSecondary}`}>
                              Ya cancelado hoy
                            </span>
                          ) : (
                            <button
                              onClick={() => handleCancelHoy(f.id, f.origin, f.destination, f.departureHour)}
                              title="Cancelar la ocurrencia de HOY de este vuelo"
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-colors ${isNext
                                  ? isDark
                                    ? "bg-orange-500/15 border-orange-500/40 text-orange-400 hover:bg-orange-500/25"
                                    : "bg-orange-100 border-orange-300 text-orange-700 hover:bg-orange-200"
                                  : isDark
                                    ? "border-[#334155] text-[#64748b] hover:border-red-500/40 hover:text-red-400"
                                    : "border-[#cbd5e1] text-[#94a3b8] hover:border-red-300 hover:text-red-600"
                                }`}
                            >
                              <CalendarX2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Cancelar hoy</span>
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > ROWS_PER_PAGE && (
          <div className={`flex items-center justify-between px-3 py-2 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
            <span className={`text-[11px] ${textSecondary}`}>
              {page * ROWS_PER_PAGE + 1}–{Math.min((page + 1) * ROWS_PER_PAGE, filtered.length)} de {filtered.length}
            </span>
            <div className="flex items-center gap-0.5">
              {/* First page */}
              <button disabled={page === 0} onClick={() => setPage(0)}
                title="Primera página"
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}>
                <ChevronsLeft className="w-4 h-4" />
              </button>
              {/* Prev page */}
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                title="Página anterior"
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}>
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Page number buttons with ±2 window */}
              {(() => {
                const pageBtnCls = (p: number) =>
                  `min-w-[26px] h-[26px] flex items-center justify-center rounded text-[11px] transition-colors ${p === page
                    ? isDark ? "bg-cyan-500/20 text-cyan-400 font-semibold" : "bg-blue-600/15 text-blue-700 font-semibold"
                    : isDark ? "hover:bg-[#334155] text-[#94a3b8] hover:text-white" : "hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0f172a]"
                  }`;
                const ellipsisCls = `px-1 text-[11px] ${textSecondary} select-none`;

                const pages: React.ReactNode[] = [];
                const start = Math.max(0, page - 2);
                const end = Math.min(totalPages - 1, page + 2);

                // Always show page 0
                if (start > 0) {
                  pages.push(<button key={0} onClick={() => setPage(0)} className={pageBtnCls(0)}>1</button>);
                  if (start > 1) pages.push(<span key="el-start" className={ellipsisCls}>…</span>);
                }

                for (let i = start; i <= end; i++) {
                  pages.push(
                    <button key={i} onClick={() => setPage(i)} className={pageBtnCls(i)}>{i + 1}</button>
                  );
                }

                // Always show last page
                if (end < totalPages - 1) {
                  if (end < totalPages - 2) pages.push(<span key="el-end" className={ellipsisCls}>…</span>);
                  pages.push(<button key={totalPages - 1} onClick={() => setPage(totalPages - 1)} className={pageBtnCls(totalPages - 1)}>{totalPages}</button>);
                }

                return pages;
              })()}

              {/* Next page */}
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                title="Página siguiente"
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}>
                <ChevronRight className="w-4 h-4" />
              </button>
              {/* Last page */}
              <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}
                title="Última página"
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}>
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Batch Import */}
      <div className={`border rounded-xl overflow-hidden ${cardBg}`}>
        <div className={`px-5 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-cyan-500/10" : "bg-blue-600/10"}`}>
              <Upload className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />
            </div>
            <div>
              <h3 className={`text-[14px] ${textPrimary}`}>Importación de Vuelos en Lote</h3>
              <p className={`text-[11px] ${textSecondary}`}>Carga múltiples vuelos desde un archivo de texto (.txt o .csv)</p>
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex-1 space-y-3">
              <div className={`text-[12px] ${textSecondary}`}>
                <p className="mb-2">Cada línea debe seguir el formato separado por guiones:</p>
                <div className={`rounded-lg p-3 font-mono text-[11px] ${isDark ? "bg-[#1e293b] text-cyan-300" : "bg-[#f1f5f9] text-blue-800"}`}>
                  Origen-Destino-HoraSalida-HoraLlegada-Duración<br />
                  <span className={isDark ? "text-white/40" : "text-[#94a3b8]"}>Ejemplo: </span>SKBO-SEQM-03:34-05:21-0300
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <FileText className={`w-3.5 h-3.5 ${textSecondary}`} /><span className={`text-[11px] ${textSecondary}`}>Formatos: .txt, .csv</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Globe className={`w-3.5 h-3.5 ${textSecondary}`} /><span className={`text-[11px] ${textSecondary}`}>Códigos IATA de 4 letras</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className={`w-3.5 h-3.5 ${textSecondary}`} /><span className={`text-[11px] ${textSecondary}`}>Horarios en formato HH:MM</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Plane className={`w-3.5 h-3.5 ${textSecondary}`} /><span className={`text-[11px] ${textSecondary}`}>Tipo auto-detectado por duración</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <input ref={fileRef} type="file" accept=".txt,.csv" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileRef.current?.click()}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] transition-all ${isDark
                    ? "bg-gradient-to-r from-cyan-600/20 to-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:from-cyan-600/30 hover:to-cyan-500/20"
                    : "bg-gradient-to-r from-blue-600/20 to-blue-500/10 border border-blue-500/30 text-blue-700 hover:from-blue-600/30 hover:to-blue-500/20"
                  }`}>
                <Upload className="w-4 h-4" /> Seleccionar Archivo
              </button>
              {importResult?.visible && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-[11px] text-green-400">{importResult.count} vuelos importados</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Cancelar ocurrencia de HOY */}
      {confirmCancelHoy && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => !cancelHoyLoading && setConfirmCancelHoy(null)}>
          <div className={`border rounded-xl w-full max-w-md mx-4 ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4">
              <div className="flex items-start gap-3 mb-3">
                <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-orange-500/15" : "bg-orange-100"
                  }`}>
                  <CalendarX2 className={`w-5 h-5 ${isDark ? "text-orange-400" : "text-orange-600"}`} />
                </div>
                <div>
                  <h3 className={`text-[14px] font-medium mb-0.5 ${textPrimary}`}>Cancelar vuelo de hoy</h3>
                  <p className={`text-[11px] ${textSecondary}`}>
                    Solo se cancela la ocurrencia de <span className={`font-semibold ${isDark ? "text-orange-400" : "text-orange-600"}`}>hoy</span>. El vuelo seguirá programado para días futuros.
                  </p>
                </div>
              </div>

              <div className={`rounded-lg p-3 mb-3 ${isDark ? "bg-[#1e293b] border border-[#334155]" : "bg-[#f8fafc] border border-[#e2e8f0]"
                }`}>
                <div className="flex items-center gap-2 text-[12px]">
                  <Plane className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                  <span className={`font-mono font-medium ${textPrimary}`}>
                    {confirmCancelHoy.origin} → {confirmCancelHoy.destination}
                  </span>
                  <span className={`ml-auto font-mono text-[11px] ${textSecondary}`}>
                    Salida: {confirmCancelHoy.hour}
                  </span>
                </div>
              </div>

              {/* Lista de envíos afectados */}
              <div className={`rounded-lg border overflow-hidden ${isDark ? "border-[#334155]" : "border-[#e2e8f0]"
                }`}>
                <div className={`px-3 py-2 flex items-center gap-2 border-b ${isDark ? "bg-[#1e293b]/70 border-[#334155]" : "bg-[#f1f5f9] border-[#e2e8f0]"
                  }`}>
                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
                  <span className={`text-[11px] font-medium ${isDark ? "text-amber-300" : "text-amber-700"}`}>
                    Envíos que serán replanificados
                  </span>
                  {!affectedOrdersLoading && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${affectedOrders.length > 0
                        ? isDark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-700"
                        : isDark ? "bg-[#334155] text-[#94a3b8]" : "bg-[#e2e8f0] text-[#64748b]"
                      }`}>{affectedOrders.length}</span>
                  )}
                </div>

                {affectedOrdersLoading ? (
                  <div className={`flex items-center justify-center gap-2 py-6 ${isDark ? "bg-[#0f172a]" : "bg-white"
                    }`}>
                    <span className={`animate-spin w-4 h-4 rounded-full border-2 border-t-transparent ${isDark ? "border-cyan-400" : "border-blue-600"
                      }`} />
                    <span className={`text-[11px] ${textSecondary}`}>Consultando envíos afectados…</span>
                  </div>
                ) : affectedOrders.length === 0 ? (
                  <div className={`py-5 text-center text-[11px] ${textSecondary} ${isDark ? "bg-[#0f172a]" : "bg-white"
                    }`}>
                    Ningún envío activo usa este vuelo hoy.
                  </div>
                ) : (
                  <div className={`divide-y max-h-44 overflow-y-auto ${isDark ? "divide-[#1e293b] bg-[#0f172a]" : "divide-[#f1f5f9] bg-white"
                    }`}>
                    {/* Header */}
                    <div className={`grid grid-cols-3 px-3 py-1.5 ${isDark ? "bg-[#1e293b]/40" : "bg-[#f8fafc]"
                      }`}>
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${textSecondary}`}>ID Envío</span>
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${textSecondary}`}>Aerolínea</span>
                      <span className={`text-[10px] font-medium uppercase tracking-wide text-right ${textSecondary}`}>Maletas</span>
                    </div>
                    {affectedOrders.map((o: any) => (
                      <div key={o.id} className={`grid grid-cols-3 items-center px-3 py-2 transition-colors ${isDark ? "hover:bg-[#1e293b]/40" : "hover:bg-[#f8fafc]"
                        }`}>
                        <span className={`font-mono text-[11px] ${isDark ? "text-cyan-400" : "text-blue-700"
                          }`}>{o.id}</span>
                        <span className={`text-[11px] truncate ${textPrimary}`}>{o.nombreAerolinea ?? "—"}</span>
                        <span className={`text-[11px] text-right font-medium ${isDark ? "text-orange-400" : "text-orange-700"
                          }`}>{o.cantidadMaletas}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"
              }`}>
              <button
                disabled={cancelHoyLoading}
                onClick={() => setConfirmCancelHoy(null)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors disabled:opacity-40 ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"
                  }`}>
                Cancelar
              </button>
              <button
                disabled={cancelHoyLoading}
                onClick={doConfirmCancelHoy}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] text-white transition-colors disabled:opacity-60 ${isDark ? "bg-orange-600 hover:bg-orange-500" : "bg-orange-600 hover:bg-orange-500"
                  }`}>
                {cancelHoyLoading ? (
                  <><span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" /> Procesando…</>
                ) : (
                  <><CalendarX2 className="w-3.5 h-3.5" /> Confirmar cancelación de hoy</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel single flight modal (cancelación permanente — queda disponible por compatibilidad) */}
      {confirmCancel && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => setConfirmCancel(null)}>
          <div className={`border rounded-xl w-full max-w-sm mx-4 ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 text-center">
              <div className={`mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-3 ${isDark ? "bg-red-500/15" : "bg-red-100"}`}>
                <AlertTriangle className={`w-5 h-5 ${isDark ? "text-red-400" : "text-red-600"}`} />
              </div>
              <h3 className={`text-[14px] mb-1 ${textPrimary}`}>Cancelar vuelo</h3>
              <p className={`text-[12px] ${textSecondary}`}>
                ¿Estás seguro de cancelar el vuelo de{" "}
                <span className={textPrimary}>{confirmCancel.origin}</span> a{" "}
                <span className={textPrimary}>{confirmCancel.destination}</span>?
                Las maletas afectadas serán replanificadas.
              </p>
            </div>
            <div className={`flex items-center justify-center gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button onClick={() => setConfirmCancel(null)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}>
                Cancelar
              </button>
              <button onClick={doConfirmCancel}
                className="px-4 py-1.5 rounded-lg text-[12px] bg-red-600 hover:bg-red-500 text-white transition-colors">
                Confirmar Cancelación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear all flights confirmation modal (RF72) */}
      {confirmClearAll && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => setConfirmClearAll(false)}>
          <div className={`border rounded-xl w-full max-w-sm mx-4 ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 text-center">
              <div className={`mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-3 ${isDark ? "bg-red-500/15" : "bg-red-100"}`}>
                <Trash2 className={`w-5 h-5 ${isDark ? "text-red-400" : "text-red-600"}`} />
              </div>
              <h3 className={`text-[14px] mb-1 ${textPrimary}`}>Eliminar todos los vuelos</h3>
              <p className={`text-[12px] ${textSecondary}`}>
                ¿Estás seguro de eliminar los <span className={textPrimary}>{state.flights.length} vuelos</span> cargados actualmente?
                Esta acción no se puede deshacer y permite realizar una nueva carga masiva desde cero.
              </p>
            </div>
            <div className={`flex items-center justify-center gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button onClick={() => setConfirmClearAll(false)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}>
                Cancelar
              </button>
              <button onClick={doConfirmClearAll}
                className="px-4 py-1.5 rounded-lg text-[12px] bg-red-600 hover:bg-red-500 text-white transition-colors">
                Eliminar Todos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
