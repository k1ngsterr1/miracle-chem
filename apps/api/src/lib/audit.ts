import type { Prisma } from "../generated/prisma/index.js";
import type { AuditEntityType } from "../generated/prisma/index.js";

interface AuditInput {
  workspaceId: string;
  actorId?: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.before === undefined ? {} : { before: input.before }),
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    },
  });
}

