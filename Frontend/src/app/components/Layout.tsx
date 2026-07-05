import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { Badge } from "./ui/badge";
import {
  LayoutDashboard, Package, Plane, Warehouse, Activity,
  Menu, ChevronsLeft, ChevronsRight, Globe, Building2,
  Sun, Moon, Briefcase, CalendarDays, LogOut, Users, Radio
} from "lucide-react";
import { Toaster } from "sonner";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/simulacion", label: "Escenarios", icon: Activity },
  { to: "/vuelos", label: "Vuelos", icon: Plane },
  { to: "/aeropuertos", label: "Aeropuertos", icon: Warehouse },
  { to: "/aerolineas", label: "Aerolíneas", icon: Building2 },
  { to: "/operarios", label: "Operarios", icon: Users },
];

function formatTimestampFull(ts: number): string {
  if (!ts || isNaN(ts)) return "";
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function formatDurationDHM(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatHM(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

function formatSimDate(ts: number): string {
  if (!ts || isNaN(ts)) {
    // Show today if no sim running
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
}

function formatTimestampPeruTime(ts: number): string {
  if (!ts || isNaN(ts)) return "";
  const d = new Date(ts);
  // Perú UTC-5: restar 5 horas a la hora actual
  const peruTime = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return `${String(peruTime.getUTCDate()).padStart(2, "0")}/${String(peruTime.getUTCMonth() + 1).padStart(2, "0")}/${peruTime.getUTCFullYear()} ${String(peruTime.getUTCHours()).padStart(2, "0")}:${String(peruTime.getUTCMinutes()).padStart(2, "0")}`;
}

// Synchronous migration: clean stale localStorage before any React renders
try {
  const _saved = localStorage.getItem("suitchase_airports");
  if (_saved) {
    const _parsed = JSON.parse(_saved);
    if (Array.isArray(_parsed) && _parsed.length > 0 && !_parsed[0].timezone) {
      localStorage.removeItem("suitchase_airports");
    }
  }
} catch {
  localStorage.removeItem("suitchase_airports");
}

try {
  const _savedAl = localStorage.getItem("suitchase_airlines");
  if (_savedAl) {
    const _parsedAl = JSON.parse(_savedAl);
    if (Array.isArray(_parsedAl) && _parsedAl.length > 0 && !_parsedAl[0].email) {
      localStorage.removeItem("suitchase_airlines");
    }
  }
} catch {
  localStorage.removeItem("suitchase_airlines");
}

export function Layout() {
  return <LayoutInner />;
}

function LayoutInner() {
  const { state, setPendingStartDate, pendingStartDate } = useSim();
  const { isDark, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isDashboardPage = location.pathname === "/";
  const isSimPage = location.pathname === "/simulacion";
  const [showSimDatePicker, setShowSimDatePicker] = useState(false);
  const [realTimeElapsed, setRealTimeElapsed] = useState(0);
  const [showTopPanel, setShowTopPanel] = useState(false);
  const isHeaderExpanded = (!isSimPage && !isDashboardPage) || showTopPanel;
  // Default picker to today at 00:00
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T00:00`; })();
  const [pickerValue, setPickerValue] = useState(todayIso);

  // Role check — only admin can access admin layout
  const role = localStorage.getItem("suitchase_role");
  const isAdmin = role === "ADMIN";

  // Guard: Redirect non-admins to their respective pages
  React.useEffect(() => {
    if (!isAdmin) {
      if (role === "OPERARIO") {
        navigate("/operario", { replace: true });
      } else if (role === "AEROLINEA") {
        navigate("/aerolinea", { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [isAdmin, role, navigate]);

  // Real clock for dashboard page
  const [now, setNow] = useState(new Date());
  React.useEffect(() => {
    if (!isDashboardPage && !(isSimPage && state.scenario === "tracking")) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [isDashboardPage, isSimPage, state.scenario]);
  const dateStr = now.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // Update real time elapsed every second when simulation is running
  React.useEffect(() => {
    if (!state.hasStarted || !state.running || state.scenario === "tracking") return;
    const interval = setInterval(() => {
      setRealTimeElapsed((prev: number) => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [state.hasStarted, state.running, state.scenario]);

  // When sim starts, sync picker to current sim time
  React.useEffect(() => {
    if (state.hasStarted && state.currentTime) {
      const d = new Date(state.currentTime);
      setPickerValue(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}T${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`);
    }
  }, [state.hasStarted, state.currentTime]);

  const handleDateSeek = () => {
    if (!pickerValue) return;
    const parts = pickerValue.split(/[^0-9]/);
    if (parts.length >= 5) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const hour = parseInt(parts[3], 10);
      const min = parseInt(parts[4], 10);
      const target = new Date(Date.UTC(year, month, day, hour, min, 0));
      setPendingStartDate(target);
    }
    setShowSimDatePicker(false);
  };

  return (
    <div className={`flex h-screen text-[#e2e8f0] overflow-hidden transition-colors duration-200 ${isDark ? "bg-[#0a0f1e]" : "bg-[#f0f4f8]"}`}>
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 border-r flex flex-col
        transform transition-all duration-200
        lg:translate-x-0 lg:static
        ${collapsed ? "w-14" : "w-56"}
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1]"}
      `}>
        <div className={`p-3 border-b flex items-center gap-2 min-h-[48px] ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}`}>
          <Briefcase className="w-6 h-6 text-blue-500 shrink-0" />
          {!collapsed && (
            <div>
              <div className={`text-[18px] font-bold ${isDark ? "text-white" : "text-[#0f172a]"}`}>SUITChASE</div>
              <div className={`text-[10px] ${isDark ? "text-[#94a3b8]" : "text-[#64748b]"}`}>Gestión de Equipaje</div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {NAV.filter(n => isAdmin || n.to !== "/simulacion").map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? n.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                  collapsed ? "justify-center px-0" : ""
                } ${
                  isActive
                    ? "bg-blue-600/20 text-blue-400"
                    : isDark
                      ? "text-white/80 hover:bg-[#1e293b] hover:text-white"
                      : "text-[#334155] hover:bg-[#d1dce8] hover:text-[#0f172a]"
                }`
              }
            >
              <n.icon className="w-4 h-4 shrink-0" />
              {!collapsed && n.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => setCollapsed(c => !c)}
            className={`hidden lg:flex w-full items-center justify-center py-3 border-t transition-colors ${isDark ? "border-[#1e293b] text-[#94a3b8] hover:text-white" : "border-[#cbd5e1] text-[#64748b] hover:text-[#0f172a]"}`}
          >
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className={`flex items-center shrink-0 transition-all duration-300 relative ${
          isHeaderExpanded
            ? `h-12 border-b px-4 gap-3 ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1]"}`
            : "h-0 border-b-0 px-0 overflow-visible bg-transparent border-transparent"
        }`}>
          {isHeaderExpanded && (
            <button className={`lg:hidden ${isDark ? "text-white" : "text-[#0f172a]"}`} onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
          )}
          {isHeaderExpanded && (
            <div className="flex items-center gap-3">
              {isDashboardPage || (isSimPage && state.scenario === "tracking") ? (
                <>
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 animate-pulse ${isDark ? "bg-cyan-500" : "bg-blue-600"}`} />
                  <span className={`text-[14px] ${isDark ? "text-white" : "text-[#0f172a]"}`}>En Vivo</span>
                  <span className={`text-[14px] ${isDark ? "text-[#cbd5e1]" : "text-[#334155]"}`}>{dateStr} • {timeStr}</span>
                </>
              ) : isSimPage ? (
                <>
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${state.running ? "bg-green-500 animate-pulse" : state.collapsed ? "bg-red-500" : "bg-[#94a3b8]"}`} />
                  <span className={`text-[14px] ${isDark ? "text-white" : "text-[#0f172a]"}`}>
                    {state.running ? "Simulando" : state.collapsed ? "Colapsado" : "Detenido"}
                  </span>
                  <span className={`font-semibold text-[12px] ${isDark ? "text-cyan-400" : "text-blue-700"}`}>Fecha y hora simulada:</span>
                  <div className="relative">
                    
                    <button
                      onClick={() => setShowSimDatePicker(!showSimDatePicker)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[13px] border transition-colors ${
                        isDark ? "bg-[#1e293b] border-[#334155] text-cyan-400 hover:border-cyan-500/40" : "bg-white border-[#cbd5e1] text-[#0f172a] hover:border-blue-700"
                      }`}
                    >
                      <CalendarDays className={`w-3.5 h-3.5 ${!isDark ? "text-blue-700" : ""}`} />
                      {formatSimDate(state.hasStarted ? state.currentTime : (pendingStartDate ? pendingStartDate.getTime() : 0))}
                    </button>
                    {showSimDatePicker && (
                      <div className={`absolute top-full left-0 mt-1 border rounded-lg p-3 z-50 min-w-[240px] ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]"}`}>
                        <label className={`text-[11px] block mb-1.5 ${isDark ? "text-white/70" : "text-[#475569]"}`}>Ir a fecha y hora</label>
                        <input
                          type="datetime-local"
                          value={pickerValue}
                          onChange={e => setPickerValue(e.target.value)}
                          className={`w-full text-[12px] rounded-lg px-2 py-1.5 mb-2 border ${isDark ? "bg-[#1e293b] border-[#334155] text-white [color-scheme:dark]" : "bg-[#f0f4f8] border-[#cbd5e1] text-[#0f172a] [color-scheme:light]"}`}
                        />
                        <button
                          onClick={handleDateSeek}
                          className={`w-full text-[11px] py-1.5 rounded-lg border transition-colors ${
                            isDark ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-600/10 border-blue-600/20 text-blue-700 hover:bg-blue-600/20"
                          }`}
                        >
                          OK
                        </button>
                      </div>
                    )}
                  </div>
                  {state.scenario === "weekly" && (
                    <div className="flex items-center gap-4 ml-6 text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-blue-700"}`}>Tiempo transcurrido (simulado):</span>
                        <span className={isDark ? "text-white/80" : "text-[#334155]"}>{formatDurationDHM(state.currentTime - state.startTime)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-blue-700"}`}>Fecha y hora real:</span>
                        <span className={isDark ? "text-white/80" : "text-[#334155]"}>{formatTimestampPeruTime(Date.now())} </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                         <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-blue-700"}`}>Tiempo transcurrido (real):</span>
                         <span className={isDark ? "text-white/80" : "text-[#334155]"}>{formatHM(realTimeElapsed)}</span>
                       </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
          <div className="flex-1" />
          {isHeaderExpanded && (
            <>
              {isSimPage && state.scenario !== "tracking" && (
              <div className="flex items-center gap-2">
                <Badge className={`text-[10px] ${state.running ? "bg-blue-600/20 text-blue-400" : isDark ? "bg-[#1e293b] text-white/60" : "bg-[#dde6f0] text-[#475569]"}`}>
                  {state.scenario === "weekly" ? "5 días" : state.scenario === "daily" ? "Diario" : "Colapso"}
                </Badge>
                <span className={`text-[11px] ${isDark ? "text-white/80" : "text-[#334155]"}`}>
                  {state.stats.totalRegistered} envíos | {state.stats.onTimeRate.toFixed(0)}% consumo SLA
                </span>

                {/* Theme toggle button */}
                <button
                  onClick={toggleTheme}
                  title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                  className={`
                    ml-2 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200
                    ${isDark
                      ? "bg-[#1e293b] border border-[#334155] text-amber-400 hover:bg-[#334155] hover:border-amber-400/40"
                      : "bg-[#dde6f0] border border-[#b8ccd8] text-blue-600 hover:bg-[#c8d8e8] hover:border-blue-400"
                    }
                  `}
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => navigate("/login")}
                  title="Cerrar sesión"
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200
                    ${isDark
                      ? "bg-[#1e293b] border border-[#334155] text-red-400 hover:bg-[#334155] hover:border-red-400/40"
                      : "bg-[#dde6f0] border border-[#b8ccd8] text-red-500 hover:bg-[#c8d8e8] hover:border-red-400"
                    }
                  `}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
              )}
              {(!isSimPage || state.scenario === "tracking") && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleTheme}
                    title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                    className={`
                      w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200
                      ${isDark
                        ? "bg-[#1e293b] border border-[#334155] text-amber-400 hover:bg-[#334155] hover:border-amber-400/40"
                        : "bg-[#dde6f0] border border-[#b8ccd8] text-blue-600 hover:bg-[#c8d8e8] hover:border-blue-400"
                      }
                    `}
                  >
                    {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => navigate("/login")}
                    title="Cerrar sesión"
                    className={`
                      w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200
                      ${isDark
                        ? "bg-[#1e293b] border border-[#334155] text-red-400 hover:bg-[#334155] hover:border-red-400/40"
                        : "bg-[#dde6f0] border border-[#b8ccd8] text-red-500 hover:bg-[#c8d8e8] hover:border-red-400"
                      }
                    `}
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
          {(isSimPage || isDashboardPage) && (
            <button
              onClick={() => setShowTopPanel(!showTopPanel)}
              className={`border rounded-lg text-[10px] transition-all duration-300 ${
                showTopPanel
                  ? `px-2 py-1 ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`
                  : `absolute top-3 right-4 z-50 px-3 py-1.5 shadow-lg ${isDark ? "bg-[#0f172a] border-[#1e293b] text-cyan-400 hover:bg-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1] text-blue-700 hover:bg-[#cbd5e1]"}`
              }`}
            >
              {showTopPanel ? "Ocultar" : "Tiempos"}
            </button>
          )}
        </header>

        <main className={`flex-1 overflow-auto p-4 ${isDark ? "" : "bg-[#f0f4f8]"}`}>
          <Outlet context={{ showTopPanel }} />
        </main>
      </div>
      <Toaster position="bottom-right" theme={isDark ? "dark" : "light"} />
    </div>
  );
}