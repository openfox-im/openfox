import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { loadWalletAccount } from "../identity/wallet.js";
import {
  readOption,
  readNumberOption,
  collectRepeatedOption,
  readGroupIdArg,
  readGroupVisibilityOption,
  readGroupJoinModeOption,
  parseGroupChannelSpecs,
} from "../cli/parse.js";
import {
  acceptGroupInvite,
  approveGroupJoinRequest,
  banGroupMember,
  createGroup,
  createGroupChannel,
  editGroupMessage,
  getGroupDetail,
  leaveGroup,
  listGroupAnnouncements,
  listGroupChannels,
  listGroupEvents,
  listGroupJoinRequests,
  listGroupMessages,
  listGroupMembers,
  listGroups,
  listGroupProposals,
  muteGroupMember,
  postGroupAnnouncement,
  postGroupMessage,
  reactGroupMessage,
  redactGroupMessage,
  removeGroupMember,
  requestToJoinGroup,
  sendGroupInvite,
  unbanGroupMember,
  unmuteGroupMember,
  withdrawGroupJoinRequest,
} from "../group/store.js";
import {
  issueGroupWarning,
  listGroupWarnings,
  reportGroupMessage as reportGroupMessageMod,
  listGroupReports,
  resolveGroupReport,
  appealGroupAction,
  listGroupAppeals,
  resolveGroupAppeal,
} from "../group/moderation.js";

const logger = createLogger("main");

export async function handleGroupCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox group

Usage:
  openfox group list [--limit N] [--json]
  openfox group get <group-id> [--json]
  openfox group events <group-id> [--limit N] [--json]
  openfox group members --group <group-id> [--json]
  openfox group channels --group <group-id> [--json]
  openfox group create --name "<text>" [--description "<text>"] [--visibility <private|listed|public>] [--join-mode <invite_only|request_approval>] [--tag <tag>]... [--channel <name[:description]>]... [--max-members N] [--tns-name <name>] [--json]
  openfox group channel create --group <group-id> --name "<name>" [--description "<text>"] [--visibility <scope>] [--json]
  openfox group announce post --group <group-id> --title "<text>" --body "<text>" [--channel <name>] [--pin] [--json]
  openfox group announce list --group <group-id> [--limit N] [--json]
  openfox group invite send --group <group-id> --address <addr> [--agent-id <id>] [--tns-name <name>] [--role <role>]... [--reason "<text>"] [--json]
  openfox group invite list --group <group-id> [--status <open|committed|revoked|expired|rejected>] [--json]
  openfox group invite accept --group <group-id> --proposal <proposal-id> [--display-name "<text>"] [--json]
  openfox group join request --group <group-id> [--role <role>]... [--message "<text>"] [--tns-name <name>] [--json]
  openfox group join list --group <group-id> [--status <open|committed|withdrawn|rejected|expired>] [--json]
  openfox group join approve --group <group-id> --request <request-id> [--display-name "<text>"] [--json]
  openfox group join withdraw --group <group-id> --request <request-id> [--json]
  openfox group member leave --group <group-id> [--json]
  openfox group member remove --group <group-id> --address <addr> [--reason "<text>"] [--json]
  openfox group message post --group <group-id> [--channel <name>] --text "<text>" [--mention <addr>]... [--json]
  openfox group message reply --group <group-id> [--channel <name>] --reply-to <message-id> --text "<text>" [--mention <addr>]... [--json]
  openfox group message edit --group <group-id> --message <message-id> --text "<text>" [--mention <addr>]... [--json]
  openfox group message react --group <group-id> --message <message-id> --emoji <code> [--json]
  openfox group message redact --group <group-id> --message <message-id> [--json]
  openfox group messages --group <group-id> [--channel <name>] [--limit N] [--json]
  openfox group moderation mute --group <group-id> --address <addr> --until <iso> [--reason "<text>"] [--json]
  openfox group moderation unmute --group <group-id> --address <addr> [--json]
  openfox group moderation ban --group <group-id> --address <addr> [--reason "<text>"] [--json]
  openfox group moderation unban --group <group-id> --address <addr> [--json]
  openfox group warn --group <group-id> --target <address> --reason "<text>" [--severity mild|moderate|severe] [--json]
  openfox group warnings --group <group-id> [--target <address>] [--limit N] [--json]
  openfox group report --group <group-id> --message <id> --reason "<text>" --category <spam|harassment|off_topic|illegal|other> [--json]
  openfox group reports --group <group-id> [--status open|resolved|dismissed] [--limit N] [--json]
  openfox group resolve-report --id <report-id> --resolution <warn|mute|ban|dismiss> [--note "<text>"] [--json]
  openfox group appeal --group <group-id> --action <mute|ban|warning> --reason "<text>" [--json]
  openfox group appeals --group <group-id> [--status pending|approved|rejected] [--limit N] [--json]
  openfox group resolve-appeal --id <appeal-id> --decision <approved|rejected> [--note "<text>"] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const items = listGroups(db, readNumberOption(args, "--limit", 25));
      if (asJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      logger.info("=== OPENFOX GROUPS ===");
      if (!items.length) {
        logger.info("No groups yet.");
        return;
      }
      for (const item of items) {
        const memberCount = db.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM group_members
             WHERE group_id = ? AND membership_state = 'active'`,
          )
          .get(item.groupId) as { count: number };
        logger.info(`${item.groupId}  ${item.name}`);
        logger.info(
          `  visibility=${item.visibility} join_mode=${item.joinMode} members=${memberCount.count} updated=${item.updatedAt}`,
        );
      }
      return;
    }

    if (command === "get") {
      const groupId = readGroupIdArg(args, 1);
      if (!groupId) {
        throw new Error("Usage: openfox group get <group-id>");
      }
      const detail = getGroupDetail(db, groupId);
      if (!detail) {
        throw new Error(`Group not found: ${groupId}`);
      }
      logger.info(JSON.stringify(detail, null, 2));
      return;
    }

    if (command === "events") {
      const groupId = readGroupIdArg(args, 1);
      if (!groupId) {
        throw new Error("Usage: openfox group events <group-id> [--limit N]");
      }
      const items = listGroupEvents(db, groupId, readNumberOption(args, "--limit", 25));
      if (asJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      logger.info(`=== OPENFOX GROUP EVENTS ${groupId} ===`);
      for (const item of items) {
        logger.info(`${item.createdAt}  ${item.kind}  ${item.eventId}`);
      }
      return;
    }

    if (command === "members") {
      const groupId = readGroupIdArg(args);
      if (!groupId) {
        throw new Error("Usage: openfox group members --group <group-id>");
      }
      logger.info(JSON.stringify(listGroupMembers(db, groupId), null, 2));
      return;
    }

    if (command === "channels") {
      const groupId = readGroupIdArg(args);
      if (!groupId) {
        throw new Error("Usage: openfox group channels --group <group-id>");
      }
      logger.info(JSON.stringify(listGroupChannels(db, groupId), null, 2));
      return;
    }

    if (command === "create") {
      const name = readOption(args, "--name");
      if (!name) {
        throw new Error("Usage: openfox group create --name \"<text>\" [--description \"<text>\"]");
      }
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const result = await createGroup({
        db,
        account,
        input: {
          name,
          description: readOption(args, "--description"),
          visibility: readGroupVisibilityOption(args),
          joinMode: readGroupJoinModeOption(args),
          maxMembers: readNumberOption(args, "--max-members", 256),
          tnsName: readOption(args, "--tns-name"),
          tags: collectRepeatedOption(args, "--tag"),
          actorAddress: config.walletAddress,
          actorAgentId: config.agentId,
          creatorDisplayName: config.name,
          defaultChannels: parseGroupChannelSpecs(args),
        },
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "channel") {
      const subcommand = args[1] || "help";
      if (subcommand !== "create") {
        throw new Error(`Unknown group channel command: ${subcommand}`);
      }
      const groupId = readGroupIdArg(args, 2);
      const name = readOption(args, "--name");
      if (!groupId || !name) {
        throw new Error(
          "Usage: openfox group channel create --group <group-id> --name \"<name>\"",
        );
      }
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const result = await createGroupChannel({
        db,
        account,
        input: {
          groupId,
          name,
          description: readOption(args, "--description"),
          visibility: readOption(args, "--visibility"),
          actorAddress: config.walletAddress,
          actorAgentId: config.agentId,
        },
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "announce") {
      const subcommand = args[1] || "list";
      if (subcommand === "list") {
        const groupId = readGroupIdArg(args, 2);
        if (!groupId) {
          throw new Error("Usage: openfox group announce list --group <group-id>");
        }
        const items = listGroupAnnouncements(
          db,
          groupId,
          readNumberOption(args, "--limit", 20),
        );
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      if (subcommand !== "post") {
        throw new Error(`Unknown group announce command: ${subcommand}`);
      }
      const groupId = readGroupIdArg(args, 2);
      const title = readOption(args, "--title");
      const bodyText = readOption(args, "--body");
      if (!groupId || !title || !bodyText) {
        throw new Error(
          "Usage: openfox group announce post --group <group-id> --title \"<text>\" --body \"<text>\"",
        );
      }
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const result = await postGroupAnnouncement({
        db,
        account,
        input: {
          groupId,
          title,
          bodyText,
          channelName: readOption(args, "--channel"),
          pin: args.includes("--pin"),
          actorAddress: config.walletAddress,
          actorAgentId: config.agentId,
        },
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "invite") {
      const subcommand = args[1] || "list";
      if (subcommand === "list") {
        const groupId = readGroupIdArg(args, 2);
        if (!groupId) {
          throw new Error("Usage: openfox group invite list --group <group-id>");
        }
        const status = readOption(args, "--status") as
          | "open"
          | "committed"
          | "revoked"
          | "expired"
          | "rejected"
          | undefined;
        const items = listGroupProposals(db, groupId, {
          proposalKind: "invite",
          status,
          limit: readNumberOption(args, "--limit", 25),
        });
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      if (subcommand === "send") {
        const groupId = readGroupIdArg(args, 2);
        const targetAddress = readOption(args, "--address");
        if (!groupId || !targetAddress) {
          throw new Error(
            "Usage: openfox group invite send --group <group-id> --address <addr>",
          );
        }
        const result = await sendGroupInvite({
          db,
          account,
          input: {
            groupId,
            targetAddress,
            targetAgentId: readOption(args, "--agent-id"),
            targetTnsName: readOption(args, "--tns-name"),
            targetRoles: collectRepeatedOption(args, "--role"),
            reason: readOption(args, "--reason"),
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "accept") {
        const groupId = readGroupIdArg(args, 2);
        const proposalId = readOption(args, "--proposal");
        if (!groupId || !proposalId) {
          throw new Error(
            "Usage: openfox group invite accept --group <group-id> --proposal <proposal-id>",
          );
        }
        const result = await acceptGroupInvite({
          db,
          account,
          input: {
            groupId,
            proposalId,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
            displayName: readOption(args, "--display-name") || config.name,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      throw new Error(`Unknown group invite command: ${subcommand}`);
    }

    if (command === "join") {
      const subcommand = args[1] || "list";
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      if (subcommand === "list") {
        const groupId = readGroupIdArg(args, 2);
        if (!groupId) {
          throw new Error("Usage: openfox group join list --group <group-id>");
        }
        const status = readOption(args, "--status") as
          | "open"
          | "committed"
          | "withdrawn"
          | "rejected"
          | "expired"
          | undefined;
        const items = listGroupJoinRequests(db, groupId, {
          status,
          limit: readNumberOption(args, "--limit", 25),
        });
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      if (subcommand === "request") {
        const groupId = readGroupIdArg(args, 2);
        if (!groupId) {
          throw new Error("Usage: openfox group join request --group <group-id>");
        }
        const result = await requestToJoinGroup({
          db,
          account,
          input: {
            groupId,
            requestedRoles: collectRepeatedOption(args, "--role"),
            message: readOption(args, "--message"),
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
            actorTnsName: readOption(args, "--tns-name"),
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "approve") {
        const groupId = readGroupIdArg(args, 2);
        const requestId = readOption(args, "--request");
        if (!groupId || !requestId) {
          throw new Error(
            "Usage: openfox group join approve --group <group-id> --request <request-id>",
          );
        }
        const result = await approveGroupJoinRequest({
          db,
          account,
          input: {
            groupId,
            requestId,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
            displayName: readOption(args, "--display-name"),
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "withdraw") {
        const groupId = readGroupIdArg(args, 2);
        const requestId = readOption(args, "--request");
        if (!groupId || !requestId) {
          throw new Error(
            "Usage: openfox group join withdraw --group <group-id> --request <request-id>",
          );
        }
        const result = await withdrawGroupJoinRequest({
          db,
          account,
          input: {
            groupId,
            requestId,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      throw new Error(`Unknown group join command: ${subcommand}`);
    }

    if (command === "member") {
      const subcommand = args[1] || "help";
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      if (subcommand === "leave") {
        const groupId = readGroupIdArg(args, 2);
        if (!groupId) {
          throw new Error("Usage: openfox group member leave --group <group-id>");
        }
        const result = await leaveGroup({
          db,
          account,
          input: {
            groupId,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "remove") {
        const groupId = readGroupIdArg(args, 2);
        const targetAddress = readOption(args, "--address");
        if (!groupId || !targetAddress) {
          throw new Error(
            "Usage: openfox group member remove --group <group-id> --address <addr>",
          );
        }
        const result = await removeGroupMember({
          db,
          account,
          input: {
            groupId,
            targetAddress,
            reason: readOption(args, "--reason"),
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      throw new Error(`Unknown group member command: ${subcommand}`);
    }

    if (command === "messages") {
      const groupId = readGroupIdArg(args, 1);
      if (!groupId) {
        throw new Error("Usage: openfox group messages --group <group-id> [--channel <name>]");
      }
      const items = listGroupMessages(db, groupId, {
        channelName: readOption(args, "--channel"),
        limit: readNumberOption(args, "--limit", 50),
      });
      logger.info(JSON.stringify(items, null, 2));
      return;
    }

    if (command === "message") {
      const subcommand = args[1] || "help";
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const groupId = readGroupIdArg(args, 2);
      if (!groupId) {
        throw new Error("Usage: openfox group message <subcommand> --group <group-id> ...");
      }
      if (subcommand === "post" || subcommand === "reply") {
        const text = readOption(args, "--text");
        if (!text) {
          throw new Error("Usage: openfox group message post --group <group-id> --text \"<text>\"");
        }
        const result = await postGroupMessage({
          db,
          account,
          input: {
            groupId,
            text,
            channelName: readOption(args, "--channel"),
            replyToMessageId: subcommand === "reply" ? readOption(args, "--reply-to") : undefined,
            mentions: collectRepeatedOption(args, "--mention"),
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "edit") {
        const messageId = readOption(args, "--message");
        const text = readOption(args, "--text");
        if (!messageId || !text) {
          throw new Error(
            "Usage: openfox group message edit --group <group-id> --message <message-id> --text \"<text>\"",
          );
        }
        const result = await editGroupMessage({
          db,
          account,
          input: {
            groupId,
            messageId,
            text,
            mentions: collectRepeatedOption(args, "--mention"),
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "react") {
        const messageId = readOption(args, "--message");
        const reactionCode = readOption(args, "--emoji");
        if (!messageId || !reactionCode) {
          throw new Error(
            "Usage: openfox group message react --group <group-id> --message <message-id> --emoji <code>",
          );
        }
        const result = await reactGroupMessage({
          db,
          account,
          input: {
            groupId,
            messageId,
            reactionCode,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "redact") {
        const messageId = readOption(args, "--message");
        if (!messageId) {
          throw new Error(
            "Usage: openfox group message redact --group <group-id> --message <message-id>",
          );
        }
        const result = await redactGroupMessage({
          db,
          account,
          input: {
            groupId,
            messageId,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      throw new Error(`Unknown group message command: ${subcommand}`);
    }

    if (command === "moderation") {
      const subcommand = args[1] || "help";
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const groupId = readGroupIdArg(args, 2);
      const targetAddress = readOption(args, "--address");
      if (!groupId || !targetAddress) {
        throw new Error(
          "Usage: openfox group moderation <mute|unmute|ban|unban> --group <group-id> --address <addr>",
        );
      }
      if (subcommand === "mute") {
        const until = readOption(args, "--until");
        if (!until) {
          throw new Error(
            "Usage: openfox group moderation mute --group <group-id> --address <addr> --until <iso>",
          );
        }
        const result = await muteGroupMember({
          db,
          account,
          input: {
            groupId,
            targetAddress,
            until,
            reason: readOption(args, "--reason"),
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "unmute") {
        const result = await unmuteGroupMember({
          db,
          account,
          input: {
            groupId,
            targetAddress,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "ban") {
        const result = await banGroupMember({
          db,
          account,
          input: {
            groupId,
            targetAddress,
            reason: readOption(args, "--reason"),
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "unban") {
        const result = await unbanGroupMember({
          db,
          account,
          input: {
            groupId,
            targetAddress,
            actorAddress: config.walletAddress,
            actorAgentId: config.agentId,
          },
        });
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      throw new Error(`Unknown group moderation command: ${subcommand}`);
    }

    if (command === "warn") {
      const groupId = readGroupIdArg(args);
      const targetAddress = readOption(args, "--target");
      const reason = readOption(args, "--reason");
      if (!groupId || !targetAddress || !reason) {
        throw new Error(
          "Usage: openfox group warn --group <group-id> --target <address> --reason \"<text>\"",
        );
      }
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const severity = (readOption(args, "--severity") || "mild") as
        | "mild"
        | "moderate"
        | "severe";
      const result = await issueGroupWarning(
        db,
        {
          groupId,
          targetAddress,
          issuerAddress: config.walletAddress,
          reason,
          severity,
        },
        account,
      );
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "warnings") {
      const groupId = readGroupIdArg(args);
      if (!groupId) {
        throw new Error("Usage: openfox group warnings --group <group-id>");
      }
      const items = listGroupWarnings(db, groupId, {
        targetAddress: readOption(args, "--target"),
        limit: readNumberOption(args, "--limit", 25),
      });
      if (asJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      logger.info(`=== GROUP WARNINGS ${groupId} ===`);
      if (!items.length) {
        logger.info("No warnings.");
        return;
      }
      for (const item of items) {
        logger.info(
          `${item.createdAt}  ${item.severity}  target=${item.targetAddress}  ${item.reason}`,
        );
      }
      return;
    }

    if (command === "report") {
      const groupId = readGroupIdArg(args);
      const messageId = readOption(args, "--message");
      const reason = readOption(args, "--reason");
      const category = readOption(args, "--category") as
        | "spam"
        | "harassment"
        | "off_topic"
        | "illegal"
        | "other"
        | undefined;
      if (!groupId || !messageId || !reason || !category) {
        throw new Error(
          "Usage: openfox group report --group <group-id> --message <id> --reason \"<text>\" --category <cat>",
        );
      }
      const result = reportGroupMessageMod(db, {
        groupId,
        messageId,
        reporterAddress: config.walletAddress,
        reason,
        category,
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "reports") {
      const groupId = readGroupIdArg(args);
      if (!groupId) {
        throw new Error("Usage: openfox group reports --group <group-id>");
      }
      const status = readOption(args, "--status") as
        | "open"
        | "resolved"
        | "dismissed"
        | undefined;
      const items = listGroupReports(db, groupId, {
        status,
        limit: readNumberOption(args, "--limit", 25),
      });
      if (asJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      logger.info(`=== GROUP REPORTS ${groupId} ===`);
      if (!items.length) {
        logger.info("No reports.");
        return;
      }
      for (const item of items) {
        logger.info(
          `${item.createdAt}  ${item.status}  ${item.category}  ${item.reason}`,
        );
      }
      return;
    }

    if (command === "resolve-report") {
      const reportId = readOption(args, "--id");
      const resolution = readOption(args, "--resolution") as
        | "warn"
        | "mute"
        | "ban"
        | "dismiss"
        | undefined;
      if (!reportId || !resolution) {
        throw new Error(
          "Usage: openfox group resolve-report --id <report-id> --resolution <warn|mute|ban|dismiss>",
        );
      }
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const result = await resolveGroupReport(
        db,
        reportId,
        {
          resolverAddress: config.walletAddress,
          resolution,
          note: readOption(args, "--note"),
        },
        account,
      );
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "appeal") {
      const groupId = readGroupIdArg(args);
      const actionKind = readOption(args, "--action") as
        | "mute"
        | "ban"
        | "warning"
        | undefined;
      const reason = readOption(args, "--reason");
      if (!groupId || !actionKind || !reason) {
        throw new Error(
          "Usage: openfox group appeal --group <group-id> --action <mute|ban|warning> --reason \"<text>\"",
        );
      }
      const result = appealGroupAction(db, {
        groupId,
        appealerAddress: config.walletAddress,
        actionKind,
        reason,
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "appeals") {
      const groupId = readGroupIdArg(args);
      if (!groupId) {
        throw new Error("Usage: openfox group appeals --group <group-id>");
      }
      const status = readOption(args, "--status") as
        | "pending"
        | "approved"
        | "rejected"
        | undefined;
      const items = listGroupAppeals(db, groupId, {
        status,
        limit: readNumberOption(args, "--limit", 25),
      });
      if (asJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      logger.info(`=== GROUP APPEALS ${groupId} ===`);
      if (!items.length) {
        logger.info("No appeals.");
        return;
      }
      for (const item of items) {
        logger.info(
          `${item.createdAt}  ${item.status}  ${item.actionKind}  ${item.reason}`,
        );
      }
      return;
    }

    if (command === "resolve-appeal") {
      const appealId = readOption(args, "--id");
      const decision = readOption(args, "--decision") as
        | "approved"
        | "rejected"
        | undefined;
      if (!appealId || !decision) {
        throw new Error(
          "Usage: openfox group resolve-appeal --id <appeal-id> --decision <approved|rejected>",
        );
      }
      const account = loadWalletAccount();
      if (!account) {
        throw new Error("OpenFox wallet not found. Run openfox --init first.");
      }
      const result = await resolveGroupAppeal(
        db,
        appealId,
        {
          resolverAddress: config.walletAddress,
          decision,
          note: readOption(args, "--note"),
        },
        account,
      );
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown group command: ${command}`);
  } finally {
    db.close();
  }
}
