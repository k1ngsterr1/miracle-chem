import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuditEntityType } from "../generated/prisma/index.js";
import { clearedSessionCookie, createSessionToken, sessionCookie } from "../lib/auth-session.js";
import { ApiError } from "../lib/api-error.js";
import type { ApiRequest } from "../lib/http.js";
import { verifyPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody } from "../lib/validation.js";

const loginSchema = z.object({
  email: z.string().trim().email().max(250).transform((value) => value.toLocaleLowerCase("en-US")),
  password: z.string().min(8).max(200),
});

@Controller("auth")
export class AuthController {
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parseBody(loginSchema, body);
    const candidates = await prisma.user.findMany({
      where: { email: { equals: input.email, mode: "insensitive" }, active: true },
      include: { workspace: true },
      take: 2,
    });
    const candidate = candidates[0];
    const user = candidates.length === 1 && candidate !== undefined ? candidate : null;
    if (user === null || user.passwordHash === null || !verifyPassword(input.password, user.passwordHash)) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Неверный логин или пароль");
    }
    response.setHeader("set-cookie", sessionCookie(createSessionToken(user.id, user.workspaceId)));
    await prisma.auditLog.create({
      data: {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: "USER_LOGIN",
        entityType: AuditEntityType.USER,
        entityId: user.id,
        metadata: { method: "password" },
      },
    });
    return sessionResponse(user, user.workspace);
  }

  @Get("session")
  async session(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return sessionResponse(actor, workspace);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.setHeader("set-cookie", clearedSessionCookie());
  }
}

function sessionResponse(
  user: { id: string; name: string; email: string; role: string; workspaceId: string },
  workspace: { id: string; name: string; timezone: string; currency: string },
) {
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    workspace: { id: workspace.id, name: workspace.name, timezone: workspace.timezone, currency: workspace.currency },
  };
}
