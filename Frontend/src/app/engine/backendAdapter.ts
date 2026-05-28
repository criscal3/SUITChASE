import { BaggageGroup, FlightState, SimStats, AirportState } from "./types";

/**
 * Parses a LocalDateTime string from the backend (e.g. "2026-01-01T03:34:00")
 * as a UTC epoch millisecond value. No timezone offset is applied because the
 * backend uses pure LocalDateTime — cursor times and flight departure/arrival
 * times are all in the same simulation-local reference frame.
 */
function parseSimDate(dateStr: any, fallbackTime: number): number {
  if (!dateStr) return fallbackTime;
  try {
    const parts = String(dateStr).split(/[^0-9]/);
    if (parts.length >= 5) {
      const year  = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-based
      const day   = parseInt(parts[2], 10);
      const hour  = parseInt(parts[3], 10);
      const min   = parseInt(parts[4], 10);
      const sec   = parts[5] ? parseInt(parts[5], 10) : 0;
      return Date.UTC(year, month, day, hour, min, sec);
    }
    // Fallback for ISO strings that JavaScript can parse
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? fallbackTime : d.getTime();
  } catch {
    return fallbackTime;
  }
}

const MAX_FLIGHT_DURATION_MS = 24 * 3600 * 1000; // 24 h
const DAY_MS = 24 * 3600 * 1000;

function fixDepartureTime(depUtc: number, arrUtc: number): number {
  if (depUtc <= arrUtc && arrUtc - depUtc <= MAX_FLIGHT_DURATION_MS) {
    return depUtc; // already valid
  }

  // Try retracting by 1 or 2 days (covers any realistic timezone swing)
  for (let days = 1; days <= 2; days++) {
    const candidate = depUtc - days * DAY_MS;
    if (candidate <= arrUtc && arrUtc - candidate <= MAX_FLIGHT_DURATION_MS) {
      return candidate;
    }
  }

  // No clean fix found — return original to preserve the raw data
  return depUtc;
}

function splitTramo(tramoStr: string): [string, string] | null {
  if (!tramoStr) return null;
  const match = tramoStr.match(/([A-Z0-9]{3,4})[^A-Z0-9]+([A-Z0-9]{3,4})/i);
  if (match) {
    return [match[1].toUpperCase(), match[2].toUpperCase()];
  }
  // Fallback split if regex fails
  const parts = tramoStr.split(/[→\->]/);
  if (parts.length >= 2) {
    return [parts[0].trim().toUpperCase(), parts[1].trim().toUpperCase()];
  }
  return null;
}

export function mapBlockResultToBaggageGroups(
  rutasResumen: any[],
  cursorTime: number,
  currentBaggageGroups: BaggageGroup[],
  airportsList?: any[]
): BaggageGroup[] {
  const getAirportOffsetMs = (code: string): number => {
    if (!airportsList) return 0;
    const ap = airportsList.find((a) => a.code === String(code).toUpperCase());
    if (!ap) return 0;
    const tz = ap.timezone || "UTC+0";
    const match = tz.match(/UTC([+-]\d+)(?::(\d+))?/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const sign = hours >= 0 ? 1 : -1;
    const totalHours = hours + sign * (minutes / 60);
    return totalHours * 3600000;
  };

  const updatedGroups: BaggageGroup[] = (rutasResumen || []).map((resumen) => {
    const route: BaggageGroup["route"] = [];

    if (resumen.estado === "CON_RUTA") {
      // Prefer the new `tramos` array with exact per-leg times
      if (resumen.tramos && Array.isArray(resumen.tramos) && resumen.tramos.length > 0) {
        for (let i = 0; i < resumen.tramos.length; i++) {
          const tramo = resumen.tramos[i];
          const depLocal = parseSimDate(tramo.salida, cursorTime);
          const arrLocal = parseSimDate(tramo.llegada, depLocal + 3600000);
          const arrUtc = arrLocal - getAirportOffsetMs(tramo.destino);
          const depUtc = fixDepartureTime(depLocal - getAirportOffsetMs(tramo.origen), arrUtc);
          route.push({
            from: String(tramo.origen).toUpperCase(),
            to: String(tramo.destino).toUpperCase(),
            departureTime: depUtc,
            arrivalTime: arrUtc,
            flightId: `FLIGHT-${resumen.envioId}-${i + 1}`,
            transitHours: 0,
          });
        }
      } else if (resumen.primerTramo && resumen.ultimoTramo) {
        // Legacy fallback: only first and last leg summaries
        const split1 = splitTramo(resumen.primerTramo);
        if (split1) {
          const [from1, to1] = split1;
          const dep1Local = parseSimDate(resumen.salidaPrimer, cursorTime);
          const hasSecondLeg = resumen.primerTramo !== resumen.ultimoTramo;
          const arr1Local = hasSecondLeg
            ? dep1Local + 3600000
            : parseSimDate(resumen.llegadaFinal, dep1Local + 3600000);
          const arr1Utc = arr1Local - getAirportOffsetMs(to1);
          const dep1Utc = fixDepartureTime(dep1Local - getAirportOffsetMs(from1), arr1Utc);
          route.push({
            from: from1,
            to: to1,
            departureTime: dep1Utc,
            arrivalTime: arr1Utc,
            flightId: `FLIGHT-${resumen.envioId}-1`,
            transitHours: 0,
          });
        }
        if (resumen.primerTramo !== resumen.ultimoTramo) {
          const split2 = splitTramo(resumen.ultimoTramo);
          if (split2) {
            const [from2, to2] = split2;
            const arrival2Local = parseSimDate(resumen.llegadaFinal, cursorTime);
            const arrival2Utc = arrival2Local - getAirportOffsetMs(to2);
            const prevRoute = route[route.length - 1];
            const dep2Utc = prevRoute
              ? fixDepartureTime(prevRoute.arrivalTime + 1800000, arrival2Utc)
              : fixDepartureTime(arrival2Utc - 3600000, arrival2Utc);
            route.push({
              from: from2,
              to: to2,
              departureTime: dep2Utc,
              arrivalTime: arrival2Utc,
              flightId: `FLIGHT-${resumen.envioId}-2`,
              transitHours: 0,
            });
          }
        }
      }
    }

    const firstDep = route.length > 0 ? route[0].departureTime : cursorTime;
    const lastArr  = route.length > 0
      ? route[route.length - 1].arrivalTime
      : parseSimDate(resumen.llegadaFinal, cursorTime + 48 * 3600 * 1000) - getAirportOffsetMs(resumen.destino);

    return {
      id: String(resumen.envioId),
      airline: "BackendAirline",
      origin: resumen.origen,
      destination: resumen.destino,
      quantity: resumen.maletas,
      registeredAt: firstDep,
      deadlineAt: lastArr,
      currentLocation: resumen.origen,
      status: resumen.estado === "CON_RUTA" ? "in_transit" : "failed",
      route,
      currentLegIndex: 0, // SimulationMap computes the active leg from currentTime dynamically
    } as BaggageGroup;
  });

  return updatedGroups;
}

export function updateStatsFromMetrics(
  metricas: any,
  currentStats: SimStats
): SimStats {
  return {
    ...currentStats,
    totalRegistered: currentStats.totalRegistered + metricas.totalEnvios,
    totalDelivered: currentStats.totalDelivered + metricas.enviosConRuta,
    totalFailed: currentStats.totalFailed + metricas.enviosSinRuta,
    onTimeRate: metricas.sla || currentStats.onTimeRate,
    warehouseUtilization: metricas.ocupacionAlmacenes || currentStats.warehouseUtilization,
    flightUtilization: metricas.ocupacionVuelos || currentStats.flightUtilization,
  };
}
