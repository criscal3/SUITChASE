import React, { useState, useEffect, useMemo } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { api } from "../services/api";
import { useTheme } from "../context/ThemeContext";
import { Loader2, RefreshCw } from "lucide-react";

interface Airport {
  oaci: string;
  ciudad: string;
  pais: string;
  continente: string;
  gmt: number;
  capacidadAlmacen: number;
  latitud: number;
  longitud: number;
}

interface HoveredAirport {
  oaci: string;
  ciudad: string;
  pais: string;
  continente: string;
  capacidad: number;
  gmt: number;
  x: number;
  y: number;
}

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

function getContinentColor(continent: string): string {
  const norm = continent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (norm.includes("america")) return "#3b82f6"; // Blue
  if (norm.includes("europa")) return "#8b5cf6"; // Purple
  if (norm.includes("asia")) return "#f59e0b"; // Orange
  if (norm.includes("africa")) return "#10b981"; // Green
  if (norm.includes("oceania")) return "#ec4899"; // Pink
  return "#0ea5e9"; // Cyan fallback
}

export function AirportMap() {
  const { isDark } = useTheme();
  const [airports, setAirports] = useState<Airport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ coordinates: [0, 20] as [number, number], zoom: 1 });
  const [hovered, setHovered] = useState<HoveredAirport | null>(null);

  const fetchAirports = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAirports();
      setAirports(data || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar los aeropuertos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAirports();
  }, []);

  const s = 1 / position.zoom;

  // Theme styling configurations
  const mapBg = isDark ? "#0f172a" : "#cbd5e1";
  const geoFill = isDark ? "#1e293b" : "#e2e8f0";
  const geoStroke = isDark ? "#334155" : "#94a3b8";
  const geoHover = isDark ? "#38bdf8" : "#60a5fa";
  const tooltipBg = isDark ? "bg-[#1e293b] border-[#334155] text-white" : "bg-white border-[#cbd5e1] text-[#0f172a]";
  const labelFill = isDark ? "#cbd5e1" : "#1e293b";

  if (loading) {
    return (
      <div className={`w-full h-[450px] rounded-xl flex items-center justify-center border transition-all ${isDark ? "bg-[#0f172a]/50 border-[#1e293b]" : "bg-white border-[#cbd5e1]"}`}>
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-[13px] opacity-75">Cargando mapa de aeropuertos...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`w-full h-[450px] rounded-xl flex items-center justify-center border transition-all ${isDark ? "bg-[#0f172a]/50 border-[#1e293b]" : "bg-white border-[#cbd5e1]"}`}>
        <div className="flex flex-col items-center gap-3">
          <span className="text-[13px] text-red-500 font-medium">{error}</span>
          <button
            onClick={fetchAirports}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-[450px] rounded-xl border overflow-hidden relative transition-all ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]"}`}>
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
        <h3 className={`text-[14px] font-semibold ${isDark ? "text-white" : "text-[#0f172a]"}`}>Mapa de Aeropuertos</h3>
        <p className="text-[11px] opacity-75">Total de aeropuertos registrados: {airports.length}</p>
      </div>

      <button
        onClick={fetchAirports}
        className={`absolute top-3 right-3 z-10 p-2 rounded-lg border transition-all ${
          isDark
            ? "bg-[#1e293b] border-[#334155] hover:bg-[#334155] text-white"
            : "bg-white border-[#cbd5e1] hover:bg-[#f1f5f9] text-[#0f172a]"
        }`}
        title="Actualizar aeropuertos"
      >
        <RefreshCw className="w-4 h-4" />
      </button>

      <div className="w-full h-full" style={{ background: isDark ? "#090d16" : "#f1f5f9" }}>
        <ComposableMap projection="geoMercator" projectionConfig={{ scale: 120 }}>
          <ZoomableGroup
            zoom={position.zoom}
            center={position.coordinates}
            onMoveEnd={(pos) => setPosition(pos)}
            maxZoom={10}
          >
            <Geographies geography={geoUrl}>
              {({ geographies }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={geoFill}
                    stroke={geoStroke}
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", fill: geoHover, opacity: 0.8 },
                      pressed: { outline: "none" },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Render markers for each airport */}
            {airports.map((airport) => {
              const continentColor = getContinentColor(airport.continente);
              const lat = airport.latitud;
              const lng = airport.longitud;

              if (lat == null || lng == null) return null;

              return (
                <Marker key={airport.oaci} coordinates={[lng, lat]}>
                  <g
                    style={{ cursor: "pointer" }}
                    transform={`scale(${s})`}
                    onClick={() => setPosition({ coordinates: [lng, lat], zoom: 3 })}
                    onMouseEnter={(e) => {
                      setHovered({
                        oaci: airport.oaci,
                        ciudad: airport.ciudad,
                        pais: airport.pais,
                        continente: airport.continente,
                        capacidad: airport.capacidadAlmacen,
                        gmt: airport.gmt,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {/* Ring animation / Outer aura */}
                    <circle cx={0} cy={0} r={8} fill={continentColor} opacity={0.3} className="animate-pulse" />
                    {/* Inner core */}
                    <circle cx={0} cy={0} r={4.5} fill={continentColor} stroke="#ffffff" strokeWidth={1} />
                    
                    {/* Code tag */}
                    <text
                      textAnchor="middle"
                      y={-9}
                      style={{
                        fill: labelFill,
                        fontSize: "8px",
                        fontWeight: "bold",
                        pointerEvents: "none",
                        textShadow: isDark ? "0px 0px 3px #000" : "0px 0px 3px #fff"
                      }}
                    >
                      {airport.oaci}
                    </text>
                  </g>
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>

      {/* Tooltip */}
      {hovered && (
        <div
          className={`fixed z-50 border rounded-lg p-2.5 shadow-xl pointer-events-none text-[11px] ${tooltipBg}`}
          style={{ left: hovered.x + 12, top: hovered.y - 10 }}
        >
          <div className="font-bold border-b pb-1 mb-1 border-current/10">
            {hovered.ciudad} ({hovered.oaci})
          </div>
          <div><strong>País:</strong> {hovered.pais}</div>
          <div><strong>Continente:</strong> {hovered.continente}</div>
          <div><strong>Capacidad:</strong> {hovered.capacidad} maletas</div>
          <div><strong>GMT:</strong> {hovered.gmt >= 0 ? `+${hovered.gmt}` : hovered.gmt}</div>
        </div>
      )}
    </div>
  );
}
