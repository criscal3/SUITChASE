import React from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from "recharts";

export function StatsCharts() {
  const { state } = useSim();
  const { isDark } = useTheme();

  const deliveryData = state.stats.deliveredHistory.filter((_, i) => i % 5 === 0).slice(-60).map((d, idx) => ({
    time: `D${Math.floor(d.time / 24 + 1)}`,
    entregadas: d.count,
    _key: idx,
  }));

  // Build continent data from state.airports (actual simulation data)
  const airportsList = Object.values(state.airports) as any[];
  const continentMap = new Map<string, { stock: number; capacity: number }>();
  
  for (const airport of airportsList) {
    // We need to determine the continent based on the airport code and stored data
    // For now, we'll use a mapping of codes to continents
    const continentByCode: Record<string, "America" | "Europa" | "Asia"> = {
      "GRU": "America", "EZE": "America", "BOG": "America", "MEX": "America", "MIA": "America",
      "JFK": "America", "LAX": "America", "LIM": "America", "SCL": "America", "YYZ": "America",
      "MAD": "Europa", "CDG": "Europa", "FRA": "Europa", "FCO": "Europa", "LHR": "Europa",
      "AMS": "Europa", "NRT": "Asia", "PEK": "Asia", "ICN": "Asia", "SIN": "Asia",
      "BKK": "Asia", "DEL": "Asia", "DXB": "Asia"
    };
    
    const continent = continentByCode[airport.code] || "America";
    const current = continentMap.get(continent) || { stock: 0, capacity: 0 };
    continentMap.set(continent, {
      stock: current.stock + airport.currentStock,
      capacity: current.capacity + airport.capacity
    });
  }
  
  const continentData = (["America", "Europa", "Asia"] as const).map(cont => {
    const data = continentMap.get(cont) || { stock: 0, capacity: 0 };
    return { name: cont, utilización: data.capacity > 0 ? Math.round((data.stock / data.capacity) * 100) : 0 };
  });

  const topAirports = (Object.values(state.airports) as any[])
    .sort((a, b) => b.currentStock - a.currentStock)
    .slice(0, 8)
    .map(a => ({ code: a.code, maletas: a.currentStock, capacidad: a.capacity }));

  const COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#22c55e"];

  const cardCls = isDark ? "bg-[#1e293b]/50 border-[#334155]" : "bg-white border-[#cbd5e1]";
  const titleCls = isDark ? "text-white" : "text-[#0f172a]";
  const gridStroke = isDark ? "#334155" : "#c8d0d8";
  const axisStroke = isDark ? "#64748b" : "#6b7280";
  const tooltipStyle = isDark
    ? { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12, color: "#f1f5f9" }
    : { background: "#f3f4f6", border: "1px solid #c8d0d8", borderRadius: 8, fontSize: 12, color: "#111827" };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className={cardCls}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-[14px] ${titleCls}`}>Entregas Acumuladas</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={deliveryData}>
              <CartesianGrid stroke={gridStroke} />
              <XAxis dataKey="time" stroke={axisStroke} tick={{ fontSize: 10, fill: axisStroke }} allowDuplicatedCategory={true} />
              <YAxis stroke={axisStroke} tick={{ fontSize: 10, fill: axisStroke }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="entregadas" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className={cardCls}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-[14px] ${titleCls}`}>Almacén por Continente</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={continentData}>
              <CartesianGrid stroke={gridStroke} />
              <XAxis dataKey="name" stroke={axisStroke} tick={{ fontSize: 10, fill: axisStroke }} />
              <YAxis stroke={axisStroke} tick={{ fontSize: 10, fill: axisStroke }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="utilización" radius={[4, 4, 0, 0]}>
                {continentData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className={`${cardCls} md:col-span-2`}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-[14px] ${titleCls}`}>Top Aeropuertos por Carga</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topAirports} layout="vertical">
              <CartesianGrid stroke={gridStroke} />
              <XAxis type="number" stroke={axisStroke} tick={{ fontSize: 10, fill: axisStroke }} />
              <YAxis dataKey="code" type="category" stroke={axisStroke} width={40} tick={{ fontSize: 10, fill: axisStroke }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="maletas" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="capacidad" fill={isDark ? "#334155" : "#a0aec0"} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}