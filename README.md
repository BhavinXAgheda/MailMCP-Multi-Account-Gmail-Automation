# Gmail MCP Server (Multi-Account + Draft Workflow)

Production-ready Gmail MCP server with OAuth2, multi-account support, unread-mail summarization, and human-reviewed reply drafts.

## What This Project Does

- Connects one or more Gmail accounts using OAuth2 and stores tokens per alias.
- Exposes Gmail actions as MCP tools over stdio.
- Supports session-scoped account binding so each chat can stay pinned to one email account.
- Provides an unread workflow that generates summaries and reply drafts before anything is sent.
- Optionally saves generated unread reply drafts to `email_drafts/unread_mails_<timestamp>.md`.

## Features

- Multi-account auth (`accounts/<alias>.json` token files)
- Scoped chat/session account binding (`connect_account` + `complete_connect_account`)
- Inbox search and message/thread retrieval
- Draft and send email tools
- Review-first workflow with explicit user approval
- Mark-as-read post-processing tool

## Tech Stack

- Node.js (ES Modules)
- `@modelcontextprotocol/sdk`
- `googleapis`
- `zod`
- `dotenv`

## Project Structure

```text
.
├── src/
│   ├── auth/
│   ├── config/
│   ├── gmail/
│   ├── mcp/
│   ├── utils/
│   └── index.js
├── accounts/        # OAuth tokens per alias (ignored by git)
├── email_drafts/    # Generated unread draft markdown files
├── credentials.json # Google OAuth desktop credentials (ignored by git)
├── .env
├── .env.example
└── package.json
```

## Prerequisites

- Node.js 18+
- A Google Cloud project with Gmail API enabled
- OAuth consent screen configured
- OAuth Client ID (Desktop app) downloaded as `credentials.json`

## Installation

```bash
npm install
cp .env.example .env
```

## Environment Variables

From `.env.example`:

```env
GOOGLE_CREDENTIALS_PATH=./credentials.json
ACCOUNTS_DIR=./accounts
DEFAULT_GMAIL_USER_ID=me
LOG_LEVEL=info
```

Optional:

- `GMAIL_MCP_SCOPE_KEY`: fallback scope key when MCP client does not send a per-chat session id.

## Google OAuth Setup (One-Time)

1. Create/select a Google Cloud project.
2. Enable **Gmail API**.
3. Configure OAuth consent screen (External/Internal as needed).
4. Add your Gmail addresses as test users (if app is in testing mode).
5. Create **OAuth Client ID** with application type **Desktop app**.
6. Download JSON and place it at project root as `credentials.json`.

## Authorize Gmail Accounts

Authorize each Gmail account with a unique alias:

```bash
npm run auth -- --alias personal
npm run auth -- --alias work
```

What happens:

- A local callback server starts automatically.
- Browser opens Google consent.
- Auth code is captured automatically.
- Tokens are saved to `accounts/<alias>.json`.

## Run the MCP Server

```bash
npm start
```

This starts the stdio MCP server entrypoint at `src/index.js`.

## Add to MCP Client

Example (Claude Code):

```bash
claude mcp add gmail-mcp node /absolute/path/to/gamil/src/index.js
```

After adding, verify available tools in your client (often via `/mcp`).

## Tool Catalog

- `connect_account`  
  Starts account connection from a natural command string (for example: `Connect you@example.com work`).

- `complete_connect_account`  
  Completes OAuth flow for the current scoped session (normally call immediately after `connect_account`).

- `active_connection`  
  Shows active email binding for current scope (or resolves explicit `accountAlias`).

- `list_accounts`  
  Lists available token aliases from `accounts/*.json`.

- `unread_mails`  
  Lists unread **Primary Inbox** messages, generates summaries + reply drafts, and writes markdown to `email_drafts/` by default.

- `review_email_drafts`  
  Review-first version of unread workflow (no markdown file write, still returns all drafts together).

- `search_emails`  
  Searches messages by arbitrary Gmail query.

- `get_email`  
  Fetches a full message by `messageId`.

- `list_threads`  
  Lists threads by query.

- `draft_email`  
  Creates a Gmail draft.

- `send_email`  
  Sends email immediately.

- `mark_as_read`  
  Removes `UNREAD` label from a message after processing.

## Recommended Human-in-the-Loop Workflow

1. `connect_account`
2. `complete_connect_account`
3. `review_email_drafts` (or `unread_mails`)
4. Let user approve/edit/skip each draft
5. `send_email` only for explicitly approved drafts
6. `mark_as_read` for processed messages

## Security Notes

- Never commit `credentials.json`, `.env`, or `accounts/*.json`.
- Token files include OAuth refresh credentials; treat them as secrets.
- Rotate/revoke account access from Google Account Security if needed.

## Troubleshooting

- **Missing environment variable**: ensure `.env` exists and keys are set.
- **OAuth opens but does not finish**: make sure browser can reach localhost callback URL.
- **No unread returned**: tool filters to `in:inbox is:unread category:primary`; unread in Promotions/Social will be excluded.
- **No parsed reply address**: some sender formats are ambiguous; set recipient explicitly before `draft_email` or `send_email`.

## Development Scripts

- `npm start` - start MCP server
- `npm run auth -- --alias <name>` - authorize/store tokens for an account alias

## License

MIT
