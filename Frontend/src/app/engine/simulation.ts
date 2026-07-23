import { planRoute, replanRoute } from "./planner";
import type { SimulationState, BaggageGroup, AirportState, FlightState, SimEvent, SimStats } from "./types";

const AIRLINES = [
  "AeroLatam", "SkyEurope", "AsiaWings", "TransGlobal", "PacificAir",
  "AtlanticJet", "NordStar", "SunAirways", "EagleFlights", "OrionAir"
];

function randomAirline(): string {
  return AIRLINES[Math.floor(Math.random() * AIRLINES.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function createInitialState(scenario: "daily" | "weekly" | "tracking", turnaroundHours: number): SimulationState {
  const airports: Record<string, AirportState> = {};
  for (const a of AIRPORTS) {
    airports[a.code] = {
      code: a.code,
      currentStock: 0,
      capacity: a.warehouseCapacity,
      incoming: 0,
      outgoing: 0,
    };
  }

  const flights: FlightState[] = FLIGHT_SCHEDULES.map(f => ({
    id: f.id,
    origin: f.origin,
    destination: f.destination,
    departureHour: f.departureHour,
    capacity: f.capacity,
    currentLoad: 0,
    cancelled: false,
    intercontinental: f.intercontinental,
  }));

  return {
    currentTime: 0,
    startTime: 0,
    day: 1,
    hour: 0,
    baggageGroups: [],
    airports,
    flights,
    flightOccupancy: {},
    flightCapacities: {},
    stats: createEmptyStats(),
    collapsed: false,
    collapseReason: "",
    running: false,
    speed: 1,
    scenario,
    turnaroundHours,
    collapsedShipmentsDetected: false,
    firstCollapsedShipmentTime: undefined,
    shouldShowCollapseHighlights: false,
  };
}

export function createEmptyStats(): SimStats {
  return {
    totalRegistered: 0,
    totalDelivered: 0,
    totalInTransit: 0,
    totalWaiting: 0,
    totalDelayed: 0,
    totalFailed: 0,
    avgDeliveryTime: 0,
    onTimeRate: 100,
    warehouseUtilization: 0,
    flightUtilization: 0,
    deliveredHistory: [],
    failedHistory: [],
    totalBaggageProcessed: 0,
    totalBaggageQuantity: 0,
    totalBaggageOnTime: 0,
    totalBaggageCollapsed: 0,
    collapsedBaggageGroups: [],
  };
}

let baggageIdCounter = 0;

export function generateDemand(state: SimulationState, scaleFactor: number = 1): BaggageGroup[] {
  const newGroups: BaggageGroup[] = [];
  const numGroups = Math.floor(randomInt(3, 8) * scaleFactor);

  for (let i = 0; i < numGroups; i++) {
    const originIdx = randomInt(0, AIRPORTS.length - 1);
    let destIdx = randomInt(0, AIRPORTS.length - 2);
    if (destIdx >= originIdx) destIdx++;

    const origin = AIRPORTS[originIdx];
    const dest = AIRPORTS[destIdx];
    const quantity = randomInt(1, 30);
    const deadlineHours = getDeadlineHours(origin.code, dest.code);

    const group: BaggageGroup = {
      id: `BG-${String(++baggageIdCounter).padStart(6, "0")}`,
      airline: randomAirline(),
      origin: origin.code,
      destination: dest.code,
      quantity,
      registeredAt: state.currentTime,
      deadlineAt: state.currentTime + deadlineHours,
      currentLocation: origin.code,
      status: "waiting",
      route: [],
      currentLegIndex: 0,
    };

    const route = planRoute(origin.code, dest.code, state.currentTime, group.deadlineAt, state.turnaroundHours, state.flights);
    if (route) {
      group.route = route;
    }

    newGroups.push(group);
  }

  return newGroups;
}

export function simulateStep(state: SimulationState, dt: number): { state: SimulationState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  const newTime = state.currentTime + dt;
  const newState = { ...state, currentTime: newTime };
  newState.day = Math.floor(newTime / 24) + 1;
  newState.hour = Math.round((newTime % 24) * 10) / 10;
  newState.baggageGroups = [...state.baggageGroups];
  newState.airports = { ...state.airports };
  newState.stats = { ...state.stats };

  // Generate demand
  const scaleFactor = 1;

  // Generate new demand every ~2 hours sim time
  if (Math.floor(newTime / 2) > Math.floor(state.currentTime / 2)) {
    const newGroups = generateDemand(newState, scaleFactor);
    for (const g of newGroups) {
      newState.baggageGroups.push(g);
      if (newState.airports[g.origin]) {
        newState.airports[g.origin] = {
          ...newState.airports[g.origin],
          currentStock: newState.airports[g.origin].currentStock + g.quantity,
        };
      }
      newState.stats.totalRegistered += g.quantity;
      events.push({
        time: newTime,
        type: "register",
        description: `${g.quantity} maletas registradas: ${g.origin} → ${g.destination} (${g.airline})`,
      });
      // RF66: Log route creation
      if (g.route.length > 0) {
        events.push({
          time: newTime,
          type: "system",
          description: `Ruta creada para ${g.id}: ${g.route.map(l => l.from).join("→")}→${g.destination} (${g.route.length} tramos)`,
        });
      } else {
        events.push({
          time: newTime,
          type: "system",
          description: `Sin ruta disponible para ${g.id}: ${g.origin}→${g.destination}`,
        });
      }
    }
  }

  // Process each baggage group
  for (let i = 0; i < newState.baggageGroups.length; i++) {
    const bg = { ...newState.baggageGroups[i] };
    newState.baggageGroups[i] = bg;

    if (bg.status === "delivered" || bg.status === "failed") continue;

    // Check deadline
    if (newTime >= bg.deadlineAt && bg.status !== "delivered") {
      if (bg.status !== "failed") {
        bg.status = "failed";
        newState.stats.totalFailed += bg.quantity;
        events.push({
          time: newTime,
          type: "collapse",
          description: `PLAZO VENCIDO: ${bg.id} (${bg.origin}→${bg.destination})`,
        });
      }
      continue;
    }

    // If no route, try to plan
    if (bg.route.length === 0) {
      const route = planRoute(bg.origin, bg.destination, newTime, bg.deadlineAt, state.turnaroundHours, state.flights);
      if (route) {
        bg.route = route;
      } else {
        bg.status = "delayed";
        continue;
      }
    }

    // Process current leg
    if (bg.currentLegIndex < bg.route.length) {
      const leg = bg.route[bg.currentLegIndex];

      if (bg.status === "waiting" && newTime >= leg.departureTime) {
        // Depart
        bg.status = "in_transit";
        if (newState.airports[leg.from]) {
          newState.airports[leg.from] = {
            ...newState.airports[leg.from],
            currentStock: Math.max(0, newState.airports[leg.from].currentStock - bg.quantity),
            outgoing: newState.airports[leg.from].outgoing + bg.quantity,
          };
        }
        events.push({
          time: newTime,
          type: "depart",
          description: `${bg.quantity} maletas despegan: ${leg.from}→${leg.to} (vuelo ${leg.flightId})`,
        });
      }

      if (bg.status === "in_transit" && newTime >= leg.arrivalTime) {
        // Arrive
        bg.currentLocation = leg.to;
        bg.currentLegIndex++;
        if (newState.airports[leg.to]) {
          newState.airports[leg.to] = {
            ...newState.airports[leg.to],
            currentStock: newState.airports[leg.to].currentStock + bg.quantity,
            incoming: newState.airports[leg.to].incoming + bg.quantity,
          };
        }

        if (bg.currentLegIndex >= bg.route.length && bg.currentLocation === bg.destination) {
          bg.status = "delivered";
          newState.stats.totalDelivered += bg.quantity;
          const deliveryTime = newTime - bg.registeredAt;
          events.push({
            time: newTime,
            type: "deliver",
            description: `${bg.quantity} maletas entregadas en ${bg.destination} (${deliveryTime.toFixed(1)}h)`,
          });
        } else {
          bg.status = "waiting";
          events.push({
            time: newTime,
            type: "arrive",
            description: `${bg.quantity} maletas llegan a ${leg.to} (escala)`,
          });
        }
      }
    }
  }

  // Update stats
  let inTransit = 0, waiting = 0, delayed = 0;
  let totalDeliveryTime = 0, deliveredCount = 0;
  for (const bg of newState.baggageGroups) {
    if (bg.status === "in_transit") inTransit += bg.quantity;
    else if (bg.status === "waiting") waiting += bg.quantity;
    else if (bg.status === "delayed") delayed += bg.quantity;
    if (bg.status === "delivered") {
      deliveredCount++;
      totalDeliveryTime += (bg.deadlineAt - bg.registeredAt);
    }
  }
  newState.stats.totalInTransit = inTransit;
  newState.stats.totalWaiting = waiting;
  newState.stats.totalDelayed = delayed;
  newState.stats.avgDeliveryTime = deliveredCount > 0 ? totalDeliveryTime / deliveredCount : 0;
  newState.stats.onTimeRate = newState.stats.totalRegistered > 0
    ? ((newState.stats.totalRegistered - newState.stats.totalFailed) / newState.stats.totalRegistered) * 100
    : 100;

  // Warehouse utilization
  let totalStock = 0, totalCap = 0;
  for (const code of Object.keys(newState.airports)) {
    totalStock += newState.airports[code].currentStock;
    totalCap += newState.airports[code].capacity;

    // Check warehouse overflow - collapse only for collapse scenario
    if (newState.airports[code].currentStock > newState.airports[code].capacity) {
      if (state.scenario === "collapse") {
        newState.collapsed = true;
        newState.running = false;
        newState.collapseReason = `Colapso en día ${newState.day}: almacén de ${code} excedió su capacidad (${newState.airports[code].currentStock}/${newState.airports[code].capacity} maletas).`;
        events.push({
          time: newTime,
          type: "collapse",
          description: `ALMACÉN DESBORDADO: ${code} (${newState.airports[code].currentStock}/${newState.airports[code].capacity})`,
        });
      }
    }
  }
  newState.stats.warehouseUtilization = totalCap > 0 ? (totalStock / totalCap) * 100 : 0;

  // History
  newState.stats.deliveredHistory = [
    ...state.stats.deliveredHistory,
    { time: newTime, count: newState.stats.totalDelivered },
  ];
  newState.stats.failedHistory = [
    ...state.stats.failedHistory,
    { time: newTime, count: newState.stats.totalFailed },
  ];

  return { state: newState, events };
}

export function cancelFlight(state: SimulationState, flightId: string): { state: SimulationState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  const newState = { ...state };
  newState.flights = state.flights.map(f =>
    f.id === flightId ? { ...f, cancelled: true } : f
  );

  // Find the original flight schedule and cancel it
  const flight = FLIGHT_SCHEDULES.find(f => f.id === flightId);
  if (flight) {
    flight.cancelled = true;
    events.push({
      time: state.currentTime,
      type: "cancel",
      description: `Vuelo ${flightId} cancelado (${flight.origin}→${flight.destination})`,
    });
  }

  // Replan affected baggage
  newState.baggageGroups = state.baggageGroups.map(bg => {
    if (bg.status === "delivered" || bg.status === "failed") return bg;
    const affectedLegIdx = bg.route.findIndex((leg, idx) => idx >= bg.currentLegIndex && leg.flightId === flightId);
    if (affectedLegIdx === -1) return bg;

    if (bg.status === "in_transit") {
      // Bag is currently flying — preserve the current leg and replan only from the landing airport
      const currentLeg = bg.route[bg.currentLegIndex];
      if (!currentLeg) return bg;
      const landingAirport = currentLeg.to;
      const landingTime = currentLeg.arrivalTime;

      if (landingAirport === bg.destination) {
        // Already landing at the final destination — nothing to replan
        return bg;
      }

      const remainingRoute = planRoute(landingAirport, bg.destination, landingTime, bg.deadlineAt, state.turnaroundHours, newState.flights);
      if (remainingRoute) {
        const completedLegs = bg.route.slice(0, bg.currentLegIndex + 1);
        const newRoute = [...completedLegs, ...remainingRoute];
        events.push({
          time: state.currentTime,
          type: "system",
          description: `Ruta replanificada para ${bg.id} (en vuelo): ${landingAirport}→${bg.destination} (${remainingRoute.length} tramos restantes)`,
        });
        return { ...bg, route: newRoute };
      } else {
        // No route found from landing — keep flying to landing airport, clear future legs
        const routeUpToCurrent = bg.route.slice(0, bg.currentLegIndex + 1);
        events.push({
          time: state.currentTime,
          type: "system",
          description: `Sin ruta alternativa para ${bg.id} desde ${landingAirport}→${bg.destination}. Llegará a ${landingAirport} sin tramos restantes.`,
        });
        return { ...bg, route: routeUpToCurrent };
      }
    } else {
      // Bag is waiting or delayed — replan from current location
      const newRoute = replanRoute(bg, state.currentTime, state.turnaroundHours, newState.flights);
      if (newRoute) {
        events.push({
          time: state.currentTime,
          type: "system",
          description: `Ruta replanificada para ${bg.id}: ${newRoute.map(l => l.from).join("→")}→${bg.destination} (${newRoute.length} tramos)`,
        });
        return { ...bg, route: newRoute, currentLegIndex: 0 };
      } else {
        events.push({
          time: state.currentTime,
          type: "system",
          description: `Error de replanificación: sin ruta alternativa para ${bg.id} (${bg.currentLocation}→${bg.destination})`,
        });
        const routeUpToCurrent = bg.route.slice(0, bg.currentLegIndex);
        return { ...bg, status: "delayed" as const, route: routeUpToCurrent };
      }
    }
  });

  return { state: newState, events };
}