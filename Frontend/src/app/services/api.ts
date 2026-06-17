const API_BASE_URL = "/api";

interface RequestOptions extends RequestInit {
  auth?: boolean;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, ...init } = options;
  
  const headers = new Headers(init.headers);
  if (auth) {
    const token = localStorage.getItem("suitchase_token");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  if (init.body && typeof init.body === "object" && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(init.body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem("suitchase_token");
    localStorage.removeItem("suitchase_role");
    window.location.href = "/login";
    throw new Error("Sesión expirada");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ mensaje: "Error desconocido" }));
    throw new Error(error.mensaje || error.error || "Error en la petición");
  }

  if (response.status === 204) return {} as T;
  return response.json();
}

export const api = {
  login: async (username, password) => {
    const res = await request<any>("/auth/login", {
      method: "POST",
      auth: false,
      body: { correo: username, password },
    });
    
    // Support both 'role' and 'rol' in case backend hasn't been restarted
    const userRole = res.role || res.rol;
    res.role = userRole; // Normalize to 'role' for the rest of the frontend
    
    localStorage.setItem("suitchase_token", res.token);
    localStorage.setItem("suitchase_role", userRole);
    if (res.aerolineaId) localStorage.setItem("suitchase_aerolinea_id", res.aerolineaId.toString());
    return res;
  },

  getAirports: () => request<any[]>("/aeropuertos"),
  createAirport: (data) => request("/aeropuertos", { method: "POST", body: data }),
  updateAirport: (oaci, data) => request(`/aeropuertos/${oaci}`, { method: "PUT", body: data }),
  deleteAirport: (oaci) => request(`/aeropuertos/${oaci}`, { method: "DELETE" }),

  getAirlines: () => request<any[]>("/aerolineas"),
  createAirline: (data: { nombre: string; codigo: string; correo: string; password: string }) =>
    request("/aerolineas", { method: "POST", body: data }),
  updateAirline: (id: number, data: { nombre: string }) =>
    request(`/aerolineas/${id}`, { method: "PUT", body: data }),
  deleteAirline: (id: number) =>
    request(`/aerolineas/${id}`, { method: "DELETE" }),

  getFlights: () => request<any[]>("/vuelos"),
  getPedidosAfectadosHoy: (vueloId: string | number) =>
    request<any[]>(`/vuelos/${vueloId}/pedidos-afectados-hoy`),
  cancelarVueloHoy: (vueloId: string | number) =>
    request<{ vueloId: number; pedidosAfectados: number; mensaje: string }>(
      `/vuelos/${vueloId}/cancelar-hoy`, { method: "POST" }
    ),
  getCancelacionesActivas: () => request<number[]>("/vuelos/cancelaciones-activas"),
  
  getEnvios: () => request<any[]>("/envios/mis-envios"),
  registrarEnvio: (data) => request("/envios", { method: "POST", body: data }),
  getRutaEnvio: (id) => request(`/envios/${id}/ruta`),

  getSimulaciones: () => request<any[]>("/simulacion"),
  iniciarSimulacion: (data) => request("/simulacion/iniciar", { method: "POST", body: data }),
  pausarSimulacion: (id) => request(`/simulacion/${id}/pausar`, { method: "POST" }),
  reanudarSimulacion: (id) => request(`/simulacion/${id}/reanudar`, { method: "POST" }),
  cancelarSimulacion: (id) => request(`/simulacion/${id}/cancelar`, { method: "POST" }),
  actualizarK: (id, k) => request(`/simulacion/${id}/k`, { method: "PUT", body: { k } }),
  getRutasBloque: (simId, bloqueId) => request<any[]>(`/simulacion/${simId}/bloques/${bloqueId}/rutas`),

  // Operarios
  getOperarios: () => request<any[]>("/usuarios/operarios"),
  createOperario: (data) => request("/usuarios", { method: "POST", body: { ...data, rol: "OPERARIO" } }),
  updateOperario: (id, data) => request(`/usuarios/${id}`, { method: "PUT", body: data }),
  deleteOperario: (id) => request(`/usuarios/${id}`, { method: "DELETE" }),

  // === TIEMPO REAL ===
  getResumenRT: () => request<any>("/tiempo-real/resumen"),
  getOperacionesRT: (params?: { estado?: string; aerolineaId?: number }) =>
      request<any[]>("/tiempo-real/operaciones" + (params
          ? "?" + new URLSearchParams(Object.entries(params).filter(([,v]) => v != null) as any).toString()
          : "")),
  getMisPedidosRT: () => request<any[]>("/tiempo-real/mis-pedidos"),
  getDetallePedidoRT: (id: string) => request<any>(`/tiempo-real/pedido/${id}`),
  registrarPedidoRT: (data: any) => request("/tiempo-real/pedidos", { method: "POST", body: data }),
};
