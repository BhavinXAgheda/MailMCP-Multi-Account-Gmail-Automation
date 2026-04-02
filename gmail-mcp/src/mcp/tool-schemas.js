import { z } from "zod";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT } from "../config/constants.js";

export const listAccountsSchema = z.object({}).strict();

export const connectAccountSchema = z.object({
  command: z.string().min(1)
}).strict();

export const completeConnectAccountSchema = z.object({
  code: z.string().min(1)
}).strict();

export const activeConnectionSchema = z.object({}).strict();
export const monitorUnreadEmailsSchema = z.object({
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().default(DEFAULT_MAX_RESULTS),
  query: z.string().optional().default("")
}).strict();
export const unreadMessageSchema = z.object({}).strict();

export const searchEmailsSchema = z.object({
  query: z.string().optional().default(""),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().default(DEFAULT_MAX_RESULTS),
  pageToken: z.string().optional()
}).strict();

export const getEmailSchema = z.object({
  messageId: z.string().min(1)
}).strict();

export const listThreadsSchema = z.object({
  query: z.string().optional().default(""),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional().default(DEFAULT_MAX_RESULTS),
  pageToken: z.string().optional()
}).strict();

export const draftEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  html: z.string().optional()
}).strict();

export const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  html: z.string().optional()
}).strict();
