import { env } from "../config/env.js";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT } from "../config/constants.js";
import { formatFullMessage, formatMessageSummary, encodeEmail } from "../utils/gmail-formatters.js";
import { safeNumber } from "../utils/validators.js";
import { createGmailClient } from "./gmail-client.js";
import { promises as fs } from "fs";
import path from "path";

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

function sanitizeSubject(subject) {
  const cleaned = String(subject || "no-subject")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "no-subject";
}

function timestampForFilename(inputDate) {
  const date = inputDate ? new Date(inputDate) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
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

async function ensureDraftStore() {
  const draftsDir = path.join(env.PROJECT_ROOT, "email_drafts");
  const indexPath = path.join(draftsDir, "processed-index.json");
  await fs.mkdir(draftsDir, { recursive: true });
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    return { draftsDir, indexPath, index: JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { draftsDir, indexPath, index: {} };
  }
}

function buildThreadContext(threadData, currentMessageId) {
  const messages = threadData.messages || [];
  return messages
    .filter((msg) => msg.id !== currentMessageId)
    .slice(-5)
    .map((msg) => formatMessageSummary(msg));
}

function renderDraftMarkdown({ email, intent, replyDraft, threadContext, alias }) {
  return `# Email Reply Draft

- Account Alias: ${alias}
- Message ID: ${email.id}
- Thread ID: ${email.threadId || ""}
- Subject: ${email.subject || ""}
- From: ${email.from || ""}
- To: ${email.to || ""}
- Timestamp: ${email.internalDate || email.date || ""}

## Intent
${intent.summary}

## Thread Context (Visible)
${threadContext.length ? "" : "No additional thread context found."}
${threadContext
  .map(
    (item) =>
      `- ${item.internalDate || item.date || ""} | ${item.from || ""} | ${item.subject || ""} | ${item.snippet || ""}`
  )
  .join("\n")}

## Email Body
${email.bodyText || ""}

## Draft Reply
${replyDraft}
`;
}

export async function processUnreadEmailsToDrafts({ alias, maxResults, query }) {
  const { gmail } = await createGmailClient(alias);
  const boundedMaxResults = safeNumber(maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);
  const unreadQuery = query?.trim() ? `is:unread ${query}` : "is:unread";

  const { draftsDir, indexPath, index } = await ensureDraftStore();
  const response = await gmail.users.messages.list({
    userId: env.DEFAULT_GMAIL_USER_ID,
    q: unreadQuery,
    maxResults: boundedMaxResults
  });

  const unreadMessages = response.data.messages || [];
  const createdFiles = [];
  const skipped = [];

  for (const item of unreadMessages) {
    if (index[item.id]) {
      skipped.push({ messageId: item.id, reason: "already_processed", file: index[item.id] });
      continue;
    }

    const fullRes = await gmail.users.messages.get({
      userId: env.DEFAULT_GMAIL_USER_ID,
      id: item.id,
      format: "full"
    });
    const fullEmail = formatFullMessage(fullRes.data);

    const threadRes = await gmail.users.threads.get({
      userId: env.DEFAULT_GMAIL_USER_ID,
      id: fullEmail.threadId,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"]
    });
    const threadContext = buildThreadContext(threadRes.data, fullEmail.id);
    const intent = extractIntent(fullEmail);
    const replyDraft = buildReplyDraft(fullEmail, intent);

    const timestamp = timestampForFilename(fullEmail.internalDate);
    const subject = sanitizeSubject(fullEmail.subject);
    const filename = `${timestamp}_${subject}.md`;
    const filePath = path.join(draftsDir, filename);
    const markdown = renderDraftMarkdown({
      email: fullEmail,
      intent,
      replyDraft,
      threadContext,
      alias
    });

    await fs.writeFile(filePath, markdown, "utf8");
    index[item.id] = filename;
    createdFiles.push({ messageId: item.id, filename, filePath });
  }

  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  return {
    folder: draftsDir,
    processedCount: createdFiles.length,
    skippedCount: skipped.length,
    createdFiles,
    skipped
  };
}
