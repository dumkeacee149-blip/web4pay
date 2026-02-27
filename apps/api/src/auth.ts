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
  fastify.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

    if (!token || !opts.apiKeys.has(token)) {
      throw new ApiError(401, "unauthorized", { code: "unauthorized" });
    }

    request.apiKey = token;
    request.tenantId = opts.tenantId;
  });
};

export default fp(authPlugin, { name: "web4pay-auth" });
