import {
  AuditEntityType,
  type Unit,
  type WagonStatus,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";

export interface CreateWagonInput {
  number: string;
  type: string;
  capacity: string;
  capacityUnit: Unit;
  tareWeightT?: string;
  status: WagonStatus;
  location: string;
  cargoDescription?: string;
  cargoQuantity: string;
  cargoUnit: Unit;
  shipmentNumber?: string;
  lastReportedAt: Date;
  note?: string;
}

export interface WagonLocationInput {
  status: WagonStatus;
  location: string;
  cargoDescription?: string;
  cargoQuantity: string;
  cargoUnit: Unit;
  shipmentNumber?: string;
  occurredAt: Date;
  note?: string;
}

export async function createWagon(
  workspaceId: string,
  actorId: string,
  input: CreateWagonInput,
) {
  return prisma.$transaction(async (tx) => {
    const wagon = await tx.wagon.create({
      data: {
        workspaceId,
        number: input.number,
        type: input.type,
        capacity: input.capacity,
        capacityUnit: input.capacityUnit,
        ...(input.tareWeightT === undefined ? {} : { tareWeightT: input.tareWeightT }),
        status: input.status,
        currentLocation: input.location,
        cargoDescription: input.cargoDescription ?? null,
        cargoQuantity: input.cargoQuantity,
        cargoUnit: input.cargoUnit,
        shipmentNumber: input.shipmentNumber ?? null,
        lastReportedAt: input.lastReportedAt,
        locationEvents: {
          create: {
            workspaceId,
            actorId,
            status: input.status,
            location: input.location,
            cargoDescription: input.cargoDescription ?? null,
            cargoQuantity: input.cargoQuantity,
            cargoUnit: input.cargoUnit,
            shipmentNumber: input.shipmentNumber ?? null,
            occurredAt: input.lastReportedAt,
            note: input.note ?? "Вагон добавлен в дислокацию",
          },
        },
      },
      include: {
        locationEvents: { include: { actor: { select: { id: true, name: true } } } },
      },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "WAGON_CREATED",
      entityType: AuditEntityType.WAGON,
      entityId: wagon.id,
      after: {
        number: wagon.number,
        status: wagon.status,
        currentLocation: wagon.currentLocation,
      },
    });
    return wagon;
  });
}

export async function recordWagonLocation(
  workspaceId: string,
  actorId: string,
  wagonId: string,
  input: WagonLocationInput,
) {
  return prisma.$transaction(async (tx) => {
    const wagon = await tx.wagon.findFirst({ where: { id: wagonId, workspaceId, active: true } });
    if (wagon === null) throw new ApiError(404, "WAGON_NOT_FOUND", "Вагон не найден");

    const event = await tx.wagonLocationEvent.create({
      data: {
        workspaceId,
        wagonId: wagon.id,
        actorId,
        status: input.status,
        location: input.location,
        cargoDescription: input.cargoDescription ?? null,
        cargoQuantity: input.cargoQuantity,
        cargoUnit: input.cargoUnit,
        shipmentNumber: input.shipmentNumber ?? null,
        occurredAt: input.occurredAt,
        note: input.note ?? null,
      },
      include: { actor: { select: { id: true, name: true } } },
    });
    const updated = await tx.wagon.update({
      where: { id: wagon.id },
      data: {
        status: input.status,
        currentLocation: input.location,
        cargoDescription: input.cargoDescription ?? null,
        cargoQuantity: input.cargoQuantity,
        cargoUnit: input.cargoUnit,
        shipmentNumber: input.shipmentNumber ?? null,
        lastReportedAt: input.occurredAt,
      },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "WAGON_LOCATION_RECORDED",
      entityType: AuditEntityType.WAGON,
      entityId: wagon.id,
      before: {
        status: wagon.status,
        currentLocation: wagon.currentLocation,
        cargoQuantity: wagon.cargoQuantity.toString(),
      },
      after: {
        eventId: event.id,
        status: updated.status,
        currentLocation: updated.currentLocation,
        cargoQuantity: updated.cargoQuantity.toString(),
        shipmentNumber: updated.shipmentNumber,
      },
    });
    return { ...updated, latestEvent: event };
  });
}
