import type { FastifyInstance } from "fastify";
import { DomainError } from "@betonflow/domain";
import { Prisma } from "../generated/prisma/index.js";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id,
      });
    }
    if (error instanceof DomainError) {
      return reply.status(422).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id,
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: "Запись с такими уникальными данными уже существует" },
          requestId: request.id,
        });
      }
      if (error.code === "P2025") {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Запись не найдена" },
          requestId: request.id,
        });
      }
    }

    request.log.error({ error }, "Unhandled request error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Внутренняя ошибка сервера",
      },
      requestId: request.id,
    });
  });
}

