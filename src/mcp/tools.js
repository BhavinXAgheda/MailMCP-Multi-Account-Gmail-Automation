import {
  beginScopedAuthorization,
  completeScopedAuthorization,
  resolveActiveBinding,
  listAccounts
} from "../auth/account-manager.js";
import { env } from "../config/env.js";
import {
  getEmail,
  listThreads,
  searchEmails,
  createDraft,
  sendEmail,
  fetchUnreadSummariesAndReplyDrafts,
  markAsRead
} from "../gmail/gmail-service.js";
import { AppError, errorResponse, okResponse } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import {
  activeConnectionSchema,
  completeConnectAccountSchema,
  connectAccountSchema,
  getEmailSchema,
  listAccountsSchema,
  listThreadsSchema,
  searchEmailsSchema,
  draftEmailSchema,
  sendEmailSchema,
  unreadMailsSchema,
  reviewEmailDraftsSchema,
  markAsReadSchema
} from "./tool-schemas.js";



function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function buildUnreadMailsChatMarkdown(data) {
  const fileLine = data.markdownFile
    ? `\`${data.markdownFile}\` (${data.markdownSaved ? "saved" : "not saved"})`
    : "_(no file — zero unread or writeMarkdownFile was false)_";

  const lines = [
    "# Unread mails — chat view",
    "",
    `**Account:** ${data.activeEmail ?? "—"} (\`${data.activeAlias ?? "—"}\`)`,
    `**Unread count:** ${data.unreadCount ?? 0}`,
    `**Markdown on disk:** ${fileLine}`,
    `**Gmail query:** \`${data.gmailListQuery ?? ""}\``,
    ""
  ];

  if (data.noUnreadHint) {
    lines.push("> " + data.noUnreadHint, "");
  }
  if (data.markdownSaveError) {
    lines.push("> **Save error:** " + data.markdownSaveError, "");
  }

  lines.push("---", "");

  if (Array.isArray(data.items) && data.items.length > 0) {
    lines.push("## Summaries", "");
    for (const item of data.items) {
      const sub = item.subject || "(no subject)";
      lines.push(`### ${sub}`);
      lines.push(`- **From:** ${item.from || "—"}`);
      lines.push(`- **messageId:** \`${item.messageId}\``);
      lines.push(`- ${item.mailSummary || ""}`);
      lines.push("");
    }
    lines.push("---", "", "## Reply drafts", "", data.draftsMarkdown || "", "");
  } else {
    lines.push(data.draftsMarkdown || "_No unread messages in this run._", "");
  }

  lines.push("---", "", "*Structured JSON is in the next block for tools.*");
  return lines.join("\n");
}

/** Tool output tuned so chat UIs show Markdown summaries + drafts in the first content block. */
function unreadMailsToolResult(payload) {
  if (!payload.ok || !payload.data) {
    return toolResult(payload);
  }
  const chatMarkdown = buildUnreadMailsChatMarkdown(payload.data);
  const jsonText = JSON.stringify(payload, null, 2);
  return {
    content: [
      { type: "text", text: chatMarkdown },
      { type: "text", text: jsonText }
    ],
    structuredContent: payload
  };
}

function parseSchema(schema, args) {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new AppError("Invalid tool input", "VALIDATION_ERROR", 400, parsed.error.flatten());
  }
  return parsed.data;
}

function resolveScopeKey(extra) {
  const meta = extra?._meta || {};
  const candidates = [
    extra?.sessionId,
    meta.sessionId,
    meta.chatId,
    meta.conversationId,
    meta.threadId
  ];
  const value = candidates.find((item) => typeof item === "string" && item.trim().length > 0);
  if (value) return value.trim();
  if (env.GMAIL_MCP_SCOPE_KEY) return env.GMAIL_MCP_SCOPE_KEY;
  return "default";
}

function omitAccountAlias(input) {
  const { accountAlias, ...rest } = input;
  return rest;
}

function withScopedUiHints(binding, data = {}) {
  return {
    ...data,
    activeEmail: binding.email,
    activeAlias: binding.alias,
    bindingSource: binding.bindingSource,
    scopeKeyUsed: binding.scopeKeyUsed,
    chatPolicy: "single_email_per_chat",
    renameChatTo: binding.email
  };
}

export function registerTools(server) {
  server.registerTool(
    "connect_account",
    {
      title: "Start account connection",
      description:
        'Parses "Connect <email> work|personal" and starts the OAuth flow. ' +
        'The browser is opened automatically — the user just needs to approve access. ' +
        'A local loopback server captures the authorization code automatically. ' +
        'IMPORTANT: call complete_connect_account immediately after this tool returns ' +
        '(do NOT wait for user input — the browser is already open). ' +
        'complete_connect_account will block until the user approves in the browser, ' +
        'then resolve automatically and return to chat. No manual token copying needed. ' +
        'Bindings are keyed by the MCP session when the client sends one; otherwise by env GMAIL_MCP_SCOPE_KEY if set, else a shared "default" scope.',
      inputSchema: connectAccountSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(connectAccountSchema, args);
        const data = await beginScopedAuthorization(input.command, scopeKey);
        return toolResult(
          okResponse({
            ...data,
            nextStep:
              "Browser opened automatically. Call complete_connect_account NOW (no code needed) — it will wait for the user to approve and then complete automatically.",
            scopedChatPolicy: "single_email_per_chat"
          })
        );
      } catch (error) {
        logger.error("connect_account failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "complete_connect_account",
    {
      title: "Complete account connection",
      description:
        "Completes OAuth connection and binds this chat session to one email account. " +
        "The authorization code is captured automatically from the local loopback server " +
        "started by connect_account — call this tool without a code and it will wait for " +
        "the user to approve access in their browser. Passing an explicit code is still " +
        "supported for backward compatibility.",
      inputSchema: completeConnectAccountSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(completeConnectAccountSchema, args);
        // input.code is optional; completeScopedAuthorization awaits the loopback server when absent
        const binding = await completeScopedAuthorization(input.code, scopeKey);
        return toolResult(
          okResponse({
            ...binding,
            activeEmail: binding.email,
            scoped: true,
            renameChatTo: binding.suggestedChatTitle
          })
        );
      } catch (error) {
        logger.error("complete_connect_account failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "active_connection",
    {
      title: "Show active email connection",
      description:
        "Shows the email for this scope, or resolves accountAlias via Gmail (no session connect required)",
      inputSchema: activeConnectionSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(activeConnectionSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        return toolResult(okResponse(withScopedUiHints(binding, binding)));
      } catch (error) {
        logger.error("active_connection failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "unread_mails",
    {
      title: "Unread mails",
      description:
        "Primary unread only. Tool message includes a chat Markdown block (summaries + reply drafts + .md path) then JSON. Writes email_drafts/unread_mails_<timestamp>.md by default (writeMarkdownFile false to skip). No Gmail draft until draft_email. Optional accountAlias.",
      inputSchema: unreadMailsSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(unreadMailsSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await fetchUnreadSummariesAndReplyDrafts({ alias: binding.alias, ...payload });
        return unreadMailsToolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("unread_mails failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List Gmail accounts",
      description:
        "Returns token file aliases (strings). Pass one as accountAlias on other tools when the MCP client shares one default session across chats.",
      inputSchema: listAccountsSchema
    },
    async (args) => {
      try {
        parseSchema(listAccountsSchema, args);
        const accounts = await listAccounts();
        return toolResult(okResponse({ accounts }));
      } catch (error) {
        logger.error("list_accounts failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "search_emails",
    {
      title: "Search emails",
      description:
        "Search Gmail by arbitrary query (includes read mail). For unread-only Primary, use unread_mails instead. Optional accountAlias overrides the session binding.",
      inputSchema: searchEmailsSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(searchEmailsSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await searchEmails({ alias: binding.alias, ...payload });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("search_emails failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "get_email",
    {
      title: "Get email",
      description:
        "Fetch a full email by message id. Optional accountAlias from list_accounts overrides the session binding.",
      inputSchema: getEmailSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(getEmailSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await getEmail({ alias: binding.alias, ...payload });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("get_email failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "list_threads",
    {
      title: "List threads",
      description:
        "List Gmail threads by optional query. Optional accountAlias from list_accounts overrides the session binding.",
      inputSchema: listThreadsSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(listThreadsSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await listThreads({ alias: binding.alias, ...payload });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("list_threads failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "draft_email",
    {
      title: "Draft email",
      description:
        "Create a new email draft in Gmail. Optional accountAlias from list_accounts overrides the session binding.",
      inputSchema: draftEmailSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(draftEmailSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await createDraft({ alias: binding.alias, ...payload });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("draft_email failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "send_email",
    {
      title: "Send email",
      description:
        "Send an email immediately via Gmail. Optional accountAlias from list_accounts overrides the session binding.",
      inputSchema: sendEmailSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(sendEmailSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await sendEmail({ alias: binding.alias, ...payload });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("send_email failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "review_email_drafts",
    {
      title: "Review email drafts",
      description:
        "Human-in-the-loop email reply workflow: fetches unread emails, generates draft replies, and returns them all at once so the user can review each one before anything is sent. " +
        "Use this tool when the user wants to review drafts before sending, reply to emails with approval control, or check their inbox with a review step. " +
        "IMPORTANT — after calling this tool, always: (1) display ALL drafts together in a numbered list with [A] Approve & Send | [E] Edit | [S] Skip options per email, " +
        "(2) ask the user what to do for each, (3) revise any marked Edit and show the revised draft before sending, " +
        "(4) call send_email only for explicitly approved emails, (5) call mark_as_read for every processed email. " +
        "Never send without the user saying approve/yes/A for that specific email.",
      inputSchema: reviewEmailDraftsSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(reviewEmailDraftsSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await fetchUnreadSummariesAndReplyDrafts({
          alias: binding.alias,
          ...payload,
          writeMarkdownFile: false
        });
        return unreadMailsToolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("review_email_drafts failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "mark_as_read",
    {
      title: "Mark email as read",
      description:
        "Mark a Gmail message as read by removing the UNREAD label. " +
        "Call this for every email that has been processed through the review workflow — whether the user approved, edited, or skipped it. " +
        "Pass the messageId from review_email_drafts results. Optional accountAlias overrides the session binding.",
      inputSchema: markAsReadSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(markAsReadSchema, args);
        const binding = await resolveActiveBinding(scopeKey, input.accountAlias);
        const payload = omitAccountAlias(input);
        const data = await markAsRead({ alias: binding.alias, ...payload });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("mark_as_read failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );
}


