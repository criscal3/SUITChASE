import React from "react";
import { createBrowserRouter, Outlet } from "react-router";
import { ThemeProvider } from "./context/ThemeContext";
import { SimProvider } from "./context/SimContext";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { Registration } from "./components/Registration";
import { FlightsPanel } from "./components/FlightsPanel";
import { AirportsPanel } from "./components/AirportsPanel";
import { SimulationPage } from "./components/SimulationPage";
import { AirlinesPanel } from "./components/AirlinesPanel";
import { OperatorLayout } from "./components/OperatorLayout";
import { AirlineLayout } from "./components/AirlineLayout";
import { AirlineTracking } from "./components/AirlineTracking";
import { LoginPage } from "./components/LoginPage";
import { OperariosPanel } from "./components/OperariosPanel";
import { AirportMap } from "./components/AirportMap";

function OperatorRegistration() {
  return <Registration showBatchImport={false} />;
}

function ErrorFallback() {
  const handleReset = () => {
    try {
      localStorage.removeItem("suitchase_sim_state");
      localStorage.removeItem("suitchase_sim_events");
    } catch {}
    window.location.href = "/";
  };
  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "#0a0f1e", color: "#e2e8f0", flexDirection: "column", gap: "1rem" }}>
      <h1 style={{ fontSize: "1.25rem" }}>Ocurrió un error inesperado</h1>
      <p style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Los datos de simulación pueden estar corruptos.</p>
      <button onClick={handleReset} style={{ padding: "0.5rem 1.5rem", background: "#0ea5e9", color: "white", border: "none", borderRadius: "0.5rem", cursor: "pointer" }}>
        Reiniciar Aplicación
      </button>
    </div>
  );
}

function Root() {
  return (
    <ThemeProvider>
      <SimProvider>
        <div className="h-screen w-screen overflow-hidden">
          <Outlet />
        </div>
      </SimProvider>
    </ThemeProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    ErrorBoundary: ErrorFallback,
    children: [
      {
        path: "/login",
        Component: LoginPage,
      },
      {
        path: "/",
        Component: Layout,
        children: [
          { index: true, Component: Dashboard },
          { path: "registro", Component: Registration },
          { path: "vuelos", Component: FlightsPanel },
          { path: "aeropuertos", Component: AirportsPanel },
          { path: "simulacion", Component: SimulationPage },
          { path: "aerolineas", Component: AirlinesPanel },
          { path: "operarios", Component: OperariosPanel },
        ],
      },
      {
        path: "/operario",
        Component: OperatorLayout,
        children: [
          { index: true, Component: OperatorRegistration },
          { path: "mapa", Component: AirportMap },
        ],
      },
      {
        path: "/aerolinea",
        Component: AirlineLayout,
        children: [
          { index: true, Component: AirlineTracking },
          { path: "mapa", Component: AirportMap },
        ],
      },
    ]
  }
]);