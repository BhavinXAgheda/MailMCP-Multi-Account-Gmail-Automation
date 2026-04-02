import { assertAlias } from "../utils/validators.js";
import { listAccountAliases, readTokens, writeTokens } from "./token-store.js";
import { buildAuthUrl, createOAuthClient, exchangeCodeForTokens } from "./oauth-client.js";
import { google } from "googleapis";
import { AppError } from "../utils/errors.js";

const pendingAuthorizations = new Map();
const sessionBindings = new Map();

export async function listAccounts() {
  return listAccountAliases();
}

export async function getOAuthClientForAlias(alias) {
  const safeAlias = assertAlias(alias);
  const oauth2Client = await createOAuthClient();
  const tokens = await readTokens(safeAlias);
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

export async function authorizeAlias(alias, code) {
  const safeAlias = assertAlias(alias);
  const oauth2Client = await createOAuthClient();
  const tokens = await exchangeCodeForTokens(oauth2Client, code);
  await writeTokens(safeAlias, tokens);
  return { alias: safeAlias };
}

export async function getAuthorizationUrl() {
  const oauth2Client = await createOAuthClient();
  return buildAuthUrl(oauth2Client);
}

function normalizeSessionKey(sessionId) {
  return sessionId || "default";
}

function sanitizeEmailForAlias(email) {
  return email.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function parseConnectCommand(command) {
  const match = String(command || "")
    .trim()
    .match(/^connect\s+([^\s]+)\s+(work|personal)$/i);

  if (!match) {
    throw new AppError(
      'Command must match: "Connect <email> work" or "Connect <email> personal"',
      "VALIDATION_ERROR",
      400
    );
  }

  const email = match[1].toLowerCase();
  const type = match[2].toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("Invalid email format in connect command", "VALIDATION_ERROR", 400);
  }

  return { email, type };
}

export async function beginScopedAuthorization(command, sessionId) {
  const { email, type } = parseConnectCommand(command);
  const sessionKey = normalizeSessionKey(sessionId);
  const alias = `${type}_${sanitizeEmailForAlias(email)}`;
  const existingBinding = sessionBindings.get(sessionKey);
  const isGlobalFallbackScope = sessionKey === "default";

  if (existingBinding && !isGlobalFallbackScope) {
    throw new AppError(
      `This chat is already dedicated to "${existingBinding.email}". Create a new chat to connect another account.`,
      "CHAT_ALREADY_BOUND",
      400,
      {
        lockedEmail: existingBinding.email,
        chatPolicy: "single_email_per_chat",
        suggestedChatTitle: existingBinding.email
      }
    );
  }

  // In clients that do not provide a per-chat session id, all requests share
  // a global fallback scope. In that mode we allow reconnecting so new chats
  // can still bind another email instead of being permanently locked.
  if (existingBinding && isGlobalFallbackScope && existingBinding.email !== email) {
    sessionBindings.delete(sessionKey);
  }

  const oauth2Client = await createOAuthClient();
  const authUrl = buildAuthUrl(oauth2Client);

  pendingAuthorizations.set(sessionKey, {
    email,
    type,
    alias
  });

  return {
    email,
    type,
    alias,
    authUrl
  };
}

async function fetchAuthenticatedEmail(oauth2Client) {
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  return String(profile?.data?.emailAddress || "").toLowerCase();
}

export async function completeScopedAuthorization(code, sessionId) {
  const sessionKey = normalizeSessionKey(sessionId);
  const pending = pendingAuthorizations.get(sessionKey);

  if (!pending) {
    throw new AppError(
      "No pending connection. Run connect_account first.",
      "NO_PENDING_CONNECTION",
      400
    );
  }

  const oauth2Client = await createOAuthClient();
  const tokens = await exchangeCodeForTokens(oauth2Client, code);
  oauth2Client.setCredentials(tokens);

  const authenticatedEmail = await fetchAuthenticatedEmail(oauth2Client);
  if (authenticatedEmail !== pending.email) {
    throw new AppError(
      `Authorized email "${authenticatedEmail}" does not match requested "${pending.email}"`,
      "EMAIL_MISMATCH",
      400
    );
  }

  await writeTokens(pending.alias, tokens);
  pendingAuthorizations.delete(sessionKey);

  const binding = {
    alias: pending.alias,
    email: pending.email,
    type: pending.type,
    suggestedChatTitle: pending.email
  };
  sessionBindings.set(sessionKey, binding);
  return binding;
}

export function getScopedBinding(sessionId) {
  const sessionKey = normalizeSessionKey(sessionId);
  return sessionBindings.get(sessionKey) || null;
}
