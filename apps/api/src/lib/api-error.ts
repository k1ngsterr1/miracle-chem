import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { DomainError } from "@betonflow/domain";
import type { Response } from "express";
import { Prisma } from "../generated/prisma/index.js";
import type { ApiRequest } from "./http.js";

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

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ApiRequest>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? "unknown";
    if (exception instanceof ApiError) {
      response.status(exception.statusCode).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
        requestId,
      });
      return;
    }
    if (exception instanceof DomainError) {
      response.status(422).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
        requestId,
      });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        response.status(409).json({ error: { code: "CONFLICT", message: "Запись с такими уникальными данными уже существует" }, requestId });
        return;
      }
      if (exception.code === "P2025") {
        response.status(404).json({ error: { code: "NOT_FOUND", message: "Запись не найдена" }, requestId });
        return;
      }
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json({
        error: { code: "HTTP_ERROR", message: typeof body === "string" ? body : exception.message },
        requestId,
      });
      return;
    }
    this.logger.error("Unhandled request error", exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" }, requestId });
  }
}
