#!/usr/bin/env node
/**
 * OpenFox CLI
 *
 * Creator-facing CLI for interacting with OpenFox.
 * Usage: openfox-cli <command> [args]
 */

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case "status":
      await import("./commands/status.js");
      break;
    case "logs":
      await import("./commands/logs.js");
      break;
    case "fund":
      await import("./commands/fund.js");
      break;
    case "send":
      await import("./commands/send.js");
      break;
    case "tos-status":
      await import("./commands/tos-status.js");
      break;
    case "tos-send":
      await import("./commands/tos-send.js");
      break;
    default:
      console.log(`
OpenFox CLI - Creator Tools

Usage:
  openfox-cli status              Show OpenFox status
  openfox-cli logs [--tail N]     View OpenFox logs
  openfox-cli fund <amount> [--to 0x...]  Legacy Runtime credits transfer
  openfox-cli send <to-address> <message> Send a social message
  openfox-cli tos-status          Show native wallet status
  openfox-cli tos-send <to> <amount> [--wait]   Send a native transfer
`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
