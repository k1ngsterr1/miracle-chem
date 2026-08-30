import { Unit, UserRole } from "../src/generated/prisma/index.js";
import {
  DEFAULT_ACTOR_ID,
  DEFAULT_PRODUCTION_LINE_ID,
  DEFAULT_PRODUCTION_TANK_ID,
  DEFAULT_WORKSPACE_ID,
} from "../src/config.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

async function main(): Promise<void> {
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (password === undefined || password.length < 8) {
    throw new Error("DEFAULT_ADMIN_PASSWORD must contain at least 8 characters");
  }
  const passwordHash = hashPassword(password);
  await prisma.workspace.upsert({
    where: { id: DEFAULT_WORKSPACE_ID },
    create: {
      id: DEFAULT_WORKSPACE_ID,
      name: "ТОО \"Miracle Chem\"",
      timezone: "Asia/Almaty",
      currency: "KZT",
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { id: DEFAULT_ACTOR_ID },
    create: {
      id: DEFAULT_ACTOR_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: "Администратор Miracle Chem",
      email: "admin@miracle-chem.local",
      passwordHash,
      role: UserRole.ADMIN,
    },
    update: { passwordHash },
  });

  await prisma.productionLine.upsert({
    where: { id: DEFAULT_PRODUCTION_LINE_ID },
    create: {
      id: DEFAULT_PRODUCTION_LINE_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      code: "LINE-01",
      name: "Линия №1",
      capacity: "0",
      capacityUnit: Unit.M3,
    },
    update: { code: "LINE-01", name: "Линия №1", active: true },
  });

  await prisma.productionTank.upsert({
    where: { id: DEFAULT_PRODUCTION_TANK_ID },
    create: {
      id: DEFAULT_PRODUCTION_TANK_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      productionLineId: DEFAULT_PRODUCTION_LINE_ID,
      code: "TANK-01",
      name: "Чан №1",
      capacityUnit: Unit.M3,
    },
    update: {
      productionLineId: DEFAULT_PRODUCTION_LINE_ID,
      code: "TANK-01",
      name: "Чан №1",
      active: true,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
