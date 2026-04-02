import { env } from "../config/env.js";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT } from "../config/constants.js";
import { formatFullMessage, formatMessageSummary, encodeEmail } from "../utils/gmail-formatters.js";
import { safeNumber } from "../utils/validators.js";
import { createGmailClient } from "./gmail-client.js";
import { promises as fs } from "fs";
import path from "path";

/** Unread messages in the Inbox Primary tab only (excludes Promotions, Social, Updates, Forums). */
const UNREAD_INBOX_QUERY = "in:inbox is:unread category:primary";

/** Require both labels so messages.list cannot return read mail from a loose query. */
const UNREAD_INBOX_LABEL_IDS = ["INBOX", "UNREAD"];

function unreadInboxListRequest(boundedMaxResults, query, pageToken) {
  const trimmed = query?.trim() ? query.trim() : "";
  const q = trimmed ? `${UNREAD_INBOX_QUERY} ${trimmed}` : UNREAD_INBOX_QUERY;
  return {
    userId: env.DEFAULT_GMAIL_USER_ID,
    q,
    labelIds: UNREAD_INBOX_LABEL_IDS,
    includeSpamTrash: false,
    maxResults: boundedMaxResults,
    pageToken
  };
}

function messageIsUnreadInApi(message) {
  const ids = message?.labelIds;
  return Array.isArray(ids) && ids.includes("UNREAD");
}

export async function searchEmails({ alias, query, maxResults, pageToken }) {
  const { gmail } = await createGmailClient(alias);
  const boundedMaxResults = safeNumber(maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);

  const response = await gmail.users.messages.list({
    userId: env.DEFAULT_GMAIL_USER_ID,
    q: query || "",
    maxResults: boundedMaxResults,
    pageToken
  });

  const messages = response.data.messages || [];
  const details = await Promise.all(
    messages.map((message) =>
      gmail.users.messages.get({
        userId: env.DEFAULT_GMAIL_USER_ID,
        id: message.id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"]
      })
    )
  );

  return {
    nextPageToken: response.data.nextPageToken || null,
    resultSizeEstimate: response.data.resultSizeEstimate || 0,
    messages: details.map((item) => formatMessageSummary(item.data))
  };
}

export async function getEmail({ alias, messageId }) {
  const { gmail } = await createGmailClient(alias);
  const response = await gmail.users.messages.get({
    userId: env.DEFAULT_GMAIL_USER_ID,
    id: messageId,
    format: "full"
  });
  return formatFullMessage(response.data);
}

export async function listThreads({ alias, query, maxResults, pageToken }) {
  const { gmail } = await createGmailClient(alias);
  const boundedMaxResults = safeNumber(maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);

  const response = await gmail.users.threads.list({
    userId: env.DEFAULT_GMAIL_USER_ID,
    q: query || "",
    maxResults: boundedMaxResults,
    pageToken
  });

  const threads = response.data.threads || [];
  const threadDetails = await Promise.all(
    threads.map((thread) =>
      gmail.users.threads.get({
        userId: env.DEFAULT_GMAIL_USER_ID,
        id: thread.id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"]
      })
    )
  );

  return {
    nextPageToken: response.data.nextPageToken || null,
    resultSizeEstimate: response.data.resultSizeEstimate || 0,
    threads: threadDetails.map((item) => {
      const firstMessage = item.data.messages?.[0];
      const lastMessage = item.data.messages?.[item.data.messages.length - 1];
      return {
        id: item.data.id,
        historyId: item.data.historyId,
        messageCount: item.data.messages?.length || 0,
        snippet: item.data.snippet || "",
        firstMessage: firstMessage ? formatMessageSummary(firstMessage) : null,
        lastMessage: lastMessage ? formatMessageSummary(lastMessage) : null
      };
    })
  };
}

function buildRawEmail({ to, subject, body, cc, bcc, html }) {
  const formatAddress = (addr) => (Array.isArray(addr) ? addr.join(", ") : addr);

  const boundary = "__boundary__";
  let headers = `To: ${formatAddress(to)}\r\n`;
  headers += `Subject: ${subject}\r\n`;
  if (cc) headers += `Cc: ${formatAddress(cc)}\r\n`;
  if (bcc) headers += `Bcc: ${formatAddress(bcc)}\r\n`;

  if (html) {
    headers += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    headers += `--${boundary}\r\n`;
    headers += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
    headers += `${body}\r\n\r\n`;
    headers += `--${boundary}\r\n`;
    headers += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
    headers += `${html}\r\n\r\n`;
    headers += `--${boundary}--`;
  } else {
    headers += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
    headers += `${body}`;
  }

  return encodeEmail(headers);
}

export async function sendEmail({ alias, to, subject, body, cc, bcc, html }) {
  const { gmail } = await createGmailClient(alias);
  const raw = buildRawEmail({ to, subject, body, cc, bcc, html });

  const response = await gmail.users.messages.send({
    userId: env.DEFAULT_GMAIL_USER_ID,
    requestBody: { raw }
  });

  return {
    id: response.data.id,
    threadId: response.data.threadId,
    labelIds: response.data.labelIds || []
  };
}

export async function createDraft({ alias, to, subject, body, cc, bcc, html }) {
  const { gmail } = await createGmailClient(alias);
  const raw = buildRawEmail({ to, subject, body, cc, bcc, html });

  const response = await gmail.users.drafts.create({
    userId: env.DEFAULT_GMAIL_USER_ID,
    requestBody: {
      message: { raw }
    }
  });

  return {
    id: response.data.id,
    message: response.data.message ? formatMessageSummary(response.data.message) : null
  };
}

function extractIntent(email) {
  const text = `${email.subject || ""}\n${email.bodyText || ""}`.toLowerCase();
  const hasQuestion = text.includes("?");
  const actionWords = ["please", "can you", "could you", "kindly", "need", "request", "let me know"];
  const informationalWords = [
    "fyi",
    "for your information",
    "announcement",
    "update only",
    "no action needed",
    "just sharing"
  ];

  if (informationalWords.some((word) => text.includes(word)) && !hasQuestion) {
    return { type: "informational", summary: "Informational update; no direct action requested." };
  }

  if (hasQuestion || actionWords.some((word) => text.includes(word))) {
    return { type: "actionable", summary: "Sender is requesting input/action or asking a question." };
  }

  return { type: "informational", summary: "General update with no explicit request detected." };
}

function buildReplyDraft(email, intent) {
  if (intent.type === "informational") return "No reply needed";

  const senderName = (email.from || "").split("<")[0].trim() || "there";
  const subjectLine = email.subject || "your email";
  return [
    `Hi ${senderName},`,
    "",
    `Thank you for your email regarding "${subjectLine}".`,
    "I reviewed your message and the thread context.",
    "I will proceed with the requested items and share a complete update shortly.",
    "",
    "Please let me know if there are any additional details or deadlines I should consider.",
    "",
    "Best regards,"
  ].join("\n");
}

function extractReplyToAddress(fromHeader) {
  const raw = String(fromHeader || "").trim();
  const bracket = raw.match(/<([^>]+)>/);
  if (bracket) return bracket[1].trim();
  const emailMatch = raw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return emailMatch ? emailMatch[0] : "";
}

function replySubjectLine(original) {
  const s = String(original || "").trim();
  if (/^re:\s/i.test(s)) return s;
  return s ? `Re: ${s}` : "Re: (no subject)";
}

function excerptBody(bodyText, maxLen) {
  const t = (bodyText || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

function firstSentencePreview(text) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "No preview.";
  const sentence = t.split(/(?<=[.!?])\s+/)[0];
  const clip = sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
  return clip;
}

/** Used when intent is informational: still a full draft in chat (not “no reply”). */
function buildGenericReplyDraft(email) {
  const senderName = (email.from || "").split("<")[0].trim().replace(/"/g, "") || "there";
  const subjectLine = email.subject || "your message";
  return [
    `Hi ${senderName},`,
    "",
    `Thank you for your note regarding "${subjectLine}". I've read it and will follow up if needed.`,
    "",
    "Best regards,"
  ].join("\n");
}

function formatDraftReplyAsText({ to, subject, body }) {
  const toLine = to || "(add recipient)";
  return [`To: ${toLine}`, `Subject: ${subject}`, "", body].join("\n");
}

function unreadMailsMarkdownFilenameUtc() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`
  );
}

async function saveUnreadDraftsMarkdownFile({ alias, listQuery, draftsMarkdown, itemCount }) {
  const draftsDir = path.join(env.PROJECT_ROOT, "email_drafts");
  await fs.mkdir(draftsDir, { recursive: true });
  const filename = `unread_mails_${unreadMailsMarkdownFilenameUtc()}.md`;
  const absPath = path.join(draftsDir, filename);
  const header = [
    "# Unread mail — reply drafts",
    "",
    `- **Account alias:** ${alias}`,
    `- **Gmail list query:** \`${listQuery}\``,
    `- **Messages in this file:** ${itemCount}`,
    `- **Generated (UTC):** ${new Date().toISOString()}`,
    "",
    "---",
    "",
    ""
  ].join("\n");
  await fs.writeFile(absPath, header + draftsMarkdown, "utf8");
  return path.relative(env.PROJECT_ROOT, absPath);
}

function formatDraftReplyMarkdown(draftReply, messageId) {
  const to = draftReply.to || "*(add recipient)*";
  const { subject, body } = draftReply;
  const lines = [
    "### Reply draft",
    "",
    `- **messageId:** \`${messageId}\``,
    `- **To:** ${to}`,
    `- **Subject:** ${subject}`,
    "",
    "**Body**",
    "",
    body
  ];
  return lines.join("\n");
}

const UNREAD_MAILS_CHAT_PROMPT =
  "The tool response already includes a Markdown 'chat view' block the user can read in the tool output. Repeat or paraphrase it in your reply if the client hid it. " +
  "No Gmail Draft unless the user asks for draft_email.";

/**
 * Lists unread Primary-inbox messages; returns draftsMarkdown + optional email_drafts/*.md file (see writeMarkdownFile).
 */
/**
 * Marks a Gmail message as read by removing the UNREAD label.
 * Call this after the user has reviewed and acted on a message.
 */
export async function markAsRead({ alias, messageId }) {
  const { gmail } = await createGmailClient(alias);
  const response = await gmail.users.messages.modify({
    userId: env.DEFAULT_GMAIL_USER_ID,
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] }
  });
  return {
    messageId: response.data.id,
    labelIds: response.data.labelIds || []
  };
}

export async function fetchUnreadSummariesAndReplyDrafts({ alias, maxResults, query, writeMarkdownFile = true }) {
  const { gmail } = await createGmailClient(alias);
  const boundedMaxResults = safeNumber(maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);
  const listParams = unreadInboxListRequest(boundedMaxResults, query, undefined);

  const response = await gmail.users.messages.list(listParams);

  const unreadMessages = response.data.messages || [];
  const items = [];

  for (const item of unreadMessages) {
    const fullRes = await gmail.users.messages.get({
      userId: env.DEFAULT_GMAIL_USER_ID,
      id: item.id,
      format: "full"
    });
    const fullEmail = formatFullMessage(fullRes.data);
    if (!messageIsUnreadInApi(fullRes.data)) {
      continue;
    }

    const threadRes = await gmail.users.threads.get({
      userId: env.DEFAULT_GMAIL_USER_ID,
      id: fullEmail.threadId,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"]
    });
    const threadMessageCount = threadRes.data.messages?.length || 1;

    const intent = extractIntent(fullEmail);
    const actionableDraft = buildReplyDraft(fullEmail, intent);
    const replyTo = extractReplyToAddress(fullEmail.from);
    const subject = replySubjectLine(fullEmail.subject);
    const preview = firstSentencePreview(fullEmail.bodyText || fullEmail.snippet);
    const mailSummary = [intent.summary, preview && preview !== "No preview." ? preview : null]
      .filter(Boolean)
      .join(" ");
    const bodyExcerpt = excerptBody(fullEmail.bodyText, 500) || null;
    const replyRecommended = intent.type === "actionable" && actionableDraft !== "No reply needed";
    const draftBody = replyRecommended ? actionableDraft : buildGenericReplyDraft(fullEmail);

    const draftReply = {
      to: replyTo || null,
      subject,
      body: draftBody
    };
    const draftReplyAsText = formatDraftReplyAsText(draftReply);
    const draftReplyMarkdown = formatDraftReplyMarkdown(draftReply, fullEmail.id);

    items.push({
      messageId: fullEmail.id,
      threadId: fullEmail.threadId,
      from: fullEmail.from,
      to: fullEmail.to,
      subject: fullEmail.subject,
      date: fullEmail.date || fullEmail.internalDate,
      threadMessageCount,
      intentType: intent.type,
      intentDetail: intent.summary,
      mailSummary,
      mailSummaryMarkdown: `**Summary** (${fullEmail.id}): ${mailSummary}`,
      bodyExcerpt,
      replyRecommended,
      draftReply,
      draftReplyAsText,
      draftReplyMarkdown,
      parseNote: replyTo ? null : "Could not parse reply address from From; set draftReply.to before draft_email/send_email."
    });
  }

  const draftsMarkdown =
    items.length === 0
      ? "*No unread matched this run — no reply drafts.*"
      : items.map((row) => row.draftReplyMarkdown).join("\n\n---\n\n");

  let markdownFile = null;
  let markdownSaveError = null;
  if (writeMarkdownFile && items.length > 0) {
    try {
      markdownFile = await saveUnreadDraftsMarkdownFile({
        alias,
        listQuery: listParams.q,
        draftsMarkdown,
        itemCount: items.length
      });
    } catch (err) {
      markdownSaveError = err?.message || String(err);
    }
  }

  return {
    nextPageToken: response.data.nextPageToken || null,
    gmailListQuery: listParams.q,
    gmailListLabelIds: UNREAD_INBOX_LABEL_IDS,
    unreadCount: items.length,
    chatOnly: true,
    chatOutputNote: markdownFile
      ? `Saved reply drafts to **${markdownFile}** (Markdown on disk). Still no Gmail draft until you use draft_email.`
      : writeMarkdownFile && items.length > 0 && markdownSaveError
        ? `Could not write .md file: ${markdownSaveError}. Use draftsMarkdown from JSON.`
        : items.length === 0
          ? "No unread matched — no .md file written. draftsMarkdown explains why."
          : !writeMarkdownFile
            ? "writeMarkdownFile was false — no .md on disk; use draftsMarkdown in JSON."
            : "Use draftsMarkdown from JSON.",
    draftsMarkdown,
    markdownFile,
    markdownSaved: Boolean(markdownFile),
    markdownSaveError: markdownSaveError || undefined,
    feedbackPrompt: UNREAD_MAILS_CHAT_PROMPT,
    noUnreadHint:
      items.length === 0
        ? "No unread messages matched this query (Primary + INBOX + UNREAD). Your unread may be in another tab, archived, or already read."
        : null,
    items
  };
}
