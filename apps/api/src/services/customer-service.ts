import { Decimal } from "decimal.js";
import { AccountingDocumentStatus, AccountingDocumentType, AuditEntityType, Prisma, Unit } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { loadOneCFinance } from "./one-c-finance-service.js";

export interface CreateCustomerInput {
  name: string;
  taxId?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  contractNumber?: string;
  contractSignedAt?: Date;
  contractValidUntil?: Date;
  paymentTermDays?: number;
  creditLimit?: string;
  notes?: string;
}

export interface CreateCustomerConcreteRecipeInput {
  name: string;
  concreteGrade: string;
  basisVolume: string;
  binderMassKg: string;
  additiveFormulaVersionId: string;
  additiveDosagePercent: string;
  notes?: string;
  components: Array<{
    name: string;
    quantity: string;
    unit: Unit;
    note?: string;
    position?: number;
  }>;
}

const customerInclude = {
  concreteRecipes: {
    include: {
      components: { orderBy: { position: "asc" as const } },
      additiveFormulaVersion: {
        include: { formula: true },
      },
    },
    orderBy: [{ concreteGrade: "asc" as const }, { name: "asc" as const }],
  },
} satisfies Prisma.CustomerInclude;

type CustomerWithRecipes = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;

export async function listCustomers(workspaceId: string) {
  const [customers, receivables, oneCFinance] = await Promise.all([
    prisma.customer.findMany({
      where: { workspaceId },
      include: customerInclude,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.accountingDocument.findMany({
      where: {
        workspaceId,
        type: AccountingDocumentType.PAYMENT_INVOICE,
        status: AccountingDocumentStatus.ISSUED,
        customerId: { not: null },
      },
      select: { customerId: true, currency: true, totalAmount: true, dueAt: true },
    }),
    loadOneCFinance(workspaceId),
  ]);
  const receivableByCustomer = oneCFinance === null ? summarizeReceivables(receivables) : oneCReceivablesByCustomer(oneCFinance);
  const items = customers.map((customer) => ({
    ...serializeCustomer(customer),
    receivables: receivableByCustomer.get(customer.id) ?? [],
  }));
  return {
    items,
    summary: {
      activeCustomers: customers.filter((customer) => customer.active).length,
      concreteRecipes: customers.reduce((count, customer) => count + customer.concreteRecipes.length, 0),
      formulasInUse: new Set(customers.flatMap((customer) => customer.concreteRecipes.map((recipe) => recipe.additiveFormulaVersionId))).size,
    },
  };
}

export async function getCustomer(workspaceId: string, customerId: string) {
  const [customer, receivables, transfers, documents, oneCFinance] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, workspaceId },
      include: customerInclude,
    }),
    prisma.accountingDocument.findMany({
      where: {
        workspaceId,
        customerId,
        type: AccountingDocumentType.PAYMENT_INVOICE,
        status: AccountingDocumentStatus.ISSUED,
      },
      select: { customerId: true, currency: true, totalAmount: true, dueAt: true },
    }),
    prisma.lrtTransfer.findMany({
      where: { workspaceId, customerId },
      select: {
        id: true,
        number: true,
        status: true,
        transferAt: true,
        sentAt: true,
        acceptedAt: true,
        transport: true,
        items: { select: { requestedQuantity: true, unit: true } },
      },
    }),
    prisma.accountingDocument.findMany({
      where: { workspaceId, customerId },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        documentAt: true,
        issuedAt: true,
        paidAt: true,
        dueAt: true,
        totalAmount: true,
        currency: true,
        transfer: { select: { id: true, number: true } },
      },
    }),
    loadOneCFinance(workspaceId),
  ]);
  if (customer === null) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Клиент не найден");
  const customerReceivables = (oneCFinance === null ? summarizeReceivables(receivables) : oneCReceivablesByCustomer(oneCFinance)).get(customerId) ?? [];
  return {
    ...serializeCustomer(customer),
    receivables: customerReceivables,
    timeline: buildCustomerTimeline(customer, transfers, documents, customerReceivables),
  };
}

export async function createCustomer(
  workspaceId: string,
  actorId: string,
  input: CreateCustomerInput,
) {
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.customer.findFirst({
      where: { workspaceId, name: { equals: input.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate !== null) throw new ApiError(409, "CUSTOMER_ALREADY_EXISTS", "Клиент с таким названием уже существует");
    const customer = await tx.customer.create({
      data: {
        workspaceId,
        name: input.name,
        taxId: input.taxId ?? null,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        contractNumber: input.contractNumber ?? null,
        contractSignedAt: input.contractSignedAt ?? null,
        contractValidUntil: input.contractValidUntil ?? null,
        paymentTermDays: input.paymentTermDays ?? null,
        creditLimit: input.creditLimit ?? null,
        notes: input.notes ?? null,
      },
      include: customerInclude,
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "CUSTOMER_CREATED",
      entityType: AuditEntityType.CUSTOMER,
      entityId: customer.id,
      after: {
        name: customer.name,
        taxId: customer.taxId,
        contactPerson: customer.contactPerson,
      },
    });
    return { ...serializeCustomer(customer), receivables: [] };
  });
}

export async function updateCustomer(
  workspaceId: string,
  actorId: string,
  customerId: string,
  input: Partial<CreateCustomerInput> & { active?: boolean },
) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: customerId, workspaceId }, include: customerInclude });
    if (customer === null) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Клиент не найден");
    if (input.name !== undefined && input.name.toLocaleLowerCase("ru") !== customer.name.toLocaleLowerCase("ru")) {
      const duplicate = await tx.customer.findFirst({ where: { workspaceId, name: { equals: input.name, mode: "insensitive" }, NOT: { id: customer.id } }, select: { id: true } });
      if (duplicate !== null) throw new ApiError(409, "CUSTOMER_ALREADY_EXISTS", "Клиент с таким названием уже существует");
    }
    const updated = await tx.customer.update({
      where: { id: customer.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.taxId === undefined ? {} : { taxId: input.taxId }),
        ...(input.contactPerson === undefined ? {} : { contactPerson: input.contactPerson }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.contractNumber === undefined ? {} : { contractNumber: input.contractNumber }),
        ...(input.contractSignedAt === undefined ? {} : { contractSignedAt: input.contractSignedAt }),
        ...(input.contractValidUntil === undefined ? {} : { contractValidUntil: input.contractValidUntil }),
        ...(input.paymentTermDays === undefined ? {} : { paymentTermDays: input.paymentTermDays }),
        ...(input.creditLimit === undefined ? {} : { creditLimit: input.creditLimit }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      include: customerInclude,
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "CUSTOMER_UPDATED",
      entityType: AuditEntityType.CUSTOMER,
      entityId: customer.id,
      before: { name: customer.name, paymentTermDays: customer.paymentTermDays, creditLimit: customer.creditLimit?.toString() ?? null },
      after: { name: updated.name, paymentTermDays: updated.paymentTermDays, creditLimit: updated.creditLimit?.toString() ?? null },
    });
    return { ...serializeCustomer(updated), receivables: [] };
  });
}

function summarizeReceivables(rows: Array<{ customerId: string | null; currency: string; totalAmount: Decimal; dueAt: Date | null }>) {
  const now = new Date();
  const grouped = new Map<string, Map<string, { amount: Decimal; overdueAmount: Decimal; invoiceCount: number; nearestDueAt: Date | null }>>();
  for (const row of rows) {
    if (row.customerId === null) continue;
    const byCurrency = grouped.get(row.customerId) ?? new Map();
    const current = byCurrency.get(row.currency) ?? { amount: new Decimal(0), overdueAmount: new Decimal(0), invoiceCount: 0, nearestDueAt: null };
    current.amount = current.amount.add(row.totalAmount.toString());
    if (row.dueAt !== null && row.dueAt < now) current.overdueAmount = current.overdueAmount.add(row.totalAmount.toString());
    if (row.dueAt !== null && (current.nearestDueAt === null || row.dueAt < current.nearestDueAt)) current.nearestDueAt = row.dueAt;
    current.invoiceCount += 1;
    byCurrency.set(row.currency, current);
    grouped.set(row.customerId, byCurrency);
  }
  return new Map([...grouped.entries()].map(([customerId, values]) => [customerId, [...values.entries()].map(([currency, value]) => ({
    currency,
    amount: value.amount.toString(),
    overdueAmount: value.overdueAmount.toString(),
    invoiceCount: value.invoiceCount,
    nearestDueAt: value.nearestDueAt?.toISOString() ?? null,
  }))]));
}

function oneCReceivablesByCustomer(finance: NonNullable<Awaited<ReturnType<typeof loadOneCFinance>>>) {
  const grouped = new Map<string, Array<{ currency: string; amount: string; overdueAmount: string;
    invoiceCount: number; nearestDueAt: string | null }>>();
  for (const row of finance.receivables) {
    if (row.customerId === null) continue;
    grouped.set(row.customerId, [{ currency: row.currency, amount: row.amount,
      overdueAmount: row.overdueAmount, invoiceCount: row.invoiceCount, nearestDueAt: row.nearestDueAt }]);
  }
  return grouped;
}

function buildCustomerTimeline(
  customer: CustomerWithRecipes,
  transfers: Array<{
    id: string;
    number: string;
    status: string;
    transferAt: Date;
    sentAt: Date | null;
    acceptedAt: Date | null;
    transport: string | null;
    items: Array<{ requestedQuantity: Decimal; unit: Unit }>;
  }>,
  documents: Array<{
    id: string;
    number: string;
    type: AccountingDocumentType;
    status: AccountingDocumentStatus;
    documentAt: Date;
    issuedAt: Date | null;
    paidAt: Date | null;
    dueAt: Date | null;
    totalAmount: Decimal;
    currency: string;
    transfer: { id: string; number: string } | null;
  }>,
  receivables: Array<{ currency: string; amount: string; overdueAmount: string; invoiceCount: number; nearestDueAt: string | null }>,
) {
  const documentLabels: Record<AccountingDocumentType, string> = {
    [AccountingDocumentType.WAYBILL]: "Накладная",
    [AccountingDocumentType.PAYMENT_INVOICE]: "Счёт на оплату",
    [AccountingDocumentType.COMPLETION_ACT]: "Акт выполненных работ",
    [AccountingDocumentType.POWER_OF_ATTORNEY]: "Доверенность",
  };
  const events = [
    ...customer.concreteRecipes.map((recipe) => ({
      id: `recipe:${recipe.id}`,
      kind: "CONCRETE_RECIPE" as const,
      occurredAt: recipe.createdAt.toISOString(),
      title: `Состав бетона: ${recipe.name}`,
      description: `${recipe.concreteGrade} · ${recipe.additiveFormulaVersion.formula.name} · дозировка ${recipe.additiveDosagePercent.toString()}%`,
      status: null,
      amount: null,
      currency: null,
      relatedId: recipe.id,
    })),
    ...transfers.map((transfer) => {
      const quantities = new Map<Unit, Decimal>();
      for (const item of transfer.items) {
        quantities.set(item.unit, (quantities.get(item.unit) ?? new Decimal(0)).add(item.requestedQuantity));
      }
      const quantityLabel = [...quantities.entries()]
        .map(([unit, quantity]) => `${quantity.toString()} ${customerTimelineUnitLabel(unit)}`)
        .join(" · ");
      return {
        id: `transfer:${transfer.id}`,
        kind: "TRANSFER" as const,
        occurredAt: (transfer.acceptedAt ?? transfer.sentAt ?? transfer.transferAt).toISOString(),
        title: `Отгрузка №${transfer.number}`,
        description: [quantityLabel, transfer.transport].filter(Boolean).join(" · ") || "Отгрузка клиенту",
        status: transfer.status,
        amount: null,
        currency: null,
        relatedId: transfer.id,
      };
    }),
    ...documents.flatMap((document) => {
      const documentEvent = {
        id: `document:${document.id}`,
        kind: document.type === AccountingDocumentType.WAYBILL ? "WAYBILL" as const : "DOCUMENT" as const,
        occurredAt: (document.issuedAt ?? document.documentAt).toISOString(),
        title: `${documentLabels[document.type]} №${document.number}`,
        description: [document.transfer === null ? null : `Отгрузка №${document.transfer.number}`, document.dueAt === null ? null : `срок ${document.dueAt.toLocaleDateString("ru-RU")}`].filter(Boolean).join(" · ") || "Первичный документ",
        status: document.status,
        amount: document.totalAmount.toString(),
        currency: document.currency,
        relatedId: document.id,
      };
      if (document.type !== AccountingDocumentType.PAYMENT_INVOICE || document.status !== AccountingDocumentStatus.PAID || document.paidAt === null) {
        return [documentEvent];
      }
      return [documentEvent, {
        id: `payment:${document.id}`,
        kind: "PAYMENT" as const,
        occurredAt: document.paidAt.toISOString(),
        title: `Оплата по счёту №${document.number}`,
        description: "Оплата отмечена в бухгалтерии",
        status: document.status,
        amount: document.totalAmount.toString(),
        currency: document.currency,
        relatedId: document.id,
      }];
    }),
    ...receivables.map((receivable) => ({
      id: `debt:${receivable.currency}`,
      kind: "DEBT" as const,
      occurredAt: new Date().toISOString(),
      title: "Текущая дебиторская задолженность",
      description: `${receivable.invoiceCount} ${customerTimelineInvoiceLabel(receivable.invoiceCount)}${Number(receivable.overdueAmount) > 0 ? ` · просрочено ${receivable.overdueAmount}` : ""}`,
      status: Number(receivable.overdueAmount) > 0 ? "OVERDUE" : "OPEN",
      amount: receivable.amount,
      currency: receivable.currency,
      relatedId: null,
    })),
  ];
  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function customerTimelineUnitLabel(unit: Unit): string {
  return {
    [Unit.G]: "г",
    [Unit.KG]: "кг",
    [Unit.T]: "т",
    [Unit.ML]: "мл",
    [Unit.L]: "л",
    [Unit.M3]: "м³",
    [Unit.PCS]: "шт.",
  }[unit];
}

function customerTimelineInvoiceLabel(count: number): string {
  const remainder = count % 100;
  if (remainder >= 11 && remainder <= 14) return "счетов";
  if (count % 10 === 1) return "счёт";
  if (count % 10 >= 2 && count % 10 <= 4) return "счёта";
  return "счетов";
}

export async function createCustomerConcreteRecipe(
  workspaceId: string,
  actorId: string,
  customerId: string,
  input: CreateCustomerConcreteRecipeInput,
) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, workspaceId, active: true },
      select: { id: true },
    });
    if (customer === null) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Активный клиент не найден");

    const formulaVersion = await tx.formulaVersion.findFirst({
      where: { id: input.additiveFormulaVersionId, workspaceId, formula: { active: true } },
      include: { formula: true, components: { select: { id: true } } },
    });
    if (formulaVersion === null) throw new ApiError(404, "ADDITIVE_FORMULA_NOT_FOUND", "Формула добавки не найдена");
    if (formulaVersion.dosagePercent === null || formulaVersion.components.length === 0) {
      throw new ApiError(422, "ADDITIVE_RECIPE_REQUIRED", "У выбранной формулы нет рецептуры добавки");
    }

    const dosage = new Decimal(input.additiveDosagePercent);
    if (dosage.lte(0) || dosage.gt(100)) {
      throw new ApiError(400, "INVALID_CUSTOMER_DOSAGE", "Процент добавки должен быть больше 0 и не больше 100%");
    }
    const normalizedComponentNames = input.components.map((component) => component.name.trim().toLocaleLowerCase("ru"));
    if (new Set(normalizedComponentNames).size !== normalizedComponentNames.length) {
      throw new ApiError(400, "DUPLICATE_CONCRETE_COMPONENT", "Компонент бетона нельзя добавить дважды");
    }
    const duplicate = await tx.customerConcreteRecipe.findFirst({
      where: { customerId, name: { equals: input.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate !== null) throw new ApiError(409, "CUSTOMER_RECIPE_ALREADY_EXISTS", "Состав с таким названием уже есть у клиента");

    const recipe = await tx.customerConcreteRecipe.create({
      data: {
        workspaceId,
        customerId,
        name: input.name,
        concreteGrade: input.concreteGrade,
        basisVolume: input.basisVolume,
        basisUnit: Unit.M3,
        binderMassKg: input.binderMassKg,
        additiveFormulaVersionId: input.additiveFormulaVersionId,
        additiveDosagePercent: input.additiveDosagePercent,
        notes: input.notes ?? null,
        components: {
          create: input.components.map((component, index) => ({
            name: component.name,
            quantity: component.quantity,
            unit: component.unit,
            note: component.note ?? null,
            position: component.position ?? index,
          })),
        },
      },
      include: {
        components: { orderBy: { position: "asc" } },
        additiveFormulaVersion: { include: { formula: true } },
      },
    });
    const serialized = serializeConcreteRecipe(recipe);
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "CUSTOMER_CONCRETE_RECIPE_CREATED",
      entityType: AuditEntityType.CUSTOMER_CONCRETE_RECIPE,
      entityId: recipe.id,
      after: {
        customerId,
        name: recipe.name,
        concreteGrade: recipe.concreteGrade,
        basisVolume: recipe.basisVolume.toString(),
        binderMassKg: recipe.binderMassKg.toString(),
        additiveFormulaVersionId: recipe.additiveFormulaVersionId,
        additiveDosagePercent: recipe.additiveDosagePercent.toString(),
        additiveQuantityKg: serialized.additiveQuantityKg,
        components: recipe.components.map((component) => ({
          name: component.name,
          quantity: component.quantity.toString(),
          unit: component.unit,
        })),
      },
    });
    return serialized;
  });
}

function serializeCustomer(customer: CustomerWithRecipes) {
  return {
    ...customer,
    concreteRecipes: customer.concreteRecipes.map(serializeConcreteRecipe),
  };
}

function serializeConcreteRecipe(recipe: CustomerWithRecipes["concreteRecipes"][number]) {
  const additiveQuantityKg = recipe.binderMassKg.mul(recipe.additiveDosagePercent).div(100);
  const additiveQuantityPerM3Kg = additiveQuantityKg.div(recipe.basisVolume);
  return {
    ...recipe,
    additiveQuantityKg: additiveQuantityKg.toDecimalPlaces(6).toString(),
    additiveQuantityPerM3Kg: additiveQuantityPerM3Kg.toDecimalPlaces(6).toString(),
    recommendedDosagePercent: recipe.additiveFormulaVersion.dosagePercent?.toString() ?? null,
  };
}
