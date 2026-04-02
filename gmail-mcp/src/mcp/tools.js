import {
  beginScopedAuthorization,
  completeScopedAuthorization,
  getScopedBinding,
  listAccounts
} from "../auth/account-manager.js";
import {
  getEmail,
  listThreads,
  searchEmails,
  createDraft,
  sendEmail,
  processUnreadEmailsToDrafts
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
  monitorUnreadEmailsSchema,
  unreadMessageSchema,
  searchEmailsSchema,
  draftEmailSchema,
  sendEmailSchema
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
  return value || "default";
}

function requireScopedBinding(scopeKey) {
  const binding = getScopedBinding(scopeKey);
  if (!binding) {
    throw new AppError(
      'No active connected email for this chat. Run connect_account first with "Connect <email> work|personal" and complete_connect_account.',
      "NO_ACTIVE_CONNECTION",
      400
    );
  }
  return binding;
}

function withScopedUiHints(binding, data = {}) {
  return {
    ...data,
    activeEmail: binding.email,
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
        'Parses "Connect <email> work|personal" and returns OAuth URL for this chat session',
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
              "Open authUrl, approve access, then call complete_connect_account with code. This chat will be locked to this email.",
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
      description: "Completes OAuth connection and binds this chat session to one email account",
      inputSchema: completeConnectAccountSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(completeConnectAccountSchema, args);
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
      description: "Shows currently active email bound to this chat session",
      inputSchema: activeConnectionSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        parseSchema(activeConnectionSchema, args);
        const binding = requireScopedBinding(scopeKey);
        return toolResult(okResponse(withScopedUiHints(binding, binding)));
      } catch (error) {
        logger.error("active_connection failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "monitor_unread_emails",
    {
      title: "Monitor unread emails",
      description:
        "Scans unread emails, builds intent-aware reply drafts, and saves markdown files without duplicates",
      inputSchema: monitorUnreadEmailsSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(monitorUnreadEmailsSchema, args);
        const binding = requireScopedBinding(scopeKey);
        const data = await processUnreadEmailsToDrafts({ alias: binding.alias, ...input });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("monitor_unread_emails failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "unread_message",
    {
      title: "Unread message shortcut",
      description: "Shortcut to process unread emails and generate markdown reply drafts",
      inputSchema: unreadMessageSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        parseSchema(unreadMessageSchema, args);
        const binding = requireScopedBinding(scopeKey);
        const data = await processUnreadEmailsToDrafts({ alias: binding.alias });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("unread_message failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List Gmail accounts",
      description: "Returns all authorized Gmail account aliases",
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
      description: "Search Gmail messages by account alias and query",
      inputSchema: searchEmailsSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(searchEmailsSchema, args);
        const binding = requireScopedBinding(scopeKey);
        const data = await searchEmails({ alias: binding.alias, ...input });
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
      description: "Fetch a full email by message id",
      inputSchema: getEmailSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(getEmailSchema, args);
        const binding = requireScopedBinding(scopeKey);
        const data = await getEmail({ alias: binding.alias, ...input });
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
      description: "List Gmail threads by account alias and optional query",
      inputSchema: listThreadsSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(listThreadsSchema, args);
        const binding = requireScopedBinding(scopeKey);
        const data = await listThreads({ alias: binding.alias, ...input });
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
      description: "Create a new email draft in Gmail",
      inputSchema: draftEmailSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(draftEmailSchema, args);
        const binding = requireScopedBinding(scopeKey);
        const data = await createDraft({ alias: binding.alias, ...input });
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
      description: "Send an email immediately via Gmail",
      inputSchema: sendEmailSchema
    },
    async (args, extra) => {
      try {
        const scopeKey = resolveScopeKey(extra);
        const input = parseSchema(sendEmailSchema, args);
        const binding = requireScopedBinding(scopeKey);
        const data = await sendEmail({ alias: binding.alias, ...input });
        return toolResult(okResponse(withScopedUiHints(binding, data)));
      } catch (error) {
        logger.error("send_email failed", { message: error.message });
        return toolResult(errorResponse(error));
      }
    }
  );
}


