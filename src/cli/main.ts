import { getWallet, getOpenFoxDir } from "../identity/wallet.js";
import { provision } from "../identity/provision.js";
import { deriveAddressFromPrivateKey } from "../chain/address.js";
import { createLogger, StructuredLogger } from "../observability/logger.js";
import { prettySink } from "../observability/pretty-sink.js";
import { showStatus } from "../commands/status.js";
import { run } from "../runtime/run.js";
import { buildRootHelp } from "./root-help.js";
import { findRootCommand } from "./root-commands.js";

const logger = createLogger("main");

export const OPENFOX_VERSION = "0.2.1";

interface RootActionDefinition {
  readonly matches: (args: string[]) => boolean;
  readonly run: (args: string[]) => Promise<void>;
}

const ROOT_ACTIONS: readonly RootActionDefinition[] = [
  {
    matches: (args) => args.includes("--init"),
    run: async () => {
      const { privateKey, isNew } = await getWallet();
      const address = deriveAddressFromPrivateKey(privateKey);
      logger.info(
        JSON.stringify({
          address,
          isNew,
          configDir: getOpenFoxDir(),
        }),
      );
    },
  },
  {
    matches: (args) => args.includes("--provision"),
    run: async () => {
      try {
        const result = await provision();
        logger.info(JSON.stringify(result));
      } catch (err: any) {
        throw new Error(`Provision failed: ${err.message}`);
      }
    },
  },
  {
    matches: (args) => args.includes("--status"),
    run: async (args) => {
      await showStatus({ asJson: args.includes("--json") });
    },
  },
  {
    matches: (args) => args.includes("--setup"),
    run: async () => {
      const { runSetupWizard } = await import("../setup/wizard.js");
      await runSetupWizard();
    },
  },
  {
    matches: (args) => args.includes("--pick-model"),
    run: async () => {
      const { runModelPicker } = await import("../setup/model-picker.js");
      await runModelPicker();
    },
  },
  {
    matches: (args) => args.includes("--configure"),
    run: async () => {
      const { runConfigure } = await import("../setup/configure.js");
      await runConfigure();
    },
  },
  {
    matches: (args) => args.includes("--run"),
    run: async () => {
      StructuredLogger.setSink(prettySink);
      await run();
    },
  },
] as const;

export async function runCli(args: string[]): Promise<void> {
  if (args.includes("--version") || args.includes("-v")) {
    logger.info(`OpenFox v${OPENFOX_VERSION}`);
    return;
  }

  const command = findRootCommand(args[0]);
  if (command) {
    await command.handler(args.slice(1));
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    logger.info(buildRootHelp(OPENFOX_VERSION));
    return;
  }

  for (const action of ROOT_ACTIONS) {
    if (action.matches(args)) {
      await action.run(args);
      return;
    }
  }

  logger.info('Run "openfox --help" for usage information.');
  logger.info('Run "openfox --run" to start the openfox.');
}
