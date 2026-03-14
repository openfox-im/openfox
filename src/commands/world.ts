import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { readOption, readNumberOption } from "../cli/parse.js";
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
import fs from "fs/promises";
import path from "path";

const logger = createLogger("world");

export async function handleWorldCommand(args: string[]): Promise<void> {
  const command = args[0] || "feed";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox world

Usage:
  openfox world feed [--group <group-id>] [--limit N] [--json]
  openfox world board list --kind <work|opportunity|artifact|settlement> [--limit N] [--json]
  openfox world directory foxes [--query <text>] [--role <role>] [--limit N] [--json]
  openfox world directory groups [--query <text>] [--visibility <private|listed|public>] [--tag <tag>] [--role <role>] [--limit N] [--json]
  openfox world fox profile [--address <addr>] [--activity-limit N] [--json]
  openfox world fox page [--address <addr>] [--activity-limit N] [--messages N] [--announcements N] [--presence N] [--json]
  openfox world fox page export --output <path> [--address <addr>] [--activity-limit N] [--messages N] [--announcements N] [--presence N] [--json]
  openfox world group page --group <group-id> [--messages N] [--announcements N] [--events N] [--presence N] [--json]
  openfox world group page export --group <group-id> --output <path> [--messages N] [--announcements N] [--events N] [--presence N] [--json]
  openfox world shell [--feed N] [--notifications N] [--boards N] [--directory N] [--groups N] [--json]
  openfox world shell export --output <path> [--feed N] [--notifications N] [--boards N] [--directory N] [--groups N] [--json]
  openfox world site export --output-dir <path> [--foxes N] [--groups N] [--json]
  openfox world presence publish [--group <group-id>] [--status <online|busy|away|recently_active>] [--ttl-seconds N] [--summary "<text>"] [--json]
  openfox world presence list [--group <group-id>] [--status <all|online|busy|away|recently_active|expired>] [--include-expired] [--limit N] [--json]
  openfox world notifications [--group <group-id>] [--status <all|unread>] [--include-dismissed] [--limit N] [--json]
  openfox world notification read --id <notification-id> [--json]
  openfox world notification dismiss --id <notification-id> [--json]
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
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(`metaWorld site exported: ${result.outputDir}`);
      logger.info(`  shell: ${result.shellPath}`);
      logger.info(`  foxes: ${result.foxPages.length}`);
      logger.info(`  groups: ${result.groupPages.length}`);
      logger.info(`  manifest: ${result.manifestPath}`);
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

    throw new Error(`Unknown world command: ${command}`);
  } finally {
    db.close();
  }
}
