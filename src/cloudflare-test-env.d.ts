import type { Env } from "./env.js";

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Pick<Env, "DB"> {}
}
