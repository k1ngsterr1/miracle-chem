import { Controller, Get, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { prisma } from "./lib/prisma.js";
import { AdjustmentController } from "./routes/adjustments.js";
import { AttachmentController } from "./routes/attachments.js";
import { BatchController } from "./routes/batches.js";
import { CalculatorController } from "./routes/calculator.js";
import { ExpenseController } from "./routes/expenses.js";
import { FormulaController } from "./routes/formulas.js";
import { MaterialController } from "./routes/materials.js";
import { MetaController } from "./routes/meta.js";
import { ProductController } from "./routes/products.js";
import { RecipeController } from "./routes/recipes.js";
import { ReportController } from "./routes/reports.js";
import { TransferController } from "./routes/transfers.js";
import { WagonController } from "./routes/wagons.js";

@Controller()
class HealthController {
  @Get("health")
  async health() {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", service: "miracle-chem-api", framework: "nestjs", timestamp: new Date().toISOString() };
  }
}

@Injectable()
class PrismaLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await prisma.$disconnect();
  }
}

@Module({
  controllers: [
    HealthController,
    MetaController,
    MaterialController,
    RecipeController,
    FormulaController,
    BatchController,
    TransferController,
    ReportController,
    ProductController,
    AdjustmentController,
    AttachmentController,
    CalculatorController,
    WagonController,
    ExpenseController,
  ],
  providers: [PrismaLifecycle],
})
export class AppModule {}
