import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { AuditEntityType, UserRole } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import type { ApiRequest } from "../lib/http.js";
import { hashPassword } from "../lib/password.js";
import { requirePermission } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody } from "../lib/validation.js";

const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(250).transform((value) => value.toLocaleLowerCase("en-US")),
  password: z.string().min(8).max(200),
  role: z.nativeEnum(UserRole),
});

const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  role: z.nativeEnum(UserRole).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: "Передайте хотя бы одно изменяемое поле",
});

const companyProfileSchema = z.object({
  legalName: z.string().trim().max(250).optional(),
  taxId: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(250).optional().or(z.literal("")),
  bankName: z.string().trim().max(250).optional(),
  iban: z.string().trim().max(64).optional(),
  bic: z.string().trim().max(32).optional(),
  directorName: z.string().trim().max(160).optional(),
  accountantName: z.string().trim().max(160).optional(),
  signatoryName: z.string().trim().max(160).optional(),
  signatoryPosition: z.string().trim().max(160).optional(),
  documentFooter: z.string().trim().max(1000).optional(),
});

@Controller("admin")
export class AdminController {
  @Get("users")
  async users(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "USER_MANAGEMENT");
    return {
      items: await prisma.user.findMany({
        where: { workspaceId },
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, updatedAt: true },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
    };
  }

  @Post("users")
  async createUser(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "USER_MANAGEMENT");
    const input = parseBody(userCreateSchema, body);
    assertMayManageRole(actor.role, input.role);
    const existing = await prisma.user.findFirst({
      where: { workspaceId, email: { equals: input.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing !== null) throw new ApiError(409, "USER_EMAIL_ALREADY_EXISTS", "Пользователь с этим email уже существует");
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { workspaceId, name: input.name, email: input.email, passwordHash: hashPassword(input.password), role: input.role },
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, updatedAt: true },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId: actor.id,
        action: "USER_CREATED",
        entityType: AuditEntityType.USER,
        entityId: user.id,
        after: user,
      });
      return user;
    });
  }

  @Patch("users/:id")
  async updateUser(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "USER_MANAGEMENT");
    const input = parseBody(userUpdateSchema, body);
    const user = await prisma.user.findFirst({ where: { id, workspaceId } });
    if (user === null) throw new ApiError(404, "USER_NOT_FOUND", "Пользователь не найден");
    assertMayManageRole(actor.role, input.role ?? user.role);
    if (actor.role !== UserRole.ADMIN && user.role === UserRole.ADMIN) {
      throw new ApiError(403, "ADMIN_ACCOUNT_PROTECTED", "Учётную запись администратора может изменять только администратор");
    }
    if (user.id === actor.id && (input.active === false || (input.role !== undefined && input.role !== user.role))) {
      throw new ApiError(409, "SELF_ACCESS_CHANGE_FORBIDDEN", "Нельзя отключить свою учётную запись или изменить собственную роль");
    }
    const removesAdminRole = user.role === UserRole.ADMIN && (input.role !== undefined && input.role !== UserRole.ADMIN || input.active === false);
    if (removesAdminRole) {
      const activeAdminCount = await prisma.user.count({ where: { workspaceId, role: UserRole.ADMIN, active: true } });
      if (activeAdminCount <= 1) {
        throw new ApiError(409, "LAST_ADMIN_PROTECTED", "В системе должен остаться хотя бы один активный администратор");
      }
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(input.password === undefined ? {} : { passwordHash: hashPassword(input.password) }),
        },
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, updatedAt: true },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId: actor.id,
        action: "USER_UPDATED",
        entityType: AuditEntityType.USER,
        entityId: user.id,
        before: { name: user.name, role: user.role, active: user.active },
        after: updated,
      });
      return updated;
    });
  }

  @Get("company-profile")
  async companyProfile(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "COMPANY_PROFILE_MANAGEMENT");
    const [workspace, profile] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, currency: true } }),
      prisma.companyProfile.findUnique({ where: { workspaceId } }),
    ]);
    return profile ?? {
      workspaceId,
      legalName: workspace.name,
      taxId: null,
      address: null,
      phone: null,
      email: null,
      bankName: null,
      iban: null,
      bic: null,
      directorName: null,
      accountantName: null,
      signatoryName: null,
      signatoryPosition: null,
      documentFooter: null,
      currency: workspace.currency,
    };
  }

  @Put("company-profile")
  @HttpCode(HttpStatus.OK)
  async updateCompanyProfile(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "COMPANY_PROFILE_MANAGEMENT");
    const input = parseBody(companyProfileSchema, body);
    return prisma.$transaction(async (tx) => {
      const profile = await tx.companyProfile.upsert({
        where: { workspaceId },
        create: { workspaceId, ...nullifyEmpty(input) },
        update: nullifyEmpty(input),
      });
      await writeAudit(tx, {
        workspaceId,
        actorId: actor.id,
        action: "COMPANY_PROFILE_UPDATED",
        entityType: AuditEntityType.WORKSPACE,
        entityId: workspaceId,
        after: profile,
      });
      return profile;
    });
  }
}

function assertMayManageRole(actorRole: UserRole, targetRole: UserRole): void {
  if (actorRole === UserRole.DIRECTOR && targetRole === UserRole.ADMIN) {
    throw new ApiError(403, "ADMIN_ROLE_PROTECTED", "Роль администратора может назначать только администратор");
  }
}

function nullifyEmpty<T extends Record<string, string | undefined>>(input: T): Record<string, string | null> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === undefined || value === "" ? null : value]));
}
