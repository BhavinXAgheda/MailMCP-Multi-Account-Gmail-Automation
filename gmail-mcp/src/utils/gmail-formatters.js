function getHeader(headers = [], name) {
  const match = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return match?.value ?? "";
}

function extractText(parts = []) {
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf8");
    }
    if (part.parts?.length) {
      const nested = extractText(part.parts);
      if (nested) return nested;
    }
  }
  return "";
}

export function formatMessageSummary(message) {
  const payload = message.payload ?? {};
  const headers = payload.headers ?? [];

  return {
    id: message.id,
    threadId: message.threadId,
    snippet: message.snippet ?? "",
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    internalDate: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null
  };
}

export function formatFullMessage(message) {
  const payload = message.payload ?? {};
  const headers = payload.headers ?? [];
  const bodyText =
    payload.body?.data ? Buffer.from(payload.body.data, "base64").toString("utf8") : extractText(payload.parts);

  return {
    ...formatMessageSummary(message),
    labelIds: message.labelIds ?? [],
    bodyText
  };
}

export function encodeEmail(rawEmail) {
  return Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
