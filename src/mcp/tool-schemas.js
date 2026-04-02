import { z } from "zod";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT } from "../config/constants.js";

export const listAccountsSchema = z.object({}).strict();

/** Use a token file alias from list_accounts when the client shares one "default" MCP session across chats. */
export const accountAliasField = {
  accountAlias: z.string().min(1).optional()
};

export const connectAccountSchema = z.object({
  command: z.string().min(1)
}).strict();

// `code` is optional — when omitted the MCP server awaits the authorization code
// delivered automatically via the local loopback server started by connect_account.
// Providing it explicitly still works for backward compatibility.
export const completeConnectAccountSchema = z.object({
  code: z.string().min(1).optional()
}).strict();

export const activeConnectionSchema = z
  .object({
    ...accountAliasField
  })
  .strict();

export const unreadMailsSchema = z
  .object({
    maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().default(DEFAULT_MAX_RESULTS),
    query: z.string().optional().default(""),
    /** When true (default), saves draftsMarkdown under email_drafts/unread_mails_<timestamp>.md */
    writeMarkdownFile: z.boolean().optional().default(true),
    ...accountAliasField
  })
  .strict();

export const searchEmailsSchema = z
  .object({
    query: z.string().optional().default(""),
    maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().default(DEFAULT_MAX_RESULTS),
    pageToken: z.string().optional(),
    ...accountAliasField
  })
  .strict();

export const getEmailSchema = z
  .object({
    messageId: z.string().min(1),
    ...accountAliasField
  })
  .strict();

export const listThreadsSchema = z
  .object({
    query: z.string().optional().default(""),
    maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().default(DEFAULT_MAX_RESULTS),
    pageToken: z.string().optional(),
    ...accountAliasField
  })
  .strict();

export const draftEmailSchema = z
  .object({
    to: z.union([z.string().email(), z.array(z.string().email())]),
    subject: z.string().min(1),
    body: z.string().min(1),
    cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
    bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
    html: z.string().optional(),
    ...accountAliasField
  })
  .strict();

export const sendEmailSchema = z
  .object({
    to: z.union([z.string().email(), z.array(z.string().email())]),
    subject: z.string().min(1),
    body: z.string().min(1),
    cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
    bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
    html: z.string().optional(),
    ...accountAliasField
  })
  .strict();

export const reviewEmailDraftsSchema = z
  .object({
    maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().default(DEFAULT_MAX_RESULTS),
    query: z.string().optional().default(""),
    ...accountAliasField
  })
  .strict();

export const markAsReadSchema = z
  .object({
    messageId: z.string().min(1),
    ...accountAliasField
  })
  .strict();
