import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTheme } from "../context/ThemeContext";
import { api } from "../services/api";
import { RealTimeWebSocketClient } from "../services/realTimeWebSocket";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import {
  Activity, Plane, Clock, Warehouse, AlertTriangle,
  XCircle, Radio, Gauge, Package, CheckCircle, MapPin, TrendingUp
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Resumen {
  totalActivos: number;
  pendientes: number;
  planificados: number;
  enRuta: number;
  ultimaActualizacion: string;
  ocupacionGlobalAlmacenes: number;
  ocupacionGlobalVuelos: number;
  stockActualAlmacenes: Record<string, number>;
}

interface Pedido {
  id: string;
  origenOaci: string;
  destinoOaci: string;
  fechaHoraRegistro: string;
  cantidadMaletas: number;
  nombreAerolinea: string;
  estado: string;
  ubicacionActual: string;
  tramos: { orden: number; origenOaci: string; destinoOaci: string; fechaSalida: string; fechaLlegada: string; estado: string }[];
}

interface Airport {
  code: string;
  city: string;
  warehouseCapacity: number;
  currentStock: number;
}

interface ActivityEvent {
  id: string;
  type: "nuevo" | "enruta" | "entregado" | "sinruta" | "actualizado";
  message: string;
  timestamp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(isoStr: string): string {
  if (!isoStr) return "—";
  try {
    const utc = isoStr.endsWith("Z") ? isoStr : isoStr + "Z";
    const d = new Date(utc);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mo} ${hh}:${mm}`;
  } catch { return "—"; }
}

function fmtNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  accentColor: string;        // e.g. "blue" | "cyan" | "amber" | "red" | "green" | "purple" | "orange" | "rose"
  trend?: "up" | "down" | "neutral";
  isDark: boolean;
  pulse?: boolean;
}

const ACCENT: Record<string, { ring: string; bg: string; text: string; border: string }> = {
  blue:   { ring: "ring-blue-500/30",   bg: "bg-blue-500/15",   text: "text-blue-400",   border: "border-blue-500/20" },
  cyan:   { ring: "ring-cyan-500/30",   bg: "bg-cyan-500/15",   text: "text-cyan-400",   border: "border-cyan-500/20" },
  amber:  { ring: "ring-amber-500/30",  bg: "bg-amber-500/15",  text: "text-amber-400",  border: "border-amber-500/20" },
  red:    { ring: "ring-red-500/30",    bg: "bg-red-500/15",    text: "text-red-400",    border: "border-red-500/20" },
  green:  { ring: "ring-green-500/30",  bg: "bg-green-500/15",  text: "text-green-400",  border: "border-green-500/20" },
  purple: { ring: "ring-purple-500/30", bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/20" },
  orange: { ring: "ring-orange-500/30", bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/20" },
  rose:   { ring: "ring-rose-500/30",   bg: "bg-rose-500/15",   text: "text-rose-400",   border: "border-rose-500/20" },
  // Light mode variants
  "blue-l":   { ring: "ring-blue-600/20",   bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-200" },
  "cyan-l":   { ring: "ring-cyan-600/20",   bg: "bg-cyan-100",   text: "text-cyan-800",   border: "border-cyan-200" },
  "amber-l":  { ring: "ring-amber-600/20",  bg: "bg-amber-100",  text: "text-amber-700",  border: "border-amber-200" },
  "red-l":    { ring: "ring-red-600/20",    bg: "bg-red-100",    text: "text-red-700",    border: "border-red-200" },
  "green-l":  { ring: "ring-green-600/20",  bg: "bg-green-100",  text: "text-green-700",  border: "border-green-200" },
  "purple-l": { ring: "ring-purple-600/20", bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200" },
  "orange-l": { ring: "ring-orange-600/20", bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  "rose-l":   { ring: "ring-rose-600/20",   bg: "bg-rose-100",   text: "text-rose-700",   border: "border-rose-200" },
};

function KpiCard({ title, value, subtitle, icon, accentColor, isDark, pulse }: KpiCardProps) {
  const key = isDark ? accentColor : `${accentColor}-l`;
  const a = ACCENT[key] || ACCENT[accentColor];
  return (
    <Card className={`relative overflow-hidden border transition-all duration-200 hover:scale-[1.02] ${
      isDark
        ? `bg-[#1e293b]/60 border-[#334155] hover:border-[#475569]`
        : `bg-white border-[#cbd5e1] hover:border-[#94a3b8] shadow-sm`
    }`}>
      {/* Accent glow strip */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${a.bg}`} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-medium uppercase tracking-wide mb-1 ${isDark ? "text-white/50" : "text-[#64748b]"}`}>
              {title}
            </p>
            <p className={`text-[26px] font-bold leading-none ${isDark ? "text-white" : "text-[#0f172a]"}`}>
              {value}
            </p>
            {subtitle && (
              <p className={`text-[11px] mt-1 ${isDark ? "text-white/40" : "text-[#94a3b8]"}`}>{subtitle}</p>
            )}
          </div>
          <div className={`p-2.5 rounded-xl ${a.bg} ring-1 ${a.ring} relative`}>
            <div className={a.text}>{icon}</div>
            {pulse && (
              <span className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ${
                isDark ? "bg-cyan-400" : "bg-blue-500"
              } animate-ping`} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────

const ACTIVITY_ICONS: Record<string, (isDark: boolean) => React.ReactNode> = {
  nuevo:      (d) => <Package className={`w-3 h-3 shrink-0 ${d ? "text-blue-400" : "text-blue-600"}`} />,
  enruta:     (d) => <Plane className={`w-3 h-3 shrink-0 ${d ? "text-cyan-400" : "text-cyan-700"}`} />,
  entregado:  (d) => <CheckCircle className={`w-3 h-3 shrink-0 ${d ? "text-green-400" : "text-green-600"}`} />,
  sinruta:    (d) => <XCircle className={`w-3 h-3 shrink-0 ${d ? "text-red-400" : "text-red-600"}`} />,
  actualizado: (d) => <MapPin className={`w-3 h-3 shrink-0 ${d ? "text-amber-400" : "text-amber-600"}`} />,
};

// ─── Mini stat pill ────────────────────────────────────────────────────────────

function StatPill({ label, value, color, isDark }: { label: string; value: number; color: string; isDark: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${isDark ? "bg-[#0f172a]/60" : "bg-[#f0f4f8]"}`}>
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className={`text-[11px] ${isDark ? "text-white/60" : "text-[#475569]"}`}>{label}</span>
      <span className={`text-[11px] font-semibold ${isDark ? "text-white/90" : "text-[#0f172a]"}`}>{value}</span>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function Dashboard() {
  const { isDark } = useTheme();

  // ── State ──
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activeLineData, setActiveLineData] = useState<{ t: string; activos: number }[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Keep a stable ref for pushing activity events without re-triggering effects
  const activityRef = useRef<ActivityEvent[]>([]);

  const pushActivity = useCallback((evt: ActivityEvent) => {
    activityRef.current = [evt, ...activityRef.current].slice(0, 60);
    setActivity([...activityRef.current]);
  }, []);

  // ── Initial load ──
  useEffect(() => {
    const load = async () => {
      try {
        const [res, ops, aps] = await Promise.all([
          api.getResumenRT(),
          api.getOperacionesRT(),
          api.getAirports(),
        ]);
        setResumen(res);
        setPedidos(ops || []);
        setAirports((aps || []).map((a: any) => ({
          code: a.oaci,
          city: a.ciudad,
          warehouseCapacity: a.capacidadAlmacen,
          currentStock: a.stockActual || 0,
        })));
        setLastUpdated(fmtNow());
        setLoading(false);
        // Seed line chart
        setActiveLineData([{ t: fmtNow(), activos: res?.totalActivos ?? 0 }]);
      } catch (e) {
        console.error("Dashboard load error:", e);
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── WebSocket ──
  useEffect(() => {
    const ws = new RealTimeWebSocketClient("ADMIN", undefined, {
      onActualizacion: (r: Resumen) => {
        setResumen(r);
        setLastUpdated(fmtNow());
        setActiveLineData(prev => [...prev.slice(-29), { t: fmtNow(), activos: r.totalActivos }]);
      },
      onNuevoPedido: (p: Pedido) => {
        setPedidos(prev => {
          if (prev.some(x => x.id === p.id)) return prev;
          return [p, ...prev];
        });
        pushActivity({
          id: `nuevo-${p.id}-${Date.now()}`,
          type: "nuevo",
          message: `Nuevo pedido ${p.id} · ${p.origenOaci} → ${p.destinoOaci} · ${p.cantidadMaletas} maletas`,
          timestamp: Date.now(),
        });
      },
      onPedidosActualizados: (lista: Pedido[]) => {
        setPedidos(prev => {
          const map = new Map(prev.map(p => [p.id, p]));
          lista.forEach(p => map.set(p.id, p));
          return Array.from(map.values());
        });
        // Build activity events from status changes
        lista.forEach(p => {
          if (p.estado === "EN_RUTA") {
            pushActivity({ id: `enruta-${p.id}-${Date.now()}`, type: "enruta", message: `${p.id} en ruta · ${p.ubicacionActual} → ${p.destinoOaci}`, timestamp: Date.now() });
          } else if (p.estado === "ENTREGADO") {
            pushActivity({ id: `entregado-${p.id}-${Date.now()}`, type: "entregado", message: `${p.id} entregado en ${p.destinoOaci}`, timestamp: Date.now() });
          } else if (p.estado === "SIN_RUTA" || p.estado === "COLAPSO") {
            pushActivity({ id: `sinruta-${p.id}-${Date.now()}`, type: "sinruta", message: `${p.id} sin ruta desde ${p.ubicacionActual}`, timestamp: Date.now() });
          }
        });
        setLastUpdated(fmtNow());
      },
    });
    ws.connect();
    return () => ws.disconnect();
  }, [pushActivity]);

  // ── Derived KPIs ──
  const sinRutaCount = useMemo(
    () => pedidos.filter(p => p.estado === "SIN_RUTA" || p.estado === "COLAPSO").length,
    [pedidos]
  );

  const vuelosActivosCount = useMemo(() => {
    const keys = new Set<string>();
    pedidos.forEach(p =>
      (p.tramos || []).forEach(t => {
        if (t.estado === "EN_VUELO") keys.add(`${t.origenOaci}-${t.destinoOaci}-${t.fechaSalida}`);
      })
    );
    return keys.size;
  }, [pedidos]);

  const aeropuertosAlLimite = useMemo(
    () => airports.filter(a => a.warehouseCapacity > 0 && (a.currentStock / a.warehouseCapacity) >= 0.8).length,
    [airports]
  );

  // ── Chart data ──
  const cardCls = isDark ? "bg-[#1e293b]/60 border-[#334155]" : "bg-white border-[#cbd5e1] shadow-sm";
  const titleCls = isDark ? "text-white" : "text-[#0f172a]";
  const gridStroke = isDark ? "#334155" : "#e2e8f0";
  const axisStroke = isDark ? "#64748b" : "#94a3b8";
  const tooltipStyle = isDark
    ? { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12, color: "#f1f5f9" }
    : { background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 12, color: "#111827" };

  const estadosPieData = useMemo(() => {
    const counts: Record<string, number> = { PENDIENTE: 0, PLANIFICADO: 0, EN_RUTA: 0, ENTREGADO: 0, SIN_RUTA: 0 };
    pedidos.forEach(p => {
      const key = p.estado === "COLAPSO" ? "SIN_RUTA" : p.estado;
      if (key in counts) counts[key]++;
    });
    return [
      { name: "Sin vuelo", value: counts.PENDIENTE, color: "#f59e0b" },
      { name: "Asignado", value: counts.PLANIFICADO, color: "#3b82f6" },
      { name: "En ruta", value: counts.EN_RUTA, color: "#06b6d4" },
      { name: "Entregado", value: counts.ENTREGADO, color: "#22c55e" },
      { name: "Sin ruta", value: counts.SIN_RUTA, color: "#ef4444" },
    ].filter(d => d.value > 0);
  }, [pedidos]);

  const topAirportsData = useMemo(() =>
    [...airports]
      .sort((a, b) => b.currentStock - a.currentStock)
      .slice(0, 8)
      .map(a => ({
        code: a.code,
        stock: a.currentStock,
        capacidad: a.warehouseCapacity,
        pct: a.warehouseCapacity > 0 ? Math.round((a.currentStock / a.warehouseCapacity) * 100) : 0,
      })),
    [airports]
  );

  // ── Render ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className={`flex flex-col items-center gap-3 ${isDark ? "text-white/50" : "text-[#64748b]"}`}>
          <div className={`w-8 h-8 rounded-full border-2 border-t-transparent animate-spin ${isDark ? "border-cyan-500" : "border-blue-600"}`} />
          <span className="text-[13px]">Conectando con operación en tiempo real…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-[18px] font-bold ${isDark ? "text-white" : "text-[#0f172a]"}`}>
            Centro de Operaciones
          </h1>
          <p className={`text-[12px] ${isDark ? "text-white/40" : "text-[#94a3b8]"}`}>
            Datos en vivo · última actualización {lastUpdated || "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full animate-pulse ${isDark ? "bg-cyan-400" : "bg-blue-500"}`} />
          <span className={`text-[12px] font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>En Vivo</span>
        </div>
      </div>

      {/* ── KPI Grid (8 cards) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard isDark={isDark} title="Pedidos activos" value={resumen?.totalActivos ?? 0}
          subtitle="total en curso" icon={<Activity className="w-4 h-4" />} accentColor="blue" pulse />
        <KpiCard isDark={isDark} title="En ruta ahora" value={resumen?.enRuta ?? 0}
          subtitle="tramos EN_VUELO" icon={<Plane className="w-4 h-4" />} accentColor="cyan" pulse />
        <KpiCard isDark={isDark} title="Sin asignar" value={resumen?.pendientes ?? 0}
          subtitle="esperan vuelo" icon={<Clock className="w-4 h-4" />} accentColor="amber" />
        <KpiCard isDark={isDark} title="Planificados" value={resumen?.planificados ?? 0}
          subtitle="vuelo asignado" icon={<CheckCircle className="w-4 h-4" />} accentColor="green" />
        <KpiCard isDark={isDark} title="Ocup. almacenes" value={`${Math.round(resumen?.ocupacionGlobalAlmacenes ?? 0)}%`}
          subtitle="global warehouses" icon={<Warehouse className="w-4 h-4" />} accentColor="purple" />
        <KpiCard isDark={isDark} title="Ocup. vuelos" value={`${Math.round(resumen?.ocupacionGlobalVuelos ?? 0)}%`}
          subtitle="carga aérea global" icon={<Gauge className="w-4 h-4" />} accentColor="orange" />
        <KpiCard isDark={isDark} title="Aerop. al límite" value={aeropuertosAlLimite}
          subtitle="≥80% capacidad" icon={<AlertTriangle className="w-4 h-4" />} accentColor="red" />
        <KpiCard isDark={isDark} title="Colapso" value={sinRutaCount}
          subtitle="sin ruta / colapso" icon={<XCircle className="w-4 h-4" />} accentColor="red" />
      </div>

      {/* ── Estado pills summary ── */}
      <div className="flex flex-wrap gap-2">
        <StatPill label="Pendiente" value={resumen?.pendientes ?? 0} color="bg-amber-400" isDark={isDark} />
        <StatPill label="Planificado" value={resumen?.planificados ?? 0} color="bg-blue-500" isDark={isDark} />
        <StatPill label="En ruta" value={resumen?.enRuta ?? 0} color="bg-cyan-400" isDark={isDark} />
        <StatPill label="Vuelos activos" value={vuelosActivosCount} color="bg-sky-400" isDark={isDark} />
        <StatPill label="Colapso" value={sinRutaCount} color="bg-red-400" isDark={isDark} />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Pie — Distribución de estados */}
        <Card className={`border ${cardCls}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-[14px] font-semibold ${titleCls}`}>Distribución de estados</CardTitle>
            <p className={`text-[11px] ${isDark ? "text-white/40" : "text-[#94a3b8]"}`}>pedidos activos por estado</p>
          </CardHeader>
          <CardContent className="h-[220px]">
            {estadosPieData.length === 0 ? (
              <div className={`flex items-center justify-center h-full text-[12px] ${isDark ? "text-white/30" : "text-[#94a3b8]"}`}>
                Sin datos disponibles
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={estadosPieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {estadosPieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: isDark ? "#94a3b8" : "#475569" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Line — Evolución de pedidos activos */}
        <Card className={`border ${cardCls}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-[14px] font-semibold ${titleCls}`}>Pedidos activos en el tiempo</CardTitle>
            <p className={`text-[11px] ${isDark ? "text-white/40" : "text-[#94a3b8]"}`}>actualización automática vía WebSocket</p>
          </CardHeader>
          <CardContent className="h-[220px]">
            {activeLineData.length < 2 ? (
              <div className={`flex items-center justify-center h-full text-[12px] ${isDark ? "text-white/30" : "text-[#94a3b8]"}`}>
                Esperando actualizaciones…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeLineData}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="t" stroke={axisStroke} tick={{ fontSize: 9, fill: axisStroke }} interval="preserveStartEnd" />
                  <YAxis stroke={axisStroke} tick={{ fontSize: 10, fill: axisStroke }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="activos" stroke={isDark ? "#06b6d4" : "#2563eb"} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Bar — Ocupación top aeropuertos */}
        <Card className={`border ${cardCls}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-[14px] font-semibold ${titleCls}`}>Almacenes — top 8 por carga</CardTitle>
            <p className={`text-[11px] ${isDark ? "text-white/40" : "text-[#94a3b8]"}`}>stock actual vs capacidad</p>
          </CardHeader>
          <CardContent className="h-[220px]">
            {topAirportsData.length === 0 ? (
              <div className={`flex items-center justify-center h-full text-[12px] ${isDark ? "text-white/30" : "text-[#94a3b8]"}`}>
                Sin datos de aeropuertos
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topAirportsData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <CartesianGrid stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" stroke={axisStroke} tick={{ fontSize: 9, fill: axisStroke }} />
                  <YAxis dataKey="code" type="category" stroke={axisStroke} width={36} tick={{ fontSize: 9, fill: axisStroke }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="capacidad" fill={isDark ? "#1e3a5f" : "#dbeafe"} radius={[0, 4, 4, 0]} name="Capacidad" />
                  <Bar dataKey="stock" fill={isDark ? "#3b82f6" : "#2563eb"} radius={[0, 4, 4, 0]} name="Stock actual" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom row: activity feed + airports table ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Activity feed */}
        <Card className={`border ${cardCls}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className={`text-[14px] font-semibold ${titleCls}`}>Actividad reciente</CardTitle>
              <div className="flex items-center gap-1.5">
                <Radio className={`w-3 h-3 animate-pulse ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                <span className={`text-[10px] ${isDark ? "text-cyan-400" : "text-blue-600"}`}>En vivo</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[220px] px-4 pb-3">
              {activity.length === 0 ? (
                <div className={`flex flex-col items-center justify-center h-32 gap-2 ${isDark ? "text-white/30" : "text-[#94a3b8]"}`}>
                  <TrendingUp className="w-5 h-5" />
                  <span className="text-[12px]">Esperando actividad…</span>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {activity.map((e) => (
                    <div key={e.id} className={`flex items-start gap-2 py-1.5 border-b ${isDark ? "border-[#1e293b]" : "border-[#f1f5f9]"}`}>
                      <div className="mt-0.5">{(ACTIVITY_ICONS[e.type] || ACTIVITY_ICONS.actualizado)(isDark)}</div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[11px] leading-snug ${isDark ? "text-white/80" : "text-[#1e293b]"}`}>{e.message}</p>
                        <p className={`text-[9px] mt-0.5 ${isDark ? "text-white/30" : "text-[#94a3b8]"}`}>
                          {new Date(e.timestamp).toLocaleTimeString("es-ES")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Airports occupancy table */}
        <Card className={`border ${cardCls}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-[14px] font-semibold ${titleCls}`}>Ocupación de almacenes</CardTitle>
            <p className={`text-[11px] ${isDark ? "text-white/40" : "text-[#94a3b8]"}`}>todos los aeropuertos con stock</p>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[220px] px-4 pb-3">
              {airports.length === 0 ? (
                <div className={`flex items-center justify-center h-20 text-[12px] ${isDark ? "text-white/30" : "text-[#94a3b8]"}`}>
                  Sin datos de aeropuertos
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className={isDark ? "text-white/40" : "text-[#94a3b8]"}>
                      <th className="text-left py-1 font-medium">Aeropuerto</th>
                      <th className="text-right py-1 font-medium">Stock</th>
                      <th className="text-right py-1 font-medium">Cap.</th>
                      <th className="text-right py-1 font-medium w-20">Uso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...airports]
                      .sort((a, b) => {
                        const pctA = a.warehouseCapacity > 0 ? a.currentStock / a.warehouseCapacity : 0;
                        const pctB = b.warehouseCapacity > 0 ? b.currentStock / b.warehouseCapacity : 0;
                        return pctB - pctA;
                      })
                      .map(a => {
                        const pct = a.warehouseCapacity > 0 ? Math.round((a.currentStock / a.warehouseCapacity) * 100) : 0;
                        const barColor = pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-amber-400" : "bg-blue-500";
                        return (
                          <tr key={a.code} className={`border-b ${isDark ? "border-[#1e293b]" : "border-[#f1f5f9]"}`}>
                            <td className={`py-1.5 font-mono font-semibold ${isDark ? "text-white/80" : "text-[#0f172a]"}`}>{a.code}</td>
                            <td className={`py-1.5 text-right ${isDark ? "text-white/60" : "text-[#475569]"}`}>{a.currentStock.toLocaleString()}</td>
                            <td className={`py-1.5 text-right ${isDark ? "text-white/40" : "text-[#94a3b8]"}`}>{a.warehouseCapacity.toLocaleString()}</td>
                            <td className="py-1.5 pl-2">
                              <div className="flex items-center gap-1.5">
                                <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? "bg-[#1e293b]" : "bg-[#e2e8f0]"}`}>
                                  <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                                </div>
                                <span className={`text-[9px] w-7 text-right ${pct >= 80 ? "text-red-400" : isDark ? "text-white/50" : "text-[#64748b]"}`}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}