export const SIM_BASE_DATE = new Date(2026, 0, 2, 0, 0, 0);

/** Duración del cronómetro de simulación semanal (5 días desde fecha inicial). */
export const SIM_WEEKLY_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

/** Duración de la simulación de colapso visual (1 día). */
export const SIM_COLLAPSE_DURATION_MS = 1 * 24 * 60 * 60 * 1000;

/** Días de calentamiento previos para la simulación de colapso (en backend). */
export const COLLAPSE_PRE_DAYS = 5;

/** Total de bloques de pre-calentamiento (5 días * 4 bloques/día + 1 bloque). Asumiendo Sc = 4h (6 bloques por día) -> 5*6 + 1 = 31 bloques. 
 * ¡Espera! El plan original menciona "25 bloques (24 bloques antes de la fecha + primer bloque luego de la fecha)". 
 * Si 1 bloque son 6 horas, entonces 1 día son 4 bloques. 5 días = 20 bloques. 24 bloques = 6 días.
 * El request del usuario decía: "La simulación hasta el colapso inicia 5 días antes de la fecha inicial... deben ser un total de 25 bloques (24 bloques antes de la fecha + primer bloque luego de la fecha)." 
 * OK, entonces 24 bloques = 24 * 6 = 144 horas = 6 días, o si Sc = 4h, entonces 24 * 4h = 96h = 4 días.
 * Asumiendo que 1 bloque son Sc horas. Use el config hardcoded o calculado. 
 * El prompt del user dice explícitamente: "total de 25 bloques (24 bloques antes de la fecha + primer bloque luego de la fecha)" y "inicia 5 días antes de la fecha inicial". 
 * Lo mejor es poner `COLLAPSE_PRE_BLOCKS = 25` constante como requirió.
 */
export const COLLAPSE_PRE_BLOCKS = 25;

export interface BaggageGroup {
  id: string;
  airline: string;
  origin: string;
  destination: string;
  quantity: number;
  registeredAt: number;
  deadlineAt: number;
  currentLocation: string;
  status: "waiting" | "in_transit" | "delivered" | "delayed" | "failed";
  route: RouteLeg[];
  currentLegIndex: number;
}

export interface RouteLeg {
  flightId: string;
  from: string;
  to: string;
  departureTime: number;
  arrivalTime: number;
  transitHours: number;
  claveVuelo?: string;
  maxCapacity?: number;
}

export interface SimulationState {
  currentTime: number;
  startTime: number;
  day: number;
  hour: number;
  baggageGroups: BaggageGroup[];
  airports: Record<string, AirportState>;
  flights: FlightState[];
  flightOccupancy: Record<string, number>;
  flightCapacities: Record<string, number>;
  cancelledFlights: Set<string>;
  stats: SimStats;
  collapsed: boolean;
  collapseReason: string;
  running: boolean;
  stopped?: boolean;
  hasStarted?: boolean;
  waitingForFirstBlock?: boolean;
  speed: number;
  scenario: "daily" | "weekly" | "collapse" | "tracking";
  turnaroundHours: number;
  fastForwardTarget?: number | null;
  fastForwardState?: "idle" | "running" | "reached";
  targetDateStr?: string;
  activeSimId?: number;
  // Track shipment collapse for automatic pause and highlight display
  collapsedShipmentsDetected?: boolean;
  firstCollapsedShipmentTime?: number; // Registration time of the earliest collapsed shipment
  shouldShowCollapseHighlights?: boolean;
  // Collapse simulation specific fields
  collapsePreBlocks?: number;
  collapsePreBlocksReceived?: number;
  collapsePrePhase?: boolean;
  collapseVisualStartTime?: number;
  currentBlock?: number;
}

export function hasReachedWeeklySimEnd(
  state: Pick<SimulationState, "hasStarted" | "startTime" | "currentTime">
): boolean {
  return (
    !!state.hasStarted &&
    state.startTime > 0 &&
    state.currentTime >= state.startTime + SIM_WEEKLY_DURATION_MS
  );
}

export function hasReachedCollapseSimEnd(
  state: Pick<SimulationState, "hasStarted" | "collapseVisualStartTime" | "currentTime">
): boolean {
  return (
    !!state.hasStarted &&
    (state.collapseVisualStartTime ?? 0) > 0 &&
    state.currentTime >= (state.collapseVisualStartTime ?? 0) + SIM_COLLAPSE_DURATION_MS
  );
}

export interface AirportState {
  code: string;
  currentStock: number;
  capacity: number;
  incoming: number;
  outgoing: number;
}

export interface FlightState {
  id: string;
  origin: string;
  destination: string;
  departureHour: number;
  capacity: number;
  currentLoad: number;
  cancelled: boolean;
  intercontinental: boolean;
  transitHours?: number;
}

export interface SimStats {
  totalRegistered: number;
  totalDelivered: number;
  totalInTransit: number;
  totalWaiting: number;
  totalDelayed: number;
  totalFailed: number;
  avgDeliveryTime: number;
  onTimeRate: number;
  warehouseUtilization: number;
  flightUtilization: number;
  deliveredHistory: { time: number; count: number }[];
  failedHistory: { time: number; count: number }[];
  // Nuevas métricas para el último bloque planificado
  totalBaggageProcessed: number;
  totalBaggageQuantity: number;
  totalBaggageOnTime: number;
  totalBaggageCollapsed: number;
  collapsedBaggageGroups: string[]; // IDs de envíos en colapso
}

export type SimEvent = {
  time: number;
  type: "register" | "depart" | "arrive" | "deliver" | "cancel" | "collapse" | "system";
  description: string;
  data?: any;
};

export interface Airline {
  id: string;
  name: string;
  code: string;
  email: string;
  password: string;
  assignedAirports: string[]; // airport codes
}