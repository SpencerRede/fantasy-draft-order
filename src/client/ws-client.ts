import type { ClientMessage, ServerMessage } from "../shared/protocol";

const KNOWN_TYPES = new Set(["room_state", "race_start", "error"]);

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.type === "string" && KNOWN_TYPES.has(obj.type)) {
      return obj as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export interface RoomConnectionHandlers {
  onMessage: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class RoomConnection {
  private ws: WebSocket;

  constructor(code: string, private handlers: RoomConnectionHandlers) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws?code=${encodeURIComponent(code)}`);
    this.ws.addEventListener("open", () => this.handlers.onOpen?.());
    this.ws.addEventListener("close", () => this.handlers.onClose?.());
    this.ws.addEventListener("message", (e) => {
      const msg = parseServerMessage(e.data as string);
      if (msg) this.handlers.onMessage(msg);
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }
}
