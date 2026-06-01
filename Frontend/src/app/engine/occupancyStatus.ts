/** Umbrales de ocupación (almacenes y vuelos) — alineados con la leyenda "Estado". */
export const OCCUPANCY_NORMAL_MAX = 50;
export const OCCUPANCY_SATURATED_MIN = 80;

export type OccupancyLevel = "normal" | "moderate" | "saturated";

export const OCCUPANCY_COLORS = {
  normal: "#22c55e",
  moderate: "#f59e0b",
  saturated: "#ef4444",
} as const;

export const OCCUPANCY_PLANE_STROKE = {
  normal: "#15803d",
  moderate: "#b45309",
  saturated: "#b91c1c",
} as const;

/** Porcentaje de ocupación (0–100+). */
export function getOccupancyLevel(utilizationPct: number): OccupancyLevel {
  if (utilizationPct < OCCUPANCY_NORMAL_MAX) return "normal";
  if (utilizationPct < OCCUPANCY_SATURATED_MIN) return "moderate";
  return "saturated";
}

export function getOccupancyColor(utilizationPct: number): string {
  return OCCUPANCY_COLORS[getOccupancyLevel(utilizationPct)];
}

export function getOccupancyPlaneStroke(utilizationPct: number): string {
  return OCCUPANCY_PLANE_STROKE[getOccupancyLevel(utilizationPct)];
}

/** Clases Tailwind para texto de ocupación en tooltips. */
export function getOccupancyTextClass(utilizationPct: number): string {
  const level = getOccupancyLevel(utilizationPct);
  if (level === "normal") return "text-green-500";
  if (level === "moderate") return "text-amber-500";
  return "text-red-500";
}

export function computeUtilizationPercent(used: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return (used / capacity) * 100;
}
