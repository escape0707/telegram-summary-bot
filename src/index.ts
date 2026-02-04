export interface Env {
  DB: D1Database;
}

const HEALTH_PATH = "/health";

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH) {
      return new Response("healthy", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
