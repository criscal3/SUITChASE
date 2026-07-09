import React, { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router";
import { useTheme } from "../context/ThemeContext";
import { Briefcase, Radar, Sun, Moon, LogOut, ChevronsLeft, ChevronsRight } from "lucide-react";

function useCurrentTime() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function AirlineLayoutInner() {
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const now = useCurrentTime();
  const [collapsed, setCollapsed] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const dateStr = now.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

  return (
    <div className={`flex h-screen overflow-hidden transition-colors duration-200 ${isDark ? "bg-[#0a0f1e] text-[#e2e8f0]" : "bg-[#f0f4f8] text-[#1e293b]"}`}>
      {/* Sidebar */}
      <aside className={`
        border-r flex flex-col shrink-0 transition-all duration-200
        ${collapsed ? "w-14" : "w-56"}
        ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1]"}
      `}>
        <div className={`p-3 border-b flex items-center gap-2 min-h-[48px] ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}`}>
          <Briefcase className="w-6 h-6 text-blue-500 shrink-0" />
          {!collapsed && (
            <div>
              <div className={`text-[18px] font-bold ${isDark ? "text-white" : "text-[#0f172a]"}`}>SUITChASE</div>
              <div className={`text-[10px] ${isDark ? "text-[#94a3b8]" : "text-[#64748b]"}`}>Panel Aerolínea</div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <NavLink
            to="/aerolinea"
            end
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
            title={collapsed ? "Tracking" : undefined}
          >
            <Radar className="w-4 h-4 shrink-0" />
            {!collapsed && "Tracking"}
          </NavLink>
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => setCollapsed(c => !c)}
            className={`flex w-full items-center justify-center py-3 border-t transition-colors ${isDark ? "border-[#1e293b] text-[#94a3b8] hover:text-white" : "border-[#cbd5e1] text-[#64748b] hover:text-[#0f172a]"}`}
          >
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className={`flex items-center shrink-0 transition-all duration-300 relative ${
          headerExpanded
            ? `h-12 border-b px-4 gap-3 ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1]"}`
            : "h-0 border-b-0 px-0 overflow-visible bg-transparent border-transparent"
        }`}>
          {headerExpanded && (
            <>
              <span className={`text-[14px] ${isDark ? "text-white" : "text-[#0f172a]"}`}>Tracking de Equipaje</span>
              <span className={`text-[12px] ${isDark ? "text-[#94a3b8]" : "text-[#64748b]"}`}>{dateStr} • {timeStr}</span>
              <div className="ml-auto flex items-center gap-2">
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
            </>
          )}

          {/* Botón flotante para expandir/colapsar encabezado */}
          <button
            onClick={() => setHeaderExpanded(!headerExpanded)}
            className={`border rounded-lg text-[10px] transition-all duration-300 z-30 ${
              headerExpanded
                ? `ml-3 px-2 py-1 ${isDark ? "bg-[#0a0f1ecc] border-[#1a2744] text-white/70 hover:text-cyan-400" : "bg-white/80 border-[#cbd5e1] text-[#475569] hover:text-blue-700"}`
                : `absolute top-3 left-4 px-3 py-1.5 shadow-lg ${isDark ? "bg-[#0f172a] border-[#1e293b] text-cyan-400 hover:bg-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1] text-blue-700 hover:bg-[#cbd5e1]"}`
            }`}
          >
            {headerExpanded ? "Ocultar" : "Encabezado"}
          </button>
        </header>
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AirlineLayout() {
  return <AirlineLayoutInner />;
}