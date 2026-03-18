/**
 * P2P Agent Mail — Barrel Exports
 */

export type {
  MailMessage,
  MailDeliveryRequest,
  MailDeliveryResponse,
  MailAttachment,
  MailFolder,
  MailStatus,
  MailThreadSummary,
  MailFolderSummary,
  MailListOptions,
  MailSearchOptions,
} from "./types.js";

export {
  insertMessage,
  getMessage,
  listMessages,
  searchMessages,
  getThread,
  listThreads,
  updateStatus,
  moveToFolder,
  deleteMessage,
  getUnreadCount,
  getFolderSummaries,
} from "./store.js";

export { resolveThreadId, updateThreadSummary } from "./threading.js";

export {
  resolveMailEndpoint,
  deliverMessage,
  type DeliverMessageParams,
  type DeliverMessageResult,
} from "./client.js";

export {
  startMailServer,
  type MailServer,
  type StartMailServerParams,
} from "./server.js";
