export interface Env {}

const HEALTH_PATH = "/health";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH) {
      return new Response("healthy", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
