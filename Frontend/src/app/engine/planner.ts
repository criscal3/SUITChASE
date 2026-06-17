import { getTransitTimeHours } from "../data/flights";
import type { BaggageGroup, RouteLeg } from "./types";

interface GraphEdge {
  flightId: string;
  from: string;
  to: string;
  departureHour: number;
  transitHours: number;
  capacity: number;
  intercontinental: boolean;
}

// Build graph from flight schedules
export function planRoute(
  origin: string,
  destination: string,
  startTime: number,
  deadlineTime: number,
  turnaroundHours: number,
  flights: import("./types").FlightState[]
): RouteLeg[] | null {
  const graph = new Map<string, GraphEdge[]>();
  for (const f of flights) {
    if (f.cancelled) continue;
    const edges = graph.get(f.origin) || [];
    edges.push({
      flightId: f.id,
      from: f.origin,
      to: f.destination,
      departureHour: f.departureHour,
      transitHours: (f as any).transitHours ?? getTransitTimeHours(f.origin, f.destination),
      capacity: f.capacity,
      intercontinental: f.intercontinental,
    });
    graph.set(f.origin, edges);
  }


  interface State {
    airport: string;
    time: number;
    legs: RouteLeg[];
  }

  const queue: State[] = [{ airport: origin, time: startTime, legs: [] }];
  const visited = new Map<string, number>(); // airport -> earliest arrival

  while (queue.length > 0) {
    // Sort by time (priority queue)
    queue.sort((a, b) => a.time - b.time);
    const current = queue.shift()!;

    if (current.airport === destination) {
      return current.legs;
    }

    const key = current.airport;
    const prev = visited.get(key);
    if (prev !== undefined && prev <= current.time) continue;
    visited.set(key, current.time);

    if (current.time > deadlineTime) continue;

    const edges = graph.get(current.airport) || [];
    for (const edge of edges) {
      // Find next available departure
      const dayHour = current.time % 24;
      let waitHours = edge.departureHour - dayHour;
      if (waitHours < turnaroundHours) waitHours += 24;

      const departureTime = current.time + waitHours;
      const arrivalTime = departureTime + edge.transitHours;

      if (arrivalTime > deadlineTime) continue;

      const prevDest = visited.get(edge.to);
      if (prevDest !== undefined && prevDest <= arrivalTime) continue;

      queue.push({
        airport: edge.to,
        time: arrivalTime,
        legs: [
          ...current.legs,
          {
            flightId: edge.flightId,
            from: edge.from,
            to: edge.to,
            departureTime,
            arrivalTime,
            transitHours: edge.transitHours,
          },
        ],
      });
    }
  }

  return null; // No route found within deadline
}

export function replanRoute(
  baggage: BaggageGroup,
  currentTime: number,
  turnaroundHours: number,
  flights: import("./types").FlightState[]
): RouteLeg[] | null {
  return planRoute(
    baggage.currentLocation,
    baggage.destination,
    currentTime,
    baggage.deadlineAt,
    turnaroundHours,
    flights
  );
}
