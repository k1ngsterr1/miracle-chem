import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Unit } from "../generated/prisma/index.js";
import type { ApiRequest } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import {
  createCustomer,
  createCustomerConcreteRecipe,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../services/customer-service.js";

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  taxId: optionalText(32),
  contactPerson: optionalText(200),
  phone: optionalText(60),
  email: z.string().trim().email().max(200).optional(),
  address: optionalText(500),
  contractNumber: optionalText(120),
  contractSignedAt: z.coerce.date().optional(),
  contractValidUntil: z.coerce.date().optional(),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  creditLimit: nonNegativeDecimalString.optional(),
  notes: optionalText(2000),
});

const updateCustomerSchema = createCustomerSchema.partial().extend({ active: z.boolean().optional() });

const concreteComponentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: positiveDecimalString,
  unit: z.nativeEnum(Unit),
  note: optionalText(500),
  position: z.number().int().min(0).optional(),
});

const createConcreteRecipeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  concreteGrade: z.string().trim().min(1).max(80),
  basisVolume: positiveDecimalString,
  binderMassKg: positiveDecimalString,
  additiveFormulaVersionId: z.string().uuid(),
  additiveDosagePercent: positiveDecimalString,
  notes: optionalText(2000),
  components: z.array(concreteComponentSchema).min(1).max(250),
});

@Controller("customers")
export class CustomerController {
  @Get()
  async list(@Req() request: ApiRequest) {
    const { workspaceId } = await getRequestContext(request, prisma);
    return listCustomers(workspaceId);
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    return getCustomer(workspaceId, id);
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createCustomer(workspaceId, actor.id, parseBody(createCustomerSchema, body));
  }

  @Patch(":id")
  async update(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return updateCustomer(workspaceId, actor.id, id, parseBody(updateCustomerSchema, body));
  }

  @Post(":id/recipes")
  async createRecipe(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createCustomerConcreteRecipe(
      workspaceId,
      actor.id,
      id,
      parseBody(createConcreteRecipeSchema, body),
    );
  }
}
