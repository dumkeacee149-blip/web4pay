import type { FastifyRequest } from "fastify";

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
}

interface ApiErrorOptions {
  code?: string;
  detail?: string;
  type?: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly detail?: string;
  readonly type: string;

  constructor(statusCode: number, title: string, options?: ApiErrorOptions) {
    super(title);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = options?.code;
    this.detail = options?.detail;
    this.type = options?.type ?? "about:blank";
  }
}

interface ProblemInput {
  status: number;
  title: string;
  detail?: string;
  code?: string;
  type?: string;
}

export function problemForRequest(
  request: FastifyRequest,
  input: ProblemInput,
): ProblemDetails {
  const problem: ProblemDetails = {
    type: input.type ?? "about:blank",
    title: input.title,
    status: input.status,
    instance: request.url,
  };

  if (input.detail) {
    problem.detail = input.detail;
  }
  if (input.code) {
    problem.code = input.code;
  }

  return problem;
}
