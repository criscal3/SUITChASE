import React, { createContext, useContext, useState, useEffect } from "react";
import { useTheme } from "./ThemeContext";

interface MapSettings {
  customOceanColor: string | null;
  customActiveCountryColor: string | null;
  showCountryNames: boolean;
  customIntraColor: string | null;
  customInterColor: string | null;
}

interface MapSettingsContextValue {
  settings: MapSettings;
  updateSetting: <K extends keyof MapSettings>(key: K, value: MapSettings[K]) => void;
  resetToDefaults: () => void;
  // Helpers to get the final color (custom or default based on theme)
  getOceanColor: () => string;
  getActiveCountryColor: () => string;
  getIntraColor: () => string;
  getInterColor: () => string;
  // Country translations
  translateCountry: (englishName: string) => string;
}

const defaultSettings: MapSettings = {
  customOceanColor: null,
  customActiveCountryColor: null,
  showCountryNames: false,
  customIntraColor: null,
  customInterColor: null,
};

const MapSettingsContext = createContext<MapSettingsContextValue | undefined>(undefined);

const countryTranslations: Record<string, string> = {
  "Peru": "Perú",
  "Brazil": "Brasil",
  "United States": "Estados Unidos",
  "United States of America": "Estados Unidos",
  "Mexico": "México",
  "Spain": "España",
  "France": "Francia",
  "Germany": "Alemania",
  "Italy": "Italia",
  "United Kingdom": "Reino Unido",
  "Japan": "Japón",
  "China": "China",
  "India": "India",
  "Australia": "Australia",
  "Canada": "Canadá",
  "Argentina": "Argentina",
  "Chile": "Chile",
  "Colombia": "Colombia",
  "South Africa": "Sudáfrica",
  "Egypt": "Egipto",
  "Russia": "Rusia",
};

export function MapSettingsProvider({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();
  const [settings, setSettings] = useState<MapSettings>(() => {
    try {
      const saved = localStorage.getItem("suit-map-settings");
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem("suit-map-settings", JSON.stringify(settings));
  }, [settings]);

  const updateSetting = <K extends keyof MapSettings>(key: K, value: MapSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const resetToDefaults = () => {
    setSettings(defaultSettings);
  };

  const getOceanColor = () => {
    if (settings.customOceanColor) return settings.customOceanColor;
    return isDark ? "#060a15" : "#c8d8e8";
  };

  const getActiveCountryColor = () => {
    if (settings.customActiveCountryColor) return settings.customActiveCountryColor;
    return isDark ? "#0c1a30" : "#b0c4d8"; // Default same as geoFill
  };

  const getIntraColor = () => {
    if (settings.customIntraColor) return settings.customIntraColor;
    return isDark ? "#22d3ee" : "#0891b2";
  };

  const getInterColor = () => {
    if (settings.customInterColor) return settings.customInterColor;
    return isDark ? "#c4a886" : "#a8906a";
  };

  const translateCountry = (englishName: string) => {
    return countryTranslations[englishName] || englishName;
  };

  return (
    <MapSettingsContext.Provider
      value={{
        settings,
        updateSetting,
        resetToDefaults,
        getOceanColor,
        getActiveCountryColor,
        getIntraColor,
        getInterColor,
        translateCountry,
      }}
    >
      {children}
    </MapSettingsContext.Provider>
  );
}

export function useMapSettings() {
  const context = useContext(MapSettingsContext);
  if (!context) {
    throw new Error("useMapSettings must be used within a MapSettingsProvider");
  }
  return context;
}
