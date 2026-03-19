import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { readCsvOption, readOption, readNumberOption } from "../cli/parse.js";
import {
  buildWorldFeedSnapshot,
} from "../metaworld/feed.js";
import {
  buildWorldBoardSnapshot,
  type WorldBoardKind,
} from "../metaworld/boards.js";
import {
  buildWorldFoxDirectorySnapshot,
  buildWorldGroupDirectorySnapshot,
} from "../metaworld/directory.js";
import {
  buildFoxProfile,
} from "../metaworld/profile.js";
import {
  buildFoxPageSnapshot,
  buildFoxPageHtml,
} from "../metaworld/fox-page.js";
import {
  buildGroupPageSnapshot,
  buildGroupPageHtml,
} from "../metaworld/group-page.js";
import {
  buildArtifactPageSnapshot,
  buildArtifactPageHtml,
} from "../metaworld/artifact-page.js";
import {
  buildSettlementPageSnapshot,
  buildSettlementPageHtml,
} from "../metaworld/settlement-page.js";
import {
  buildWorldPresenceSnapshot,
  publishWorldPresence,
  type WorldPresenceStatus,
} from "../metaworld/presence.js";
import {
  buildWorldNotificationsSnapshot,
  dismissWorldNotification,
  markWorldNotificationRead,
} from "../metaworld/notifications.js";
import {
  buildMetaWorldShellHtml,
  buildMetaWorldShellSnapshot,
} from "../metaworld/shell.js";
import {
  exportMetaWorldSite,
} from "../metaworld/site.js";
import { startMetaWorldServer } from "../metaworld/server.js";
import {
  exportMetaWorldDemoBundle,
  validateMetaWorldDemoBundle,
} from "../metaworld/demo.js";
import {
  followFox,
  unfollowFox,
  followGroup,
  unfollowGroup,
  listFollowedFoxes,
  listFollowedGroups,
  listFoxFollowers,
  getFollowCounts,
} from "../metaworld/follows.js";
import {
  listSubscriptions,
  subscribeToFeed,
  unsubscribe,
  type SubscriptionEventKind,
  type SubscriptionFeedKind,
} from "../metaworld/subscriptions.js";
import {
  buildSearchResultSnapshot,
} from "../metaworld/search.js";
import {
  buildGroupGovernanceHtml,
  buildGroupGovernanceSnapshot,
} from "../metaworld/governance.js";
import {
  buildGroupTreasuryHtml,
  buildGroupTreasurySnapshot,
} from "../metaworld/treasury.js";
import {
  addMetaWorldFederationPeer,
  buildMetaWorldPublicationHtml,
  buildMetaWorldPublicationSnapshot,
  listMetaWorldFederationPeers,
  refreshMetaWorldFederationPeer,
  registerMetaWorldSitePublication,
  registerMetaWorldSitePublicationFromOutputDir,
} from "../metaworld/publication.js";
import {
  buildPersonalizedFeedSnapshot,
  buildRecommendedFoxes,
  buildRecommendedGroups,
} from "../metaworld/ranking.js";
import {
  buildFoxPublicProfile,
  publishFoxProfile,
  updateFoxProfileFieldForAddress,
  buildGroupPublicProfile,
  publishGroupProfile,
  buildFoxReputationSummary,
} from "../metaworld/identity.js";
import {
  getReputationCard,
  getReputationLeaderboard,
  findTrustPath,
  type ReputationDimension,
  type ReputationEntityType,
} from "../metaworld/reputation.js";
import {
  createIntent,
  getIntent,
  listIntents,
  respondToIntent,
  listIntentResponses,
  acceptIntentResponse,
  approveIntentCompletion,
  cancelIntent,
  type IntentKind,
  type IntentStatus,
} from "../metaworld/intents.js";
import {
  addFederationPeer,
  removeFederationPeer,
  listFederationPeers as listFedPeers,
  buildFederationSnapshot,
} from "../metaworld/federation.js";
import fs from "fs/promises";
import path from "path";

const logger = createLogger("world");

function readSubscriptionFeedKind(value: string | undefined): SubscriptionFeedKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value !== "fox" && value !== "group" && value !== "board") {
    throw new Error("Invalid subscription kind: expected fox, group, or board");
  }
  return value;
}

function readNotifyOnValues(
  args: string[],
  feedKind: SubscriptionFeedKind,
): SubscriptionEventKind[] {
  const raw = readCsvOption(args, "--notify-on");
  const fallbackByKind: Record<SubscriptionFeedKind, SubscriptionEventKind[]> = {
    fox: ["announcement", "message", "bounty", "artifact", "settlement"],
    group: ["announcement", "message"],
    board: ["bounty", "artifact", "settlement"],
  };
  const values = raw ?? fallbackByKind[feedKind];
  const valid: SubscriptionEventKind[] = [
    "announcement",
    "message",
    "bounty",
    "artifact",
    "settlement",
  ];
  for (const value of values) {
    if (!valid.includes(value as SubscriptionEventKind)) {
      throw new Error(
        `Invalid --notify-on value: ${value}. Expected announcement,message,bounty,artifact,settlement.`,
      );
    }
  }
  return values as SubscriptionEventKind[];
}

export async function handleWorldCommand(args: string[]): Promise<void> {
  const command = args[0] || "feed";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox world

Usage:
  openfox world feed [--group <group-id>] [--subscribed-only] [--limit N] [--json]
  openfox world board list --kind <work|opportunity|artifact|settlement> [--limit N] [--json]
  openfox world directory foxes [--query <text>] [--role <role>] [--limit N] [--json]
  openfox world directory groups [--query <text>] [--visibility <private|listed|public>] [--tag <tag>] [--role <role>] [--limit N] [--json]
  openfox world fox profile [--address <addr>] [--activity-limit N] [--json]
  openfox world fox page [--address <addr>] [--activity-limit N] [--messages N] [--announcements N] [--presence N] [--json]
  openfox world fox page export --output <path> [--address <addr>] [--activity-limit N] [--messages N] [--announcements N] [--presence N] [--json]
  openfox world group page --group <group-id> [--messages N] [--announcements N] [--events N] [--presence N] [--json]
  openfox world group page export --group <group-id> --output <path> [--messages N] [--announcements N] [--events N] [--presence N] [--json]
  openfox world artifact page --artifact <artifact-id> [--settlements N] [--json]
  openfox world artifact page export --artifact <artifact-id> --output <path> [--settlements N] [--json]
  openfox world settlement page --receipt <receipt-id> [--artifacts N] [--json]
  openfox world settlement page export --receipt <receipt-id> --output <path> [--artifacts N] [--json]
  openfox world shell [--feed N] [--notifications N] [--boards N] [--directory N] [--groups N] [--json]
  openfox world shell export --output <path> [--feed N] [--notifications N] [--boards N] [--directory N] [--groups N] [--json]
  openfox world site export --output-dir <path> [--foxes N] [--groups N] [--base-url <url>] [--label <text>] [--json]
  openfox world publication [--json]
  openfox world publication site register --output-dir <path> [--base-url <url>] [--label <text>] [--json]
  openfox world publication peer add --manifest-url <url> [--base-url <url>] [--label <text>] [--json]
  openfox world publication peer refresh --id <peer-id> [--json]
  openfox world publication peers [--json]
  openfox world demo export --output-dir <path> [--force] [--json]
  openfox world demo validate --bundle <path> [--json]
  openfox world serve [--port N] [--host <addr>]
  openfox world presence publish [--group <group-id>] [--status <online|busy|away|recently_active>] [--ttl-seconds N] [--summary "<text>"] [--json]
  openfox world presence list [--group <group-id>] [--status <all|online|busy|away|recently_active|expired>] [--include-expired] [--limit N] [--json]
  openfox world notifications [--group <group-id>] [--status <all|unread>] [--subscribed-only] [--include-dismissed] [--limit N] [--json]
  openfox world notification read --id <notification-id> [--json]
  openfox world notification dismiss --id <notification-id> [--json]
  openfox world follow fox --address <addr> [--json]
  openfox world unfollow fox --address <addr> [--json]
  openfox world follow group --group <id> [--json]
  openfox world unfollow group --group <id> [--json]
  openfox world following [--json]
  openfox world followers [--json]
  openfox world subscribe fox --address <addr> [--notify-on announcement,message,bounty,artifact,settlement] [--json]
  openfox world subscribe group --group <id> [--notify-on announcement,message] [--json]
  openfox world subscribe board --board <work|opportunity|artifact|settlement> [--notify-on bounty,artifact,settlement] [--json]
  openfox world subscriptions [--kind fox|group|board] [--json]
  openfox world unsubscribe --id <subscription-id> [--json]
  openfox world search <query> [--kind fox|group|board_item] [--limit N] [--json]
  openfox world recommended foxes [--limit N] [--json]
  openfox world recommended groups [--limit N] [--json]
  openfox world personalized-feed [--limit N] [--json]
  openfox world profile set --bio "text"
  openfox world profile set --avatar-url "url"
  openfox world profile set --website "url"
  openfox world profile set --tags "tag1,tag2"
  openfox world profile set --social "twitter:@handle,github:user"
  openfox world profile publish [--json]
  openfox world profile show [--address <addr>] [--json]
  openfox world group profile publish --group <id> [--json]
  openfox world governance [--group <group-id>] [--proposals N] [--requests N] [--json]
  openfox world governance export --group <group-id> --output <path> [--proposals N] [--requests N] [--json]
  openfox world treasury [--group <group-id>] [--campaigns N] [--bounties N] [--settlements N] [--json]
  openfox world treasury export --group <group-id> --output <path> [--campaigns N] [--bounties N] [--settlements N] [--json]
  openfox world reputation [--address <addr>] [--json]
  openfox world intent create --title <t> --kind <k> [--group <g>] [--budget <b>] [--expires <h>] [--json]
  openfox world intent list [--kind <k>] [--status <s>] [--group <g>] [--json]
  openfox world intent show <id> [--json]
  openfox world intent respond <id> [--proposal <text>] [--json]
  openfox world intent accept <id> --solver <addr> [--json]
  openfox world intent approve <id> [--json]
  openfox world intent cancel <id> [--json]
  openfox world federation peers [--json]
  openfox world federation add-peer <url> [--address <addr>] [--json]
  openfox world federation remove-peer <peer-id> [--json]
  openfox world federation status [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "feed") {
      const snapshot = buildWorldFeedSnapshot(db, {
        groupId: readOption(args, "--group"),
        limit: readNumberOption(args, "--limit", 25),
        subscriberAddress: config.walletAddress,
        subscribedOnly: args.includes("--subscribed-only"),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX WORLD FEED ===");
      logger.info(snapshot.summary);
      for (const item of snapshot.items) {
        const groupLabel = item.groupName ? ` [${item.groupName}]` : "";
        logger.info(`${item.occurredAt}  ${item.kind}${groupLabel}`);
        logger.info(`  ${item.title}`);
        logger.info(`  ${item.summary}`);
      }
      return;
    }

    if (command === "notifications") {
      const status = readOption(args, "--status") || "all";
      if (status !== "all" && status !== "unread") {
        throw new Error("Invalid --status value: expected all or unread");
      }
      const snapshot = buildWorldNotificationsSnapshot(db, {
        actorAddress: config.walletAddress,
        groupId: readOption(args, "--group"),
        limit: readNumberOption(args, "--limit", 25),
        unreadOnly: status === "unread",
        subscribedOnly: args.includes("--subscribed-only"),
        includeDismissed: args.includes("--include-dismissed"),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX WORLD NOTIFICATIONS ===");
      logger.info(snapshot.summary);
      for (const item of snapshot.items) {
        const stateLabel = item.dismissedAt
          ? "dismissed"
          : item.readAt
            ? "read"
            : "unread";
        const groupLabel = item.groupName ? ` [${item.groupName}]` : "";
        logger.info(`${item.occurredAt}  ${stateLabel}  ${item.kind}${groupLabel}`);
        logger.info(`  ${item.title}`);
        logger.info(`  ${item.summary}`);
        logger.info(`  ${item.notificationId}`);
      }
      return;
    }

    if (command === "board") {
      const subcommand = args[1] || "list";
      if (subcommand !== "list") {
        throw new Error(`Unknown world board command: ${subcommand}`);
      }
      const kind = readOption(args, "--kind") as WorldBoardKind | undefined;
      if (
        kind !== "work" &&
        kind !== "opportunity" &&
        kind !== "artifact" &&
        kind !== "settlement"
      ) {
        throw new Error(
          "Usage: openfox world board list --kind <work|opportunity|artifact|settlement>",
        );
      }
      const snapshot = buildWorldBoardSnapshot(db, {
        boardKind: kind,
        limit: readNumberOption(args, "--limit", 25),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(`=== OPENFOX ${kind.toUpperCase()} BOARD ===`);
      logger.info(snapshot.summary);
      for (const item of snapshot.items) {
        logger.info(`${item.occurredAt}  ${item.status}`);
        logger.info(`  ${item.title}`);
        logger.info(`  ${item.summary}`);
      }
      return;
    }

    if (command === "directory") {
      const subcommand = args[1] || "groups";
      if (subcommand === "foxes") {
        const snapshot = buildWorldFoxDirectorySnapshot(db, config, {
          query: readOption(args, "--query"),
          role: readOption(args, "--role"),
          limit: readNumberOption(args, "--limit", 25),
        });
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX FOX DIRECTORY ===");
        logger.info(snapshot.summary);
        for (const item of snapshot.items) {
          const presence = item.presenceStatus ? ` ${item.presenceStatus}` : "";
          logger.info(`${item.displayName}${presence}`);
          logger.info(`  ${item.address}`);
          logger.info(
            `  groups=${item.activeGroupCount} roles=${item.roles.join(", ") || "none"}`,
          );
        }
        return;
      }
      if (subcommand === "groups") {
        const visibility = readOption(args, "--visibility") as
          | "private"
          | "listed"
          | "public"
          | undefined;
        if (
          visibility &&
          visibility !== "private" &&
          visibility !== "listed" &&
          visibility !== "public"
        ) {
          throw new Error(
            "Invalid --visibility value: expected private, listed, or public",
          );
        }
        const snapshot = buildWorldGroupDirectorySnapshot(db, {
          query: readOption(args, "--query"),
          visibility,
          tag: readOption(args, "--tag"),
          role: readOption(args, "--role"),
          limit: readNumberOption(args, "--limit", 25),
        });
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX GROUP DIRECTORY ===");
        logger.info(snapshot.summary);
        for (const item of snapshot.items) {
          logger.info(`${item.name}  [${item.visibility}]`);
          logger.info(
            `  members=${item.activeMemberCount} join=${item.joinMode} tags=${item.tags.join(", ") || "none"}`,
          );
        }
        return;
      }
      throw new Error(`Unknown world directory command: ${subcommand}`);
    }

    if (command === "fox") {
      const subcommand = args[1] || "profile";
      if (subcommand === "profile") {
        const profile = buildFoxProfile({
          db,
          config,
          address: readOption(args, "--address"),
          activityLimit: readNumberOption(args, "--activity-limit", 10),
        });
        if (asJson) {
          logger.info(JSON.stringify(profile, null, 2));
          return;
        }
        logger.info("=== OPENFOX FOX PROFILE ===");
        logger.info(`${profile.displayName}  ${profile.address}`);
        logger.info(
          `Groups: ${profile.stats.groupCount} total, ${profile.stats.activeGroupCount} active`,
        );
        logger.info(
          `Discovery: ${profile.discovery.published ? `published (${profile.discovery.capabilityNames.length} capabilities)` : "not published"}`,
        );
        logger.info(
          `Unread notifications: ${profile.stats.unreadNotificationCount}`,
        );
        for (const group of profile.groups.slice(0, 10)) {
          logger.info(
            `  [${group.membershipState}] ${group.name} (${group.roles.join(", ") || "no roles"})`,
          );
        }
        return;
      }
      if (subcommand === "page") {
        const snapshot = buildFoxPageSnapshot({
          db,
          config,
          address: readOption(args, "--address"),
          activityLimit: readNumberOption(args, "--activity-limit", 12),
          messageLimit: readNumberOption(args, "--messages", 10),
          announcementLimit: readNumberOption(args, "--announcements", 8),
          presenceLimit: readNumberOption(args, "--presence", 10),
        });
        const pageCommand =
          args[2] && !args[2].startsWith("--") ? args[2] : "snapshot";
        if (pageCommand === "export") {
          const output = readOption(args, "--output");
          if (!output) {
            throw new Error(
              "Usage: openfox world fox page export --output <path>",
            );
          }
          const outputPath = resolvePath(output);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, buildFoxPageHtml(snapshot), "utf8");
          if (asJson) {
            logger.info(
              JSON.stringify(
                {
                  outputPath,
                  generatedAt: snapshot.generatedAt,
                  foxAddress: snapshot.fox.address,
                  activeGroupCount: snapshot.stats.activeGroupCount,
                },
                null,
                2,
              ),
            );
            return;
          }
          logger.info(`fox page exported: ${outputPath}`);
          return;
        }
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX FOX PAGE ===");
        logger.info(`${snapshot.fox.displayName}  ${snapshot.fox.address}`);
        logger.info(
          `groups=${snapshot.stats.activeGroupCount}/${snapshot.stats.groupCount} presence=${snapshot.stats.presenceCount} activity=${snapshot.stats.recentActivityCount} messages=${snapshot.stats.messageCount}`,
        );
        logger.info(
          `capabilities=${snapshot.stats.capabilityCount} roles=${Object.keys(snapshot.roleSummary).length ? Object.entries(snapshot.roleSummary).map(([role, count]) => `${role}=${count}`).join(", ") : "none"}`,
        );
        for (const activity of snapshot.recentActivity.slice(0, 5)) {
          logger.info(`${activity.occurredAt}  ${activity.kind}`);
          logger.info(`  ${activity.title}`);
        }
        return;
      }
      if (subcommand !== "profile") {
        throw new Error(`Unknown world fox command: ${subcommand}`);
      }
    }

    if (command === "group") {
      const subcommand = args[1] || "page";
      if (subcommand === "profile") {
        const subSubcommand = args[2] && !args[2].startsWith("--") ? args[2] : "publish";
        if (subSubcommand === "publish") {
          const groupId = readOption(args, "--group");
          if (!groupId) {
            throw new Error("Usage: openfox world group profile publish --group <group-id>");
          }
          const result = publishGroupProfile(db, groupId);
          if (asJson) {
            logger.info(JSON.stringify(result, null, 2));
            return;
          }
          logger.info(`Group profile published: ${result.cid}`);
          return;
        }
        throw new Error(`Unknown world group profile command: ${subSubcommand}`);
      }
      if (subcommand !== "page") {
        throw new Error(`Unknown world group command: ${subcommand}`);
      }
      const groupId = readOption(args, "--group");
      if (!groupId) {
        throw new Error("Usage: openfox world group page --group <group-id>");
      }
      const snapshot = buildGroupPageSnapshot(db, {
        groupId,
        messageLimit: readNumberOption(args, "--messages", 20),
        announcementLimit: readNumberOption(args, "--announcements", 10),
        eventLimit: readNumberOption(args, "--events", 20),
        presenceLimit: readNumberOption(args, "--presence", 20),
      });
      const pageCommand =
        args[2] && !args[2].startsWith("--") ? args[2] : "snapshot";
      if (pageCommand === "export") {
        const output = readOption(args, "--output");
        if (!output) {
          throw new Error(
            "Usage: openfox world group page export --group <group-id> --output <path>",
          );
        }
        const outputPath = resolvePath(output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, buildGroupPageHtml(snapshot), "utf8");
        if (asJson) {
          logger.info(
            JSON.stringify(
              {
                outputPath,
                generatedAt: snapshot.generatedAt,
                groupId: snapshot.group.groupId,
                activeMemberCount: snapshot.stats.activeMemberCount,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.info(`group page exported: ${outputPath}`);
        return;
      }
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX GROUP PAGE ===");
      logger.info(`${snapshot.group.name}  [${snapshot.group.visibility}]`);
      logger.info(
        `members=${snapshot.stats.activeMemberCount}/${snapshot.stats.memberCount} channels=${snapshot.stats.channelCount} announcements=${snapshot.stats.announcementCount}`,
      );
      logger.info(
        `join=${snapshot.group.joinMode} presence=${snapshot.stats.presenceCount} messages=${snapshot.stats.messageCount}`,
      );
      return;
    }

    if (command === "artifact") {
      const subcommand = args[1] || "page";
      if (subcommand !== "page") {
        throw new Error(`Unknown world artifact command: ${subcommand}`);
      }
      const artifactId = readOption(args, "--artifact");
      if (!artifactId) {
        throw new Error(
          "Usage: openfox world artifact page --artifact <artifact-id> [--settlements N]",
        );
      }
      const snapshot = buildArtifactPageSnapshot(db, {
        artifactId,
        settlementLimit: readNumberOption(args, "--settlements", 8),
      });
      const pageSubcommand =
        args[2] && !args[2].startsWith("--") ? args[2] : "snapshot";
      if (pageSubcommand === "export") {
        const output = readOption(args, "--output");
        if (!output) {
          throw new Error(
            "Usage: openfox world artifact page export --artifact <artifact-id> --output <path>",
          );
        }
        const outputPath = resolvePath(output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, buildArtifactPageHtml(snapshot), "utf8");
        if (asJson) {
          logger.info(JSON.stringify({ outputPath, artifactId }, null, 2));
          return;
        }
        logger.info(`artifact page exported: ${outputPath}`);
        return;
      }
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX ARTIFACT PAGE ===");
      logger.info(`${snapshot.artifact.title}  ${snapshot.artifact.artifactId}`);
      logger.info(snapshot.summary);
      return;
    }

    if (command === "settlement") {
      const subcommand = args[1] || "page";
      if (subcommand !== "page") {
        throw new Error(`Unknown world settlement command: ${subcommand}`);
      }
      const receiptId = readOption(args, "--receipt");
      if (!receiptId) {
        throw new Error(
          "Usage: openfox world settlement page --receipt <receipt-id> [--artifacts N]",
        );
      }
      const snapshot = buildSettlementPageSnapshot(db, {
        receiptId,
        artifactLimit: readNumberOption(args, "--artifacts", 8),
      });
      const pageSubcommand =
        args[2] && !args[2].startsWith("--") ? args[2] : "snapshot";
      if (pageSubcommand === "export") {
        const output = readOption(args, "--output");
        if (!output) {
          throw new Error(
            "Usage: openfox world settlement page export --receipt <receipt-id> --output <path>",
          );
        }
        const outputPath = resolvePath(output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, buildSettlementPageHtml(snapshot), "utf8");
        if (asJson) {
          logger.info(JSON.stringify({ outputPath, receiptId }, null, 2));
          return;
        }
        logger.info(`settlement page exported: ${outputPath}`);
        return;
      }
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX SETTLEMENT PAGE ===");
      logger.info(`${snapshot.settlement.receiptId}  ${snapshot.settlement.kind}`);
      logger.info(snapshot.summary);
      return;
    }

    if (command === "governance") {
      const groupId = readOption(args, "--group");
      if (!groupId) {
        throw new Error(
          "Usage: openfox world governance --group <group-id> [--proposals N] [--requests N]",
        );
      }
      const snapshot = buildGroupGovernanceSnapshot(db, {
        groupId,
        proposalLimit: readNumberOption(args, "--proposals", 20),
        joinRequestLimit: readNumberOption(args, "--requests", 20),
      });
      const subcommand =
        args[1] && !args[1].startsWith("--") ? args[1] : "snapshot";
      if (subcommand === "export") {
        const output = readOption(args, "--output");
        if (!output) {
          throw new Error(
            "Usage: openfox world governance export --group <group-id> --output <path>",
          );
        }
        const outputPath = resolvePath(output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(
          outputPath,
          buildGroupGovernanceHtml(snapshot, {
            groupPageHref: `./${groupId}.html`,
          }),
          "utf8",
        );
        if (asJson) {
          logger.info(
            JSON.stringify(
              {
                outputPath,
                generatedAt: snapshot.generatedAt,
                groupId: snapshot.groupId,
                openProposalCount: snapshot.counts.openProposalCount,
                openJoinRequestCount: snapshot.counts.openJoinRequestCount,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.info(`group governance exported: ${outputPath}`);
        return;
      }
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX GROUP GOVERNANCE ===");
      logger.info(`${snapshot.groupName}  ${snapshot.groupId}`);
      logger.info(snapshot.summary);
      for (const proposal of snapshot.openProposals.slice(0, 10)) {
        logger.info(
          `  proposal ${proposal.proposalKind}  approvals=${proposal.approvalCount}/${proposal.requiredApprovals}`,
        );
      }
      for (const request of snapshot.openJoinRequests.slice(0, 10)) {
        logger.info(
          `  join-request ${request.applicantAgentId || request.applicantTnsName || request.applicantAddress}  approvals=${request.approvalCount}/${request.requiredApprovals}`,
        );
      }
      return;
    }

    if (command === "treasury") {
      const groupId = readOption(args, "--group");
      if (!groupId) {
        throw new Error(
          "Usage: openfox world treasury --group <group-id> [--campaigns N] [--bounties N] [--settlements N]",
        );
      }
      const snapshot = buildGroupTreasurySnapshot(db, {
        groupId,
        campaignLimit: readNumberOption(args, "--campaigns", 12),
        bountyLimit: readNumberOption(args, "--bounties", 12),
        settlementLimit: readNumberOption(args, "--settlements", 12),
      });
      const subcommand =
        args[1] && !args[1].startsWith("--") ? args[1] : "snapshot";
      if (subcommand === "export") {
        const output = readOption(args, "--output");
        if (!output) {
          throw new Error(
            "Usage: openfox world treasury export --group <group-id> --output <path>",
          );
        }
        const outputPath = resolvePath(output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(
          outputPath,
          buildGroupTreasuryHtml(snapshot, {
            groupPageHref: `./${groupId}.html`,
          }),
          "utf8",
        );
        if (asJson) {
          logger.info(
            JSON.stringify(
              {
                outputPath,
                generatedAt: snapshot.generatedAt,
                groupId: snapshot.groupId,
                campaignCount: snapshot.counts.campaignCount,
                settlementCount: snapshot.counts.settlementCount,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.info(`group treasury exported: ${outputPath}`);
        return;
      }
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX GROUP TREASURY ===");
      logger.info(`${snapshot.groupName}  ${snapshot.groupId}`);
      logger.info(snapshot.summary);
      logger.info(snapshot.attributionSummary);
      logger.info(
        `  budget=${snapshot.totals.totalBudgetTomi} tomi allocated=${snapshot.totals.allocatedBudgetTomi} tomi remaining=${snapshot.totals.remainingBudgetTomi} tomi`,
      );
      logger.info(
        `  payables=${snapshot.totals.pendingPayablesTomi} tomi receivables=${snapshot.totals.pendingReceivablesTomi} tomi host_payouts=${snapshot.totals.realizedHostPayoutsTomi} tomi solver_earnings=${snapshot.totals.realizedSolverEarningsTomi} tomi`,
      );
      for (const campaign of snapshot.campaigns.slice(0, 8)) {
        logger.info(
          `  campaign ${campaign.title}  status=${campaign.status} budget=${campaign.budgetTomi} remaining=${campaign.remainingTomi}`,
        );
      }
      for (const settlement of snapshot.recentSettlements.slice(0, 8)) {
        logger.info(
          `  settlement ${settlement.kind}  relation=${settlement.relation} subject=${settlement.subjectId}`,
        );
      }
      return;
    }

    if (command === "shell") {
      const subcommand =
        args[1] && !args[1].startsWith("--") ? args[1] : "snapshot";
      const snapshot = buildMetaWorldShellSnapshot({
        db,
        config,
        feedLimit: readNumberOption(args, "--feed", 16),
        notificationLimit: readNumberOption(args, "--notifications", 12),
        boardLimit: readNumberOption(args, "--boards", 8),
        directoryLimit: readNumberOption(args, "--directory", 12),
        groupPageLimit: readNumberOption(args, "--groups", 3),
      });

      if (subcommand === "snapshot") {
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX METAWORLD SHELL ===");
        logger.info(
          `${snapshot.fox.displayName}  ${snapshot.fox.address}`,
        );
        logger.info(
          `groups=${snapshot.fox.stats.activeGroupCount} notifications=${snapshot.notifications.unreadCount} presence=${snapshot.presence.activeCount} feed=${snapshot.feed.items.length}`,
        );
        logger.info(
          `directory: foxes=${snapshot.directories.foxes.items.length} groups=${snapshot.directories.groups.items.length}`,
        );
        for (const group of snapshot.activeGroups) {
          logger.info(
            `  ${group.group.name}  members=${group.stats.activeMemberCount} channels=${group.stats.channelCount} announcements=${group.stats.announcementCount}`,
          );
        }
        return;
      }

      if (subcommand === "export") {
        const output = readOption(args, "--output");
        if (!output) {
          throw new Error(
            "Usage: openfox world shell export --output <path>",
          );
        }
        const outputPath = resolvePath(output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(
          outputPath,
          buildMetaWorldShellHtml(snapshot),
          "utf8",
        );
        if (asJson) {
          logger.info(
            JSON.stringify(
              {
                outputPath,
                generatedAt: snapshot.generatedAt,
                foxAddress: snapshot.fox.address,
                activeGroupCount: snapshot.activeGroups.length,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.info(`metaWorld shell exported: ${outputPath}`);
        return;
      }

      throw new Error(`Unknown world shell command: ${subcommand}`);
    }

    if (command === "site") {
      const subcommand = args[1] || "export";
      if (subcommand !== "export") {
        throw new Error(`Unknown world site command: ${subcommand}`);
      }
      const outputDir = readOption(args, "--output-dir");
      if (!outputDir) {
        throw new Error(
          "Usage: openfox world site export --output-dir <path>",
        );
      }
      const result = await exportMetaWorldSite({
        db,
        config,
        outputDir: resolvePath(outputDir),
        foxLimit: readNumberOption(args, "--foxes", 50),
        groupLimit: readNumberOption(args, "--groups", 50),
      });
      const publication = registerMetaWorldSitePublication({
        db,
        result,
        baseUrl: readOption(args, "--base-url"),
        label: readOption(args, "--label") ?? undefined,
      });
      if (asJson) {
        logger.info(JSON.stringify({ ...result, publication }, null, 2));
        return;
      }
      logger.info(`metaWorld site exported: ${result.outputDir}`);
      logger.info(`  shell: ${result.shellPath}`);
      logger.info(`  foxes: ${result.foxPages.length}`);
      logger.info(`  groups: ${result.groupPages.length}`);
      logger.info(`  manifest: ${result.manifestPath}`);
      logger.info(`  publication: ${publication.publicationId}`);
      return;
    }

    if (command === "publication") {
      const subcommand = args[1] && !args[1].startsWith("--") ? args[1] : "show";
      if (subcommand === "show") {
        const snapshot = buildMetaWorldPublicationSnapshot(db);
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX PUBLICATION SURFACE ===");
        logger.info(snapshot.summary);
        for (const item of snapshot.sitePublications.slice(0, 10)) {
          logger.info(`  site ${item.label}  foxes=${item.foxPageCount} groups=${item.groupPageCount}`);
        }
        for (const item of snapshot.federationPeers.slice(0, 10)) {
          logger.info(`  peer ${item.label}  manifest=${item.manifestUrl}`);
        }
        return;
      }
      if (subcommand === "site") {
        const siteSubcommand = args[2] && !args[2].startsWith("--") ? args[2] : "register";
        if (siteSubcommand !== "register") {
          throw new Error(`Unknown world publication site command: ${siteSubcommand}`);
        }
        const outputDir = readOption(args, "--output-dir");
        if (!outputDir) {
          throw new Error(
            "Usage: openfox world publication site register --output-dir <path> [--base-url <url>] [--label <text>]",
          );
        }
        const record = await registerMetaWorldSitePublicationFromOutputDir({
          db,
          outputDir: resolvePath(outputDir),
          baseUrl: readOption(args, "--base-url"),
          label: readOption(args, "--label") ?? undefined,
        });
        if (asJson) {
          logger.info(JSON.stringify(record, null, 2));
          return;
        }
        logger.info(`site publication registered: ${record.publicationId}`);
        logger.info(`  ${record.label} -> ${record.manifestPath}`);
        return;
      }
      if (subcommand === "peer") {
        const peerSubcommand = args[2] && !args[2].startsWith("--") ? args[2] : "add";
        if (peerSubcommand === "add") {
          const manifestUrl = readOption(args, "--manifest-url");
          if (!manifestUrl) {
            throw new Error(
              "Usage: openfox world publication peer add --manifest-url <url> [--base-url <url>] [--label <text>]",
            );
          }
          const record = await addMetaWorldFederationPeer({
            db,
            manifestUrl,
            baseUrl: readOption(args, "--base-url"),
            label: readOption(args, "--label") ?? undefined,
          });
          if (asJson) {
            logger.info(JSON.stringify(record, null, 2));
            return;
          }
          logger.info(`federation peer added: ${record.peerId}`);
          logger.info(`  ${record.label} -> ${record.manifestUrl}`);
          return;
        }
        if (peerSubcommand === "refresh") {
          const peerId = readOption(args, "--id");
          if (!peerId) {
            throw new Error(
              "Usage: openfox world publication peer refresh --id <peer-id>",
            );
          }
          const record = await refreshMetaWorldFederationPeer({ db, peerId });
          if (asJson) {
            logger.info(JSON.stringify(record, null, 2));
            return;
          }
          logger.info(`federation peer refreshed: ${record.peerId}`);
          logger.info(`  error=${record.lastError ?? "none"}`);
          return;
        }
        throw new Error(`Unknown world publication peer command: ${peerSubcommand}`);
      }
      if (subcommand === "peers") {
        const records = listMetaWorldFederationPeers(db);
        if (asJson) {
          logger.info(JSON.stringify(records, null, 2));
          return;
        }
        logger.info("=== OPENFOX FEDERATION PEERS ===");
        for (const record of records) {
          logger.info(`${record.peerId}  ${record.label}`);
          logger.info(`  ${record.manifestUrl}`);
          if (record.lastError) {
            logger.info(`  error: ${record.lastError}`);
          }
        }
        return;
      }
      throw new Error(`Unknown world publication command: ${subcommand}`);
    }

    if (command === "demo") {
      const subcommand = args[1] || "export";
      if (subcommand === "export") {
        const outputDir = readOption(args, "--output-dir");
        if (!outputDir) {
          throw new Error(
            "Usage: openfox world demo export --output-dir <path> [--force]",
          );
        }
        const result = await exportMetaWorldDemoBundle({
          outputDir: resolvePath(outputDir),
          force: args.includes("--force"),
        });
        if (asJson) {
          logger.info(JSON.stringify(result, null, 2));
          return;
        }
        logger.info(`metaWorld demo bundle exported: ${result.outputDir}`);
        logger.info(`  manifest: ${result.manifestPath}`);
        logger.info(`  replicated group: ${result.manifest.replicatedGroup.groupId}`);
        logger.info(`  nodes: ${result.manifest.nodes.length}`);
        return;
      }
      if (subcommand === "validate") {
        const bundleDir = readOption(args, "--bundle");
        if (!bundleDir) {
          throw new Error(
            "Usage: openfox world demo validate --bundle <path>",
          );
        }
        const result = await validateMetaWorldDemoBundle({
          bundleDir: resolvePath(bundleDir),
        });
        if (asJson) {
          logger.info(JSON.stringify(result, null, 2));
          return;
        }
        logger.info(`metaWorld demo validation: ${result.ok ? "ok" : "failed"}`);
        logger.info(`  bundle: ${result.bundleDir}`);
        logger.info(`  checks: ${result.checks.filter((check) => check.ok).length}/${result.checks.length}`);
        for (const check of result.checks) {
          logger.info(`  [${check.ok ? "ok" : "fail"}] ${check.name} — ${check.detail}`);
        }
        return;
      }
      throw new Error(`Unknown world demo command: ${subcommand}`);
    }

    if (command === "serve") {
      const port = readNumberOption(args, "--port", 3000);
      const host = readOption(args, "--host") || "127.0.0.1";
      const server = await startMetaWorldServer({ db, config, port, host });
      logger.info(`metaWorld server running at ${server.url}`);
      logger.info("Press Ctrl+C to stop.");
      await new Promise<void>((resolve) => {
        const shutdown = () => {
          server.close().then(() => resolve()).catch(() => resolve());
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      });
      return;
    }

    if (command === "presence") {
      const subcommand = args[1] || "list";
      if (subcommand === "publish") {
        const status = (readOption(args, "--status") || "online") as WorldPresenceStatus;
        if (
          status !== "online" &&
          status !== "busy" &&
          status !== "away" &&
          status !== "recently_active"
        ) {
          throw new Error(
            "Invalid --status value: expected online, busy, away, or recently_active",
          );
        }
        const record = publishWorldPresence({
          db,
          actorAddress: config.walletAddress,
          agentId: config.agentId,
          displayName:
            config.agentDiscovery?.displayName?.trim() || config.name,
          status,
          summary: readOption(args, "--summary"),
          groupId: readOption(args, "--group"),
          ttlSeconds: readNumberOption(args, "--ttl-seconds", 120),
        });
        logger.info(asJson ? JSON.stringify(record, null, 2) : `Presence published: ${record.actorAddress} ${record.effectiveStatus}`);
        return;
      }
      if (subcommand === "list") {
        const status = readOption(args, "--status") || "all";
        if (
          status !== "all" &&
          status !== "online" &&
          status !== "busy" &&
          status !== "away" &&
          status !== "recently_active" &&
          status !== "expired"
        ) {
          throw new Error(
            "Invalid --status value: expected all, online, busy, away, recently_active, or expired",
          );
        }
        const snapshot = buildWorldPresenceSnapshot(db, {
          groupId: readOption(args, "--group"),
          status,
          includeExpired: args.includes("--include-expired"),
          limit: readNumberOption(args, "--limit", 25),
        });
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX WORLD PRESENCE ===");
        logger.info(snapshot.summary);
        for (const item of snapshot.items) {
          const scope = item.groupName ? ` [${item.groupName}]` : "";
          logger.info(`${item.lastSeenAt}  ${item.effectiveStatus}${scope}`);
          logger.info(`  ${item.displayName || item.agentId || item.actorAddress}`);
          if (item.summary) {
            logger.info(`  ${item.summary}`);
          }
        }
        return;
      }
      throw new Error(`Unknown world presence command: ${subcommand}`);
    }

    if (command === "notification") {
      const subcommand = args[1] || "read";
      const notificationId = readOption(args, "--id");
      if (!notificationId) {
        throw new Error("Usage: openfox world notification <read|dismiss> --id <notification-id>");
      }
      if (subcommand === "read") {
        const state = markWorldNotificationRead(db, notificationId);
        logger.info(asJson ? JSON.stringify(state, null, 2) : `Marked as read: ${notificationId}`);
        return;
      }
      if (subcommand === "dismiss") {
        const state = dismissWorldNotification(db, notificationId);
        logger.info(asJson ? JSON.stringify(state, null, 2) : `Dismissed: ${notificationId}`);
        return;
      }
      throw new Error(`Unknown world notification command: ${subcommand}`);
    }

    if (command === "profile") {
      const subcommand = args[1] || "show";
      if (subcommand === "set") {
        const address = config.walletAddress;
        const bio = readOption(args, "--bio");
        const avatarUrl = readOption(args, "--avatar-url");
        const website = readOption(args, "--website");
        const tagsRaw = readOption(args, "--tags");
        const socialRaw = readOption(args, "--social");

        if (bio) updateFoxProfileFieldForAddress(db, address, "bio", bio);
        if (avatarUrl) updateFoxProfileFieldForAddress(db, address, "avatar_url", avatarUrl);
        if (website) updateFoxProfileFieldForAddress(db, address, "website_url", website);
        if (tagsRaw) {
          const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
          updateFoxProfileFieldForAddress(db, address, "tags", JSON.stringify(tags));
        }
        if (socialRaw) {
          const links = socialRaw.split(",").map((entry) => {
            const [platform, ...urlParts] = entry.split(":");
            return { platform: platform.trim(), url: urlParts.join(":").trim() };
          }).filter((l) => l.platform && l.url);
          updateFoxProfileFieldForAddress(db, address, "social_links", JSON.stringify(links));
        }
        logger.info(asJson ? JSON.stringify({ updated: true }, null, 2) : "Profile updated.");
        return;
      }
      if (subcommand === "publish") {
        const result = publishFoxProfile(db, config);
        if (asJson) {
          logger.info(JSON.stringify(result, null, 2));
          return;
        }
        logger.info(`Profile published: ${result.cid}`);
        return;
      }
      if (subcommand === "show") {
        const targetAddress = readOption(args, "--address") ?? config.walletAddress;
        const profile = buildFoxPublicProfile(db, { ...config, walletAddress: targetAddress as `0x${string}` });
        if (asJson) {
          logger.info(JSON.stringify(profile, null, 2));
          return;
        }
        logger.info("=== OPENFOX PUBLIC PROFILE ===");
        logger.info(`${profile.displayName}  ${profile.address}`);
        if (profile.bio) logger.info(`Bio: ${profile.bio}`);
        if (profile.avatarUrl) logger.info(`Avatar: ${profile.avatarUrl}`);
        if (profile.websiteUrl) logger.info(`Website: ${profile.websiteUrl}`);
        if (profile.tags.length) logger.info(`Tags: ${profile.tags.join(", ")}`);
        if (profile.socialLinks.length) {
          logger.info(`Social: ${profile.socialLinks.map((l) => `${l.platform}:${l.url}`).join(", ")}`);
        }
        logger.info(`Groups: ${profile.groupCount}`);
        logger.info(`Capabilities: ${profile.capabilities.join(", ") || "none"}`);
        logger.info(`Roles: ${profile.roles.join(", ") || "none"}`);
        if (profile.publishedAt) logger.info(`Published: ${profile.publishedAt}`);
        return;
      }
      throw new Error(`Unknown world profile command: ${subcommand}`);
    }

    if (command === "reputation") {
      const subcommand = args[1] || "show";

      if (subcommand === "show") {
        const address = readOption(args, "--address") ?? args[2] ?? config.walletAddress;
        const card = getReputationCard(db, address);
        if (asJson) {
          logger.info(JSON.stringify(card, null, 2));
          return;
        }
        logger.info("=== REPUTATION CARD ===");
        logger.info(`Address: ${card.address}`);
        logger.info(`Entity type: ${card.entityType}`);
        logger.info(`Overall score: ${card.overallScore.toFixed(3)}`);
        if (card.dimensions.length === 0) {
          logger.info("No reputation scores yet.");
        }
        for (const dim of card.dimensions) {
          logger.info(`  ${dim.dimension}: ${dim.score.toFixed(3)} (${dim.eventCount} events)`);
        }
        // Also show legacy summary
        try {
          const summary = buildFoxReputationSummary(db, address);
          logger.info("--- Legacy summary ---");
          logger.info(`Jobs completed: ${summary.jobsCompleted}`);
          logger.info(`Bounties won: ${summary.bountiesWon}`);
          logger.info(`Payment reliability: ${summary.paymentReliabilityScore}%`);
        } catch {
          // legacy summary may not be available
        }
        return;
      }

      if (subcommand === "leaderboard") {
        const entityType = (readOption(args, "--type") ?? "fox") as ReputationEntityType;
        const dimension = (readOption(args, "--dimension") ?? "reliability") as ReputationDimension;
        const limit = readNumberOption(args, "--limit", 10);
        const leaderboard = getReputationLeaderboard(db, entityType, dimension, limit);
        if (asJson) {
          logger.info(JSON.stringify(leaderboard, null, 2));
          return;
        }
        logger.info(`=== REPUTATION LEADERBOARD: ${entityType} / ${dimension} ===`);
        if (leaderboard.length === 0) {
          logger.info("No entries yet.");
        }
        for (let i = 0; i < leaderboard.length; i++) {
          const entry = leaderboard[i];
          logger.info(`  ${i + 1}. ${entry.address} — score: ${entry.score.toFixed(3)} (${entry.eventCount} events)`);
        }
        return;
      }

      if (subcommand === "trust-path") {
        const from = args[2] ?? readOption(args, "--from");
        const to = args[3] ?? readOption(args, "--to");
        if (!from || !to) {
          throw new Error("Usage: openfox world reputation trust-path <from> <to>");
        }
        const trustPath = findTrustPath(db, from, to);
        if (asJson) {
          logger.info(JSON.stringify(trustPath, null, 2));
          return;
        }
        if (!trustPath) {
          logger.info(`No trust path found between ${from} and ${to}`);
          return;
        }
        logger.info(`=== TRUST PATH ===`);
        logger.info(`From: ${trustPath.from}`);
        logger.info(`To: ${trustPath.to}`);
        logger.info(`Hops: ${trustPath.hops.length}`);
        logger.info(`Strength: ${trustPath.strength.toFixed(3)}`);
        for (const hop of trustPath.hops) {
          logger.info(`  ${hop.type}: ${hop.ref}`);
        }
        return;
      }

      throw new Error(`Unknown reputation subcommand: ${subcommand}. Use show, leaderboard, or trust-path.`);
    }

    if (command === "follow") {
      const subcommand = args[1];
      if (subcommand === "fox") {
        const address = readOption(args, "--address");
        if (!address) {
          throw new Error("Usage: openfox world follow fox --address <addr>");
        }
        const record = followFox(db, {
          followerAddress: config.walletAddress,
          targetAddress: address,
        });
        logger.info(
          asJson
            ? JSON.stringify(record, null, 2)
            : `Now following fox: ${record.targetAddress}`,
        );
        return;
      }
      if (subcommand === "group") {
        const groupId = readOption(args, "--group");
        if (!groupId) {
          throw new Error("Usage: openfox world follow group --group <id>");
        }
        const record = followGroup(db, {
          followerAddress: config.walletAddress,
          groupId,
        });
        logger.info(
          asJson
            ? JSON.stringify(record, null, 2)
            : `Now following group: ${record.targetGroupId}`,
        );
        return;
      }
      throw new Error("Usage: openfox world follow <fox|group>");
    }

    if (command === "unfollow") {
      const subcommand = args[1];
      if (subcommand === "fox") {
        const address = readOption(args, "--address");
        if (!address) {
          throw new Error("Usage: openfox world unfollow fox --address <addr>");
        }
        const removed = unfollowFox(db, {
          followerAddress: config.walletAddress,
          targetAddress: address,
        });
        logger.info(
          asJson
            ? JSON.stringify({ removed, address }, null, 2)
            : removed
              ? `Unfollowed fox: ${address}`
              : `Was not following fox: ${address}`,
        );
        return;
      }
      if (subcommand === "group") {
        const groupId = readOption(args, "--group");
        if (!groupId) {
          throw new Error("Usage: openfox world unfollow group --group <id>");
        }
        const removed = unfollowGroup(db, {
          followerAddress: config.walletAddress,
          groupId,
        });
        logger.info(
          asJson
            ? JSON.stringify({ removed, groupId }, null, 2)
            : removed
              ? `Unfollowed group: ${groupId}`
              : `Was not following group: ${groupId}`,
        );
        return;
      }
      throw new Error("Usage: openfox world unfollow <fox|group>");
    }

    if (command === "following") {
      const foxes = listFollowedFoxes(db, config.walletAddress);
      const groups = listFollowedGroups(db, config.walletAddress);
      const counts = getFollowCounts(db, config.walletAddress);
      if (asJson) {
        logger.info(JSON.stringify({ counts, foxes, groups }, null, 2));
        return;
      }
      logger.info("=== OPENFOX FOLLOWING ===");
      logger.info(
        `Following ${counts.followingFoxes} fox(es), ${counts.followingGroups} group(s). ${counts.followers} follower(s).`,
      );
      for (const fox of foxes) {
        logger.info(`  fox: ${fox.targetAddress}  (since ${fox.createdAt})`);
      }
      for (const group of groups) {
        logger.info(`  group: ${group.targetGroupId}  (since ${group.createdAt})`);
      }
      return;
    }

    if (command === "followers") {
      const followers = listFoxFollowers(db, config.walletAddress);
      if (asJson) {
        logger.info(JSON.stringify({ followers }, null, 2));
        return;
      }
      logger.info("=== OPENFOX FOLLOWERS ===");
      logger.info(`${followers.length} follower(s).`);
      for (const follower of followers) {
        logger.info(`  ${follower.followerAddress}  (since ${follower.createdAt})`);
      }
      return;
    }

    if (command === "subscribe") {
      const subcommand = readSubscriptionFeedKind(args[1]);
      if (!subcommand) {
        throw new Error("Usage: openfox world subscribe <fox|group|board> ...");
      }
      const notifyOn = readNotifyOnValues(args, subcommand);
      if (subcommand === "fox") {
        const address = readOption(args, "--address");
        if (!address) {
          throw new Error("Usage: openfox world subscribe fox --address <addr>");
        }
        const record = subscribeToFeed(db, {
          address: config.walletAddress,
          feedKind: "fox",
          targetId: address,
          notifyOn,
        });
        logger.info(
          asJson
            ? JSON.stringify(record, null, 2)
            : `Subscribed to fox ${record.targetId} for ${record.notifyOn.join(", ")}`,
        );
        return;
      }
      if (subcommand === "group") {
        const groupId = readOption(args, "--group");
        if (!groupId) {
          throw new Error("Usage: openfox world subscribe group --group <id>");
        }
        const record = subscribeToFeed(db, {
          address: config.walletAddress,
          feedKind: "group",
          targetId: groupId,
          notifyOn,
        });
        logger.info(
          asJson
            ? JSON.stringify(record, null, 2)
            : `Subscribed to group ${record.targetId} for ${record.notifyOn.join(", ")}`,
        );
        return;
      }
      const boardId = readOption(args, "--board");
      if (!boardId) {
        throw new Error(
          "Usage: openfox world subscribe board --board <work|opportunity|artifact|settlement>",
        );
      }
      const normalizedBoardId = boardId.trim();
      if (
        normalizedBoardId !== "work" &&
        normalizedBoardId !== "opportunity" &&
        normalizedBoardId !== "artifact" &&
        normalizedBoardId !== "settlement"
      ) {
        throw new Error(
          "Invalid --board value: expected work, opportunity, artifact, or settlement",
        );
      }
      const record = subscribeToFeed(db, {
        address: config.walletAddress,
        feedKind: "board",
        targetId: normalizedBoardId,
        notifyOn,
      });
      logger.info(
        asJson
          ? JSON.stringify(record, null, 2)
          : `Subscribed to board ${record.targetId} for ${record.notifyOn.join(", ")}`,
      );
      return;
    }

    if (command === "subscriptions") {
      const feedKind = readSubscriptionFeedKind(readOption(args, "--kind"));
      const subscriptions = listSubscriptions(db, config.walletAddress, {
        feedKind,
        limit: readNumberOption(args, "--limit", 50),
      });
      if (asJson) {
        logger.info(JSON.stringify({ subscriptions }, null, 2));
        return;
      }
      logger.info("=== OPENFOX SUBSCRIPTIONS ===");
      if (!subscriptions.length) {
        logger.info("No subscriptions configured.");
        return;
      }
      for (const subscription of subscriptions) {
        logger.info(
          `${subscription.subscriptionId}  ${subscription.feedKind}:${subscription.targetId}`,
        );
        logger.info(`  notify_on=${subscription.notifyOn.join(", ")} created=${subscription.createdAt}`);
      }
      return;
    }

    if (command === "unsubscribe") {
      const subscriptionId = readOption(args, "--id");
      if (!subscriptionId) {
        throw new Error("Usage: openfox world unsubscribe --id <subscription-id>");
      }
      const removed = unsubscribe(db, subscriptionId);
      logger.info(
        asJson
          ? JSON.stringify({ removed, subscriptionId }, null, 2)
          : removed
            ? `Unsubscribed: ${subscriptionId}`
            : `Subscription not found: ${subscriptionId}`,
      );
      return;
    }

    if (command === "search") {
      const query = args[1];
      if (!query || query.startsWith("--")) {
        throw new Error("Usage: openfox world search <query> [--kind fox|group|board_item] [--limit N]");
      }
      const kindRaw = readOption(args, "--kind");
      const kinds = kindRaw
        ? [kindRaw as "fox" | "group" | "board_item"]
        : undefined;
      const snapshot = buildSearchResultSnapshot(db, config, query, {
        kinds,
        limit: readNumberOption(args, "--limit", 20),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX WORLD SEARCH ===");
      logger.info(snapshot.summary);
      for (const result of snapshot.results) {
        logger.info(`  [${result.kind}] ${result.title}  (score=${result.relevanceScore}, matched=${result.matchedOn})`);
        logger.info(`    ${result.summary}`);
      }
      return;
    }

    if (command === "recommended") {
      const subcommand = args[1];
      if (subcommand === "foxes") {
        const snapshot = buildRecommendedFoxes(db, config, {
          limit: readNumberOption(args, "--limit", 10),
        });
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX RECOMMENDED FOXES ===");
        logger.info(snapshot.summary);
        for (const fox of snapshot.items) {
          logger.info(`  ${fox.displayName}  (score=${fox.score})`);
          logger.info(`    ${fox.reason}`);
        }
        return;
      }
      if (subcommand === "groups") {
        const snapshot = buildRecommendedGroups(db, config, {
          limit: readNumberOption(args, "--limit", 10),
        });
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX RECOMMENDED GROUPS ===");
        logger.info(snapshot.summary);
        for (const group of snapshot.items) {
          logger.info(`  ${group.name}  (score=${group.score})`);
          logger.info(`    ${group.reason}`);
        }
        return;
      }
      throw new Error("Usage: openfox world recommended <foxes|groups>");
    }

    if (command === "personalized-feed") {
      const snapshot = buildPersonalizedFeedSnapshot(db, config, {
        limit: readNumberOption(args, "--limit", 25),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info("=== OPENFOX PERSONALIZED FEED ===");
      logger.info(snapshot.summary);
      for (const item of snapshot.items) {
        const boostLabel = item.boostReasons.length
          ? ` [${item.boostReasons.join(", ")}]`
          : "";
        const groupLabel = item.groupName ? ` [${item.groupName}]` : "";
        logger.info(
          `${item.occurredAt}  ${item.kind}${groupLabel}  boost=${item.boostScore.toFixed(1)}${boostLabel}`,
        );
        logger.info(`  ${item.title}`);
        logger.info(`  ${item.summary}`);
      }
      return;
    }

    if (command === "intent") {
      const subcommand = args[1] || "list";

      if (subcommand === "create") {
        const title = readOption(args, "--title");
        if (!title) {
          throw new Error("Usage: openfox world intent create --title <t> --kind <k>");
        }
        const kindRaw = readOption(args, "--kind") ?? "work";
        const validKinds = ["work", "opportunity", "procurement", "collaboration", "custom"];
        if (!validKinds.includes(kindRaw)) {
          throw new Error(`Invalid intent kind: ${kindRaw}. Expected: ${validKinds.join(", ")}`);
        }
        const intent = createIntent(db, {
          publisherAddress: config.walletAddress,
          kind: kindRaw as IntentKind,
          title,
          description: readOption(args, "--description") ?? "",
          groupId: readOption(args, "--group"),
          budgetTomi: readOption(args, "--budget"),
          expiresInHours: readNumberOption(args, "--expires", 72),
        });
        if (asJson) {
          logger.info(JSON.stringify(intent, null, 2));
          return;
        }
        logger.info(`Intent created: ${intent.intentId}`);
        logger.info(`  kind=${intent.kind} status=${intent.status} expires=${intent.expiresAt}`);
        return;
      }

      if (subcommand === "list") {
        const kindRaw = readOption(args, "--kind");
        const statusRaw = readOption(args, "--status");
        const intents = listIntents(db, {
          kind: kindRaw as IntentKind | undefined,
          status: statusRaw as IntentStatus | undefined,
          groupId: readOption(args, "--group"),
          limit: readNumberOption(args, "--limit", 25),
        });
        if (asJson) {
          logger.info(JSON.stringify({ intents }, null, 2));
          return;
        }
        logger.info("=== OPENFOX INTENTS ===");
        if (!intents.length) {
          logger.info("No intents found.");
          return;
        }
        for (const intent of intents) {
          logger.info(
            `${intent.intentId}  ${intent.kind}  status=${intent.status}  ${intent.title}`,
          );
        }
        return;
      }

      if (subcommand === "show") {
        const intentId = args[2];
        if (!intentId || intentId.startsWith("--")) {
          throw new Error("Usage: openfox world intent show <id>");
        }
        const intent = getIntent(db, intentId);
        if (!intent) {
          throw new Error(`Intent not found: ${intentId}`);
        }
        const responses = listIntentResponses(db, intentId);
        if (asJson) {
          logger.info(JSON.stringify({ intent, responses }, null, 2));
          return;
        }
        logger.info("=== INTENT DETAILS ===");
        logger.info(`ID: ${intent.intentId}`);
        logger.info(`Kind: ${intent.kind}  Status: ${intent.status}`);
        logger.info(`Title: ${intent.title}`);
        logger.info(`Publisher: ${intent.publisherAddress}`);
        if (intent.groupId) logger.info(`Group: ${intent.groupId}`);
        if (intent.budgetTomi) logger.info(`Budget: ${intent.budgetTomi} tomi`);
        logger.info(`Expires: ${intent.expiresAt}`);
        if (intent.matchedSolverAddress) {
          logger.info(`Matched solver: ${intent.matchedSolverAddress}`);
        }
        if (responses.length > 0) {
          logger.info(`Responses (${responses.length}):`);
          for (const resp of responses) {
            logger.info(`  ${resp.solverAddress}  status=${resp.status}  ${resp.proposalText.slice(0, 60)}`);
          }
        }
        return;
      }

      if (subcommand === "respond") {
        const intentId = args[2];
        if (!intentId || intentId.startsWith("--")) {
          throw new Error("Usage: openfox world intent respond <id> [--proposal <text>]");
        }
        const response = respondToIntent(db, {
          intentId,
          solverAddress: config.walletAddress,
          proposalText: readOption(args, "--proposal") ?? "",
        });
        if (asJson) {
          logger.info(JSON.stringify(response, null, 2));
          return;
        }
        logger.info(`Response submitted: ${response.responseId}`);
        return;
      }

      if (subcommand === "accept") {
        const intentId = args[2];
        if (!intentId || intentId.startsWith("--")) {
          throw new Error("Usage: openfox world intent accept <id> --solver <addr>");
        }
        const solverAddress = readOption(args, "--solver");
        if (!solverAddress) {
          throw new Error("Usage: openfox world intent accept <id> --solver <addr>");
        }
        const intent = acceptIntentResponse(db, {
          intentId,
          solverAddress,
          actorAddress: config.walletAddress,
        });
        if (asJson) {
          logger.info(JSON.stringify(intent, null, 2));
          return;
        }
        logger.info(`Intent ${intentId} matched to solver ${solverAddress}`);
        return;
      }

      if (subcommand === "approve") {
        const intentId = args[2];
        if (!intentId || intentId.startsWith("--")) {
          throw new Error("Usage: openfox world intent approve <id>");
        }
        const result = approveIntentCompletion(db, {
          intentId,
          actorAddress: config.walletAddress,
        });
        if (asJson) {
          logger.info(JSON.stringify(result, null, 2));
          return;
        }
        logger.info(`Intent ${intentId} completed.`);
        if (result.settlementProposalId) {
          logger.info(`Settlement proposal: ${result.settlementProposalId}`);
        }
        return;
      }

      if (subcommand === "cancel") {
        const intentId = args[2];
        if (!intentId || intentId.startsWith("--")) {
          throw new Error("Usage: openfox world intent cancel <id>");
        }
        const intent = cancelIntent(db, {
          intentId,
          actorAddress: config.walletAddress,
        });
        if (asJson) {
          logger.info(JSON.stringify(intent, null, 2));
          return;
        }
        logger.info(`Intent ${intentId} cancelled.`);
        return;
      }

      throw new Error(
        "Usage: openfox world intent <create|list|show|respond|accept|approve|cancel>",
      );
    }

    if (command === "federation") {
      const subcommand = args[1] || "peers";

      if (subcommand === "peers") {
        const peers = listFedPeers(db);
        if (asJson) {
          logger.info(JSON.stringify({ peers }, null, 2));
          return;
        }
        logger.info("=== OPENFOX FEDERATION PEERS ===");
        if (peers.length === 0) {
          logger.info("No federation peers configured.");
          return;
        }
        for (const peer of peers) {
          logger.info(`${peer.peerUrl}  [${peer.status}]  failures=${peer.failureCount}`);
          logger.info(`  id=${peer.peerId}  last_sync=${peer.lastSyncAt || "never"}`);
        }
        return;
      }

      if (subcommand === "add-peer") {
        const peerUrl = args[2];
        if (!peerUrl || peerUrl.startsWith("--")) {
          throw new Error("Usage: openfox world federation add-peer <url> [--address <addr>]");
        }
        const address = readOption(args, "--address");
        const peer = addFederationPeer(db, peerUrl, address || undefined);
        if (asJson) {
          logger.info(JSON.stringify(peer, null, 2));
          return;
        }
        logger.info(`Added federation peer: ${peer.peerUrl} (${peer.peerId})`);
        return;
      }

      if (subcommand === "remove-peer") {
        const peerId = args[2];
        if (!peerId || peerId.startsWith("--")) {
          throw new Error("Usage: openfox world federation remove-peer <peer-id>");
        }
        const removed = removeFederationPeer(db, peerId);
        if (asJson) {
          logger.info(JSON.stringify({ removed }, null, 2));
          return;
        }
        logger.info(removed ? `Removed federation peer: ${peerId}` : `Peer not found: ${peerId}`);
        return;
      }

      if (subcommand === "status") {
        const snapshot = buildFederationSnapshot(db);
        if (asJson) {
          logger.info(JSON.stringify(snapshot, null, 2));
          return;
        }
        logger.info("=== OPENFOX FEDERATION STATUS ===");
        logger.info(snapshot.summary);
        logger.info(`  active=${snapshot.activePeers}  unreachable=${snapshot.unreachablePeers}  banned=${snapshot.bannedPeers}`);
        if (snapshot.recentEvents.length > 0) {
          logger.info("Recent events:");
          for (const event of snapshot.recentEvents) {
            logger.info(`  ${event.receivedAt}  ${event.eventType}  from=${event.peerId.slice(0, 10)}...`);
          }
        }
        return;
      }

      throw new Error(
        "Usage: openfox world federation <peers|add-peer|remove-peer|status>",
      );
    }

    throw new Error(`Unknown world command: ${command}`);
  } finally {
    db.close();
  }
}
