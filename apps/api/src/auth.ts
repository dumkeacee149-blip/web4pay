import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { ApiError } from "./errors";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    apiKey: string;
  }
}

export interface AuthPluginOptions {
  apiKeys: Set<string>;
  tenantId: string;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  fastify.addHook("preHandler", async (request) => {
    if (request.method === "OPTIONS") {
      return;
    }

    const header = request.headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      throw new ApiError(401, "Unauthorized", {
        code: "unauthorized",
        detail: "Missing Bearer token",
      });
    }

    const token = header.slice("bearer ".length).trim();
    if (!opts.apiKeys.has(token)) {
      throw new ApiError(401, "Unauthorized", {
        code: "unauthorized",
        detail: "Invalid API key",
      });
    }

    request.apiKey = token;
    request.tenantId = opts.tenantId;
  });
};

export default fp(authPlugin);
