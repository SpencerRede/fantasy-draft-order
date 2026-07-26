import type { Horse, RoomStatus } from "./protocol";
import { emptyLanes } from "./protocol";

export interface RoomState {
  status: RoomStatus;
  hostId: string | null;
  connections: string[];
  lanes: Horse[];
}

export function initialRoomState(): RoomState {
  return { status: "lobby", hostId: null, connections: [], lanes: emptyLanes() };
}

function clone(s: RoomState): RoomState {
  return {
    status: s.status,
    hostId: s.hostId,
    connections: [...s.connections],
    lanes: s.lanes.map((l) => ({ ...l })),
  };
}

export function addConnection(s: RoomState, id: string): RoomState {
  if (s.connections.includes(id)) return s;
  const next = clone(s);
  next.connections.push(id);
  if (next.hostId === null) next.hostId = id;
  return next;
}

export function removeConnection(s: RoomState, id: string): RoomState {
  const next = clone(s);
  next.connections = next.connections.filter((c) => c !== id);
  for (const lane of next.lanes) {
    if (lane.claimedBy === id && !lane.filled) {
      lane.claimedBy = null;
    }
  }
  if (next.hostId === id) {
    next.hostId = next.connections[0] ?? null;
  }
  return next;
}

export function claimLane(
  s: RoomState,
  id: string,
  lane: number
): { state: RoomState; error?: string } {
  const target = s.lanes[lane];
  if (!target) return { state: s, error: "Invalid lane" };
  if (target.claimedBy && target.claimedBy !== id) {
    return { state: s, error: "Lane already claimed" };
  }
  const next = clone(s);
  next.lanes[lane].claimedBy = id;
  return { state: next };
}

export function submitHorse(
  s: RoomState,
  id: string,
  lane: number,
  horseName: string,
  personName: string,
  image: string
): { state: RoomState; error?: string } {
  const target = s.lanes[lane];
  if (!target) return { state: s, error: "Invalid lane" };
  if (target.claimedBy !== id) return { state: s, error: "You do not own this lane" };
  if (!horseName.trim() || !personName.trim()) {
    return { state: s, error: "Horse name and person name are required" };
  }
  // Image is optional — a lane with no image renders a default horse.
  const next = clone(s);
  const l = next.lanes[lane];
  l.horseName = horseName.trim();
  l.personName = personName.trim();
  l.image = image;
  l.filled = true;
  return { state: next };
}

export function releaseLane(
  s: RoomState,
  id: string,
  lane: number
): { state: RoomState; error?: string } {
  const target = s.lanes[lane];
  if (!target) return { state: s, error: "Invalid lane" };
  if (target.claimedBy !== id) return { state: s, error: "You do not own this lane" };
  const next = clone(s);
  next.lanes[lane] = {
    lane,
    claimedBy: null,
    horseName: "",
    personName: "",
    image: null,
    filled: false,
  };
  return { state: next };
}

export function canStart(s: RoomState, id: string): boolean {
  return (
    s.status === "lobby" &&
    s.hostId === id &&
    s.lanes.every((l) => l.filled)
  );
}

export function startRace(
  s: RoomState,
  id: string
): { state: RoomState; error?: string } {
  if (!canStart(s, id)) {
    return { state: s, error: "Cannot start: must be host and all lanes filled" };
  }
  const next = clone(s);
  next.status = "racing";
  return { state: next };
}
