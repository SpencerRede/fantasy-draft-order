export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return new Response("WebSocket endpoint not wired yet", { status: 426 });
    }
    return env.ASSETS.fetch(request);
  },
};
