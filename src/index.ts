#!/usr/bin/env node
import { createLogger } from "./observability/logger.js";
import { runCli } from "./cli/main.js";

const logger = createLogger("main");
runCli(process.argv.slice(2)).catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
