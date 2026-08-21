import { Logger } from "@nestjs/common";
import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();
const logger = new Logger("Bootstrap");

try {
  await app.listen(config.port, config.host);
  logger.log(`Miracle Chem API listening on http://${config.host}:${config.port}`);
} catch (error) {
  logger.error(error);
  await app.close();
  process.exitCode = 1;
}
