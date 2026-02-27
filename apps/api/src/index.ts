import Fastify from "fastify";
import { loadConfig } from "./config";
import { createDbPool, ensureDefaultTenant } from "./db";
import { ApiError, problemForRequest } from "./errors";
import authPlugin from "./auth";
import { routes } from "./routes";

async function main() {
  const config = loadConfig();
  const pool = createDbPool(config.databaseUrl);

  const tenantId = await ensureDefaultTenant(pool);

  const fastify = Fastify({
    logger: true,
  });

  fastify.setErrorHandler((err, request, reply) => {
    if (err instanceof ApiError) {
      const problem = problemForRequest(request, {
        status: err.statusCode,
        title: err.message,
        detail: err.detail,
        code: err.code,
        type: err.type,
      });
      reply.status(err.statusCode).type("application/problem+json").send(problem);
      return;
    }

    request.log.error({ err }, "Unhandled error");
    const problem = problemForRequest(request, {
      status: 500,
      title: "internal",
      code: "internal",
    });
    reply.status(500).type("application/problem+json").send(problem);
  });

  await fastify.register(authPlugin, {
    apiKeys: config.apiKeys,
    tenantId,
  });

  await fastify.register(routes, {
    pool,
    chain: {
      escrow: process.env.ESCROW_CONTRACT ?? "0x0000000000000000000000000000000000000000",
      usdc: process.env.USDC_CONTRACT ?? "0x0000000000000000000000000000000000000000",
    },
  });

  await fastify.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
