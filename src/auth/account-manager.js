import { exec } from "child_process";
import { assertAlias } from "../utils/validators.js";
import { listAccountAliases, readTokens, writeTokens } from "./token-store.js";
import { buildAuthUrlWithRedirect, createOAuthClient, exchangeCodeForTokens } from "./oauth-client.js";
import { startCallbackServer } from "./local-callback-server.js";
import { google } from "googleapis";
import { AppError } from "../utils/errors.js";

/** Opens a URL in the system default browser — cross-platform, non-blocking. */
function openBrowser(url) {
  const p = process.platform;
  const cmd =
    p === "win32" ? `start "" "${url}"` :
    p === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd); // fire-and-forget; errors are intentionally ignored
}

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

export async function fetchEmailAddressForAlias(alias) {
  const safeAlias = assertAlias(alias);
  await readTokens(safeAlias);
  const oauth2Client = await getOAuthClientForAlias(safeAlias);
  return fetchAuthenticatedEmail(oauth2Client);
}

/**
 * Resolves which Gmail account to use: optional explicit alias (from list_accounts) or session binding.
 */
export async function resolveActiveBinding(scopeKey, accountAlias) {
  const trimmedAlias =
    typeof accountAlias === "string" && accountAlias.trim() ? accountAlias.trim() : "";

  if (trimmedAlias) {
    const safe = assertAlias(trimmedAlias);
    await readTokens(safe);
    const email = await fetchEmailAddressForAlias(safe);
    return {
      alias: safe,
      email,
      suggestedChatTitle: email,
      bindingSource: "accountAlias",
      scopeKeyUsed: scopeKey
    };
  }

  const binding = getScopedBinding(scopeKey);
  if (!binding) {
    throw new AppError(
      'No active connected email for this scope. Run connect_account + complete_connect_account, or pass accountAlias from list_accounts, or set env GMAIL_MCP_SCOPE_KEY so each MCP server instance has its own binding namespace.',
      "NO_ACTIVE_CONNECTION",
      400
    );
  }

  return {
    ...binding,
    bindingSource: "session",
    scopeKeyUsed: scopeKey
  };
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
    // Shut down any existing pending server for this scope
    const existingPending = pendingAuthorizations.get(sessionKey);
    if (existingPending?.shutdown) existingPending.shutdown();
  }

  // Start a local loopback server so the authorization code is captured
  // automatically when Google redirects back — no manual copy-paste needed.
  const { redirectUri, codePromise, shutdown } = await startCallbackServer();

  const oauth2Client = await createOAuthClient();
  const authUrl = buildAuthUrlWithRedirect(oauth2Client, redirectUri);

  // Launch the browser automatically so the user doesn't have to click anything
  openBrowser(authUrl);

  pendingAuthorizations.set(sessionKey, {
    email,
    type,
    alias,
    redirectUri,
    codePromise,
    shutdown
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

/**
 * Completes the OAuth flow started by beginScopedAuthorization.
 *
 * The `code` parameter is now optional. When omitted the function awaits the
 * authorization code delivered automatically to the local loopback server that
 * was started by beginScopedAuthorization — the user only needs to open the
 * authUrl in their browser and approve access; no manual token copying is needed.
 *
 * Passing an explicit `code` string still works for backward compatibility.
 */
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

  // Resolve the authorization code:
  //  • If a code was supplied explicitly (backward-compat), use it directly.
  //  • Otherwise wait for the loopback server to receive Google's redirect.
  let authCode = code && code.trim() ? code.trim() : null;
  if (!authCode) {
    if (!pending.codePromise) {
      throw new AppError(
        "No authorization code provided and no automatic capture is available. Pass the code explicitly.",
        "NO_AUTH_CODE",
        400
      );
    }
    authCode = await pending.codePromise;
  }

  // Ensure the loopback server is shut down (safe to call multiple times)
  if (pending.shutdown) pending.shutdown();

  const oauth2Client = await createOAuthClient();
  // Pass the same redirectUri that was embedded in the authorization URL so
  // Google can validate it during token exchange.
  const tokens = await exchangeCodeForTokens(oauth2Client, authCode, pending.redirectUri);
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
