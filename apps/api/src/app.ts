import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { loadConfig } from "./config.js";
import { HttpError, type AppContext, type FetchLike } from "./context.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerCustomerRoutes } from "./routes/customers.js";
import { registerFinanceRoutes } from "./routes/finance.js";
import { registerOperationsRoutes } from "./routes/operations.js";
import { registerPosRoutes } from "./routes/pos.js";
import { Crypto } from "./security.js";
import { addStaff, seedDemoData, Store } from "./store.js";

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export interface BuildOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
}

export async function buildApp(options: BuildOptions = {}) {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const app = Fastify({ logger: config.env !== "test", bodyLimit: 256_000, requestIdHeader: "x-request-id", trustProxy: config.env === "production" });

  const timers = new Set<NodeJS.Timeout>();
  const running = new Set<Promise<void>>();
  let dueNow = 0;
  let closed = false;
  const ctx: AppContext = {
    config,
    store: new Store({ businessType: config.businessType, sellerName: config.sellerName, sellerVat: config.sellerVat, branchName: "الفرع الرئيسي" }),
    crypto: new Crypto(config.encryptionKey, config.authSecret),
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    schedule(task, delay = 0) {
      if (closed) return;
      if (delay === 0) dueNow += 1;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (delay === 0) dueNow -= 1;
        const promise = task().catch((error) => app.log.error(error)).finally(() => running.delete(promise));
        running.add(promise);
      }, delay);
      timer.unref();
      timers.add(timer);
    },
    async flush() {
      while (dueNow > 0 || running.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.all([...running]);
      }
    }
  };
  app.decorate("ctx", ctx);
  app.addHook("onClose", async () => {
    closed = true;
    for (const timer of timers) clearTimeout(timer);
  });

  if (config.seedDemoData) seedDemoData(ctx.store);
  if (env.OWNER_PIN && ctx.store.staff.size === 0) addStaff(ctx.store, { id: "owner", name: "المالك", role: "owner", pin: env.OWNER_PIN });

  // Keep the raw body so webhook signatures can be verified byte-for-byte.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    request.rawBody = body as string;
    parseJson(request, body as string, done);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.code, ...error.details });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({ error: status >= 500 ? "INTERNAL_ERROR" : (error as Error).message });
  });

  await app.register(helmet);
  await app.register(rateLimit, { max: config.rateLimitMax, timeWindow: "1 minute" });
  await app.register(cors, { origin: config.webOrigin, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });

  app.get("/health", async () => ({ ok: true, service: "cooffeup-api", time: new Date().toISOString() }));
  registerAuthRoutes(app, ctx);
  registerPosRoutes(app, ctx);
  registerCustomerRoutes(app, ctx);
  registerFinanceRoutes(app, ctx);
  registerChannelRoutes(app, ctx);
  registerOperationsRoutes(app, ctx);
  return app;
}
