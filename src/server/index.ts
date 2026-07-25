export { RaceRoom } from "./room";

export interface Env {
  ASSETS: Fetcher;
  RACE_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase().slice(0, 8);
      if (!code) return new Response("Missing room code", { status: 400 });
      const id = env.RACE_ROOM.idFromName(code);
      return env.RACE_ROOM.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
