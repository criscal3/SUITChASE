import React, { useState, useRef, useEffect } from "react";
import { Settings, RefreshCw, X } from "lucide-react";
import { useMapSettings } from "../context/MapSettingsContext";
import { useTheme } from "../context/ThemeContext";

export function MapSettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { isDark } = useTheme();
  const {
    settings,
    updateSetting,
    resetToDefaults,
    getOceanColor,
    getActiveCountryColor,
    getIntraColor,
    getInterColor,
  } = useMapSettings();

  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const bgPanel = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const textCls = isDark ? "text-white" : "text-[#111827]";
  const subTextCls = isDark ? "text-white/70" : "text-[#4b5563]";
  const inputBg = isDark ? "bg-[#1e293b] border-transparent" : "bg-slate-100 border-[#cbd5e1]";

  return (
    <div className="absolute bottom-4 right-4 z-50 font-sans" ref={panelRef}>
      {/* Botón de Rueda (Toggle) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-full border shadow-md backdrop-blur-md transition-colors ${
          isDark
            ? "bg-[#0f172a]/80 border-[#1e293b] hover:bg-[#1e293b] text-white"
            : "bg-white/80 border-[#cbd5e1] hover:bg-slate-100 text-[#111827]"
        }`}
        title="Configuración del Mapa"
      >
        <Settings className="w-5 h-5" />
      </button>

      {/* Panel de Configuración */}
      {isOpen && (
        <div
          className={`absolute bottom-full right-0 mb-2 w-72 p-4 rounded-xl border shadow-xl ${bgPanel}`}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={`font-semibold ${textCls}`}>Configuración de Mapa</h3>
            <button onClick={() => setIsOpen(false)} className={`${subTextCls} hover:text-red-500 transition-colors`}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Color del Mar */}
            <div className="flex items-center justify-between">
              <label className={`text-[12px] font-medium ${subTextCls}`}>Color del Mar</label>
              <input
                type="color"
                value={getOceanColor()}
                onChange={(e) => updateSetting("customOceanColor", e.target.value)}
                className={`w-8 h-8 rounded cursor-pointer border ${inputBg}`}
              />
            </div>

            {/* Color de Países (con aeropuertos) */}
            <div className="flex items-center justify-between">
              <label className={`text-[12px] font-medium ${subTextCls}`}>Países (activos)</label>
              <input
                type="color"
                value={getActiveCountryColor()}
                onChange={(e) => updateSetting("customActiveCountryColor", e.target.value)}
                className={`w-8 h-8 rounded cursor-pointer border ${inputBg}`}
              />
            </div>

            {/* Nombres de países */}
            <div className="flex items-center justify-between">
              <label className={`text-[12px] font-medium ${subTextCls}`}>Mostrar Nombres (Español)</label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={settings.showCountryNames}
                  onChange={(e) => updateSetting("showCountryNames", e.target.checked)}
                />
                <div className={`w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all ${
                  isDark ? "bg-gray-700 peer-checked:bg-cyan-500" : "bg-gray-300 peer-checked:bg-blue-600"
                }`}></div>
              </label>
            </div>

            <hr className={`border-t ${isDark ? "border-[#1e293b]" : "border-[#cbd5e1]"}`} />

            {/* Tramos Continentales */}
            <div className="flex items-center justify-between">
              <label className={`text-[12px] font-medium ${subTextCls}`}>Vuelos Continentales</label>
              <input
                type="color"
                value={getIntraColor()}
                onChange={(e) => updateSetting("customIntraColor", e.target.value)}
                className={`w-8 h-8 rounded cursor-pointer border ${inputBg}`}
              />
            </div>

            {/* Tramos Intercontinentales */}
            <div className="flex items-center justify-between">
              <label className={`text-[12px] font-medium ${subTextCls}`}>Vuelos Intercontinentales</label>
              <input
                type="color"
                value={getInterColor()}
                onChange={(e) => updateSetting("customInterColor", e.target.value)}
                className={`w-8 h-8 rounded cursor-pointer border ${inputBg}`}
              />
            </div>

            {/* Reset */}
            <button
              onClick={resetToDefaults}
              className={`w-full mt-2 py-2 flex items-center justify-center gap-2 rounded-lg text-[12px] font-semibold transition-colors ${
                isDark
                  ? "bg-red-950/30 text-red-400 hover:bg-red-950/50 border border-red-900/50"
                  : "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Restablecer Valores
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
