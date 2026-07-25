import { DurableObject } from "cloudflare:workers";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import {
  type RoomState,
  initialRoomState,
  addConnection,
  removeConnection,
  claimLane,
  submitHorse,
  releaseLane,
  startRace,
} from "../shared/room-state";
import { simulate } from "../shared/race-sim";
import { COUNTDOWN_MS } from "../shared/constants";

interface Attachment {
  id: string;
}

export class RaceRoom extends DurableObject {
  private room: RoomState;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.room = initialRoomState();
    // Re-register connection ids for any sockets that survived hibernation.
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.id) this.room = addConnection(this.room, att.id);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    server.serializeAttachment({ id } satisfies Attachment);
    this.ctx.acceptWebSocket(server);

    this.room = addConnection(this.room, id);
    this.broadcast();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendTo(ws, { type: "error", message: "Malformed message" });
    }

    let error: string | undefined;
    switch (msg.type) {
      case "claim_lane":
        ({ error } = this.apply(claimLane(this.room, att.id, msg.lane)));
        break;
      case "submit_horse":
        ({ error } = this.apply(
          submitHorse(this.room, att.id, msg.lane, msg.horseName, msg.personName, msg.image)
        ));
        break;
      case "release_lane":
        ({ error } = this.apply(releaseLane(this.room, att.id, msg.lane)));
        break;
      case "start_race": {
        const res = startRace(this.room, att.id);
        if (res.error) { error = res.error; break; }
        this.room = res.state;
        const script = simulate(Date.now());
        this.broadcast();
        this.broadcastRaw({ type: "race_start", script, startAt: Date.now() + COUNTDOWN_MS });
        return;
      }
    }
    if (error) return this.sendTo(ws, { type: "error", message: error });
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att) {
      this.room = removeConnection(this.room, att.id);
      this.broadcast();
    }
  }

  private apply(res: { state: RoomState; error?: string }): { error?: string } {
    if (!res.error) this.room = res.state;
    return { error: res.error };
  }

  private broadcast(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      this.sendTo(ws, {
        type: "room_state",
        status: this.room.status,
        hostId: this.room.hostId,
        youId: att.id,
        lanes: this.room.lanes,
      });
    }
  }

  private broadcastRaw(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) this.sendTo(ws, msg);
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }
}
