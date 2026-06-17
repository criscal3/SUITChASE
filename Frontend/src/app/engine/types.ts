export const SIM_BASE_DATE = new Date(2026, 0, 2, 0, 0, 0);

/** Duración del cronómetro de simulación semanal (5 días desde fecha inicial). */
export const SIM_WEEKLY_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

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