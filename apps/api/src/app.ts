import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { registerErrorHandler } from "./lib/api-error.js";
import { registerMaterialRoutes } from "./routes/materials.js";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerFormulaRoutes } from "./routes/formulas.js";
import { registerBatchRoutes } from "./routes/batches.js";
import { registerTransferRoutes } from "./routes/transfers.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerAdjustmentRoutes } from "./routes/adjustments.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";
import { registerCalculatorRoutes } from "./routes/calculator.js";
import { registerWagonRoutes } from "./routes/wagons.js";
import { registerExpenseRoutes } from "./routes/expenses.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
    },
    requestIdHeader: "x-request-id",
    bodyLimit: 1_048_576,
  });
  await app.register(cors, { origin: config.webOrigin, credentials: false });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: config.rateLimitMax, timeWindow: "1 minute" });
  registerErrorHandler(app);

  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", service: "miracle-chem-api", timestamp: new Date().toISOString() };
  });

  await app.register(async (api) => {
    await registerMetaRoutes(api);
    await registerMaterialRoutes(api);
    await registerRecipeRoutes(api);
    await registerFormulaRoutes(api);
    await registerBatchRoutes(api);
    await registerTransferRoutes(api);
    await registerReportRoutes(api);
    await registerProductRoutes(api);
    await registerAdjustmentRoutes(api);
    await registerAttachmentRoutes(api);
    await registerCalculatorRoutes(api);
    await registerWagonRoutes(api);
    await registerExpenseRoutes(api);
  }, { prefix: "/api" });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
  return app;
}
