import React from "react";
import { Outlet, NavLink } from "react-router";
import { useTheme } from "../context/ThemeContext";
import { Briefcase, Radar, Sun, Moon, Map } from "lucide-react";

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
  const now = useCurrentTime();
  const dateStr = now.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className={`flex h-screen overflow-hidden transition-colors duration-200 ${isDark ? "bg-[#0a0f1e] text-[#e2e8f0]" : "bg-[#f0f4f8] text-[#1e293b]"}`}>
      {/* Sidebar */}
      <aside className={`w-56 border-r flex flex-col shrink-0 ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1]"}`}>
        <div className={`p-3 border-b flex items-center gap-2 min-h-[48px] ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}`}>
          <Briefcase className="w-6 h-6 text-blue-500 shrink-0" />
          <div>
            <div className={`text-[18px] font-bold ${isDark ? "text-white" : "text-[#0f172a]"}`}>SUITChASE</div>
            <div className={`text-[10px] ${isDark ? "text-[#94a3b8]" : "text-[#64748b]"}`}>Panel Aerolínea</div>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <NavLink
            to="/aerolinea"
            end
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-blue-400"
                  : isDark
                    ? "text-white/80 hover:bg-[#1e293b] hover:text-white"
                    : "text-[#334155] hover:bg-[#d1dce8] hover:text-[#0f172a]"
              }`
            }
          >
            <Radar className="w-4 h-4 shrink-0" />
            Tracking
          </NavLink>

          <NavLink
            to="/aerolinea/mapa"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-blue-400"
                  : isDark
                    ? "text-white/80 hover:bg-[#1e293b] hover:text-white"
                    : "text-[#334155] hover:bg-[#d1dce8] hover:text-[#0f172a]"
              }`
            }
          >
            <Map className="w-4 h-4 shrink-0" />
            Mapa
          </NavLink>
        </nav>

        <div className={`p-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}`}>
          <button
            onClick={toggleTheme}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] transition-colors ${isDark ? "text-[#94a3b8] hover:text-white hover:bg-[#1e293b]" : "text-[#64748b] hover:text-[#0f172a] hover:bg-[#d1dce8]"}`}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {isDark ? "Modo claro" : "Modo oscuro"}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className={`h-12 border-b flex items-center px-4 shrink-0 ${isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-[#e8edf5] border-[#cbd5e1]"}`}>
          <span className={`text-[14px] ${isDark ? "text-white" : "text-[#0f172a]"}`}>Tracking de Equipaje</span>
          <span className={`text-[12px] ml-auto ${isDark ? "text-[#94a3b8]" : "text-[#64748b]"}`}>{dateStr} • {timeStr}</span>
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