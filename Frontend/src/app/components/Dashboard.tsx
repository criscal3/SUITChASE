import React from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { StatsCharts } from "./StatsCharts";
import { EventLog } from "./EventLog";
import { Package, Plane, AlertTriangle, CheckCircle, Clock, Warehouse } from "lucide-react";

function KpiCard({ title, value, icon, color, isDark }: { title: string; value: string | number; icon: React.ReactNode; color: string; isDark: boolean }) {
  return (
    <Card className={`border ${isDark ? "bg-[#1e293b]/50 border-[#334155]" : "bg-white border-[#cbd5e1]"}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
        <div>
          <p className={`text-[12px] ${isDark ? "text-white/80" : "text-[#475569]"}`}>{title}</p>
          <p className={`text-[20px] ${isDark ? "text-white" : "text-[#0f172a]"}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { state, events } = useSim();
  const { isDark } = useTheme();
  const { stats } = state;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard isDark={isDark} title="Registradas" value={stats.totalRegistered} icon={<Package className="w-4 h-4 text-blue-400" />} color="bg-blue-500/20" />
        <KpiCard isDark={isDark} title="Entregadas" value={stats.totalDelivered} icon={<CheckCircle className="w-4 h-4 text-green-400" />} color="bg-green-500/20" />
        <KpiCard isDark={isDark} title="En Tránsito" value={stats.totalInTransit} icon={<Plane className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />} color={isDark ? "bg-cyan-500/20" : "bg-blue-600/20"} />
        <KpiCard isDark={isDark} title="En Espera" value={stats.totalWaiting} icon={<Clock className="w-4 h-4 text-amber-400" />} color="bg-amber-500/20" />
        <KpiCard isDark={isDark} title="Fallidas" value={stats.totalFailed} icon={<AlertTriangle className="w-4 h-4 text-red-400" />} color="bg-red-500/20" />
        <KpiCard isDark={isDark} title="Tasa de consumo SLA" value={`${stats.onTimeRate.toFixed(1)}%`} icon={<Warehouse className="w-4 h-4 text-purple-400" />} color="bg-purple-500/20" />
      </div>

      {/* Gráficos y registro */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <StatsCharts />
        </div>
        <EventLog events={events} />
      </div>
    </div>
  );
}