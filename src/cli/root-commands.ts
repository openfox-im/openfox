import { handleSkillsCommand } from "../commands/skills.js";
import { handleHeartbeatCommand } from "../commands/heartbeat.js";
import { handleCronCommand } from "../commands/cron.js";
import { handleServiceCommand } from "../commands/service.js";
import { handleGatewayCommand } from "../commands/gateway.js";
import { handleHealthCommand, handleDoctorCommand, handleModelsCommand } from "../commands/health.js";
import { handleOnboardCommand } from "../commands/onboard.js";
import { runWalletCommand } from "../commands/wallet.js";
import { handleFinanceCommand } from "../commands/finance.js";
import { handleReportCommand } from "../commands/report.js";
import { handleTemplatesCommand } from "../commands/templates.js";
import { handlePacksCommand } from "../commands/packs.js";
import { handleLogsCommand } from "../commands/logs.js";
import { handleCampaignCommand } from "../commands/campaign.js";
import { handleBountyCommand } from "../commands/bounty.js";
import { handleSettlementCommand } from "../commands/settlement.js";
import { handleMarketCommand } from "../commands/market.js";
import { handlePaymentsCommand } from "../commands/payments.js";
import { handleScoutCommand } from "../commands/scout.js";
import { handleStrategyCommand } from "../commands/strategy.js";
import { handleStorageCommand } from "../commands/storage.js";
import { handleProvidersCommand } from "../commands/providers.js";
import { handleArtifactCommand } from "../commands/artifacts.js";
import { handleEvidenceCommand } from "../commands/evidence.js";
import { handleOracleCommand } from "../commands/oracle.js";
import { handleNewsCommand } from "../commands/news.js";
import { handleProofCommand } from "../commands/proof.js";
import { handleCommitteeCommand } from "../commands/committee.js";
import { handleTrailsCommand } from "../commands/trails.js";
import { handleGroupCommand } from "../commands/group.js";
import { handleWorldCommand } from "../commands/world.js";
import { handleSignerCommand } from "../commands/signer.js";
import { handlePaymasterCommand } from "../commands/paymaster.js";
import { handleFleetCommand } from "../commands/fleet.js";
import { handleAutopilotCommand } from "../commands/autopilot.js";
import { handleDashboardCommand } from "../commands/dashboard.js";
import { handleStatusCommand } from "../commands/status.js";

export type RootCommandHandler = (args: string[]) => Promise<void>;

export interface RootCommandDefinition {
  readonly name: string;
  readonly invocation: string;
  readonly summary: string;
  readonly handler: RootCommandHandler;
}

export const ROOT_COMMANDS: readonly RootCommandDefinition[] = [
  { name: "skills", invocation: "openfox skills ...", summary: "Inspect and manage skills", handler: handleSkillsCommand },
  { name: "heartbeat", invocation: "openfox heartbeat ...", summary: "Inspect and control the heartbeat runtime", handler: handleHeartbeatCommand },
  { name: "cron", invocation: "openfox cron ...", summary: "Inspect and manage scheduled heartbeat tasks", handler: handleCronCommand },
  { name: "service", invocation: "openfox service ...", summary: "Inspect service roles, health, and lifecycle", handler: handleServiceCommand },
  { name: "gateway", invocation: "openfox gateway ...", summary: "Inspect gateway configuration and bootnodes", handler: handleGatewayCommand },
  { name: "health", invocation: "openfox health", summary: "Show a runtime health snapshot", handler: handleHealthCommand },
  { name: "doctor", invocation: "openfox doctor", summary: "Diagnose runtime/operator issues and next steps", handler: handleDoctorCommand },
  { name: "models", invocation: "openfox models ...", summary: "Inspect model/provider readiness", handler: handleModelsCommand },
  { name: "onboard", invocation: "openfox onboard", summary: "Run setup and optionally install the managed service", handler: handleOnboardCommand },
  { name: "wallet", invocation: "openfox wallet ...", summary: "Inspect, fund, and bootstrap the native wallet", handler: runWalletCommand },
  { name: "finance", invocation: "openfox finance ...", summary: "Inspect operator finance snapshots", handler: handleFinanceCommand },
  { name: "report", invocation: "openfox report ...", summary: "Generate, inspect, and deliver owner reports", handler: handleReportCommand },
  { name: "templates", invocation: "openfox templates ...", summary: "Inspect and export bundled third-party templates", handler: handleTemplatesCommand },
  { name: "packs", invocation: "openfox packs ...", summary: "Inspect and export bundled control-plane packs", handler: handlePacksCommand },
  { name: "logs", invocation: "openfox logs", summary: "Show recent OpenFox service logs", handler: handleLogsCommand },
  { name: "campaign", invocation: "openfox campaign ...", summary: "Create and inspect sponsor-facing task campaigns", handler: handleCampaignCommand },
  { name: "bounty", invocation: "openfox bounty ...", summary: "Open, inspect, and solve task bounties", handler: handleBountyCommand },
  { name: "settlement", invocation: "openfox settlement ...", summary: "Inspect on-chain settlement receipts and anchors", handler: handleSettlementCommand },
  { name: "market", invocation: "openfox market ...", summary: "Inspect contract-native market bindings and callbacks", handler: handleMarketCommand },
  { name: "payments", invocation: "openfox payments ...", summary: "Inspect and recover server-side x402 payments", handler: handlePaymentsCommand },
  { name: "scout", invocation: "openfox scout ...", summary: "Discover earning opportunities and task surfaces", handler: handleScoutCommand },
  { name: "strategy", invocation: "openfox strategy ...", summary: "Define and validate bounded earning strategy profiles", handler: handleStrategyCommand },
  { name: "storage", invocation: "openfox storage ...", summary: "Use the OpenFox storage market", handler: handleStorageCommand },
  { name: "providers", invocation: "openfox providers ...", summary: "Inspect provider reputation snapshots", handler: handleProvidersCommand },
  { name: "artifacts", invocation: "openfox artifacts ...", summary: "Build and verify public news and oracle bundles", handler: handleArtifactCommand },
  { name: "evidence", invocation: "openfox evidence ...", summary: "Run coordinator-side M-of-N evidence workflows", handler: handleEvidenceCommand },
  { name: "oracle", invocation: "openfox oracle ...", summary: "Inspect paid oracle results and summaries", handler: handleOracleCommand },
  { name: "news", invocation: "openfox news ...", summary: "Inspect zkTLS-backed news capture bundle records", handler: handleNewsCommand },
  { name: "proof", invocation: "openfox proof ...", summary: "Inspect proof verification records and summaries", handler: handleProofCommand },
  { name: "committee", invocation: "openfox committee ...", summary: "Inspect and manage M-of-N committee workflows", handler: handleCommitteeCommand },
  { name: "trails", invocation: "openfox trails ...", summary: "Inspect runtime audit trails and recovery traces", handler: handleTrailsCommand },
  { name: "group", invocation: "openfox group ...", summary: "Create and inspect local Fox communities", handler: handleGroupCommand },
  { name: "world", invocation: "openfox world ...", summary: "Inspect the local metaWorld activity feed", handler: handleWorldCommand },
  { name: "signer", invocation: "openfox signer ...", summary: "Use delegated signer-provider execution", handler: handleSignerCommand },
  { name: "paymaster", invocation: "openfox paymaster ...", summary: "Use native sponsored execution through a paymaster-provider", handler: handlePaymasterCommand },
  { name: "fleet", invocation: "openfox fleet ...", summary: "Inspect multiple OpenFox nodes through operator APIs", handler: handleFleetCommand },
  { name: "autopilot", invocation: "openfox autopilot ...", summary: "Inspect and control bounded operator automation", handler: handleAutopilotCommand },
  { name: "dashboard", invocation: "openfox dashboard ...", summary: "Build fleet dashboard snapshots and exports", handler: handleDashboardCommand },
  { name: "status", invocation: "openfox status", summary: "Show the current runtime status", handler: handleStatusCommand },
] as const;

const ROOT_COMMAND_MAP = new Map(
  ROOT_COMMANDS.map((command) => [command.name, command] as const),
);

export function findRootCommand(name: string | undefined): RootCommandDefinition | undefined {
  if (!name) {
    return undefined;
  }
  return ROOT_COMMAND_MAP.get(name);
}
