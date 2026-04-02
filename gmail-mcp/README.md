# Gmail MCP Server — Full Setup Guide

A production-ready Gmail MCP server that connects your Gmail accounts to Claude Code. Follow every step below from scratch.

---

## Prerequisites

- Node.js 18+ installed
- A Google account
- Claude Code CLI installed

---

## Step 1 — Create a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Give it a name (e.g. `gmail-mcp`) and click **Create**
4. Make sure the new project is selected in the dropdown

---

## Step 2 — Enable the Gmail API

1. In the left sidebar go to **APIs & Services → Library**
2. Search for **Gmail API**
3. Click it → click **Enable**

---

## Step 3 — Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** → click **Create**
3. Fill in:
   - **App name**: anything (e.g. `Gmail MCP`)
   - **User support email**: your email
   - **Developer contact email**: your email
4. Click **Save and Continue** through all steps (no need to add scopes manually here)
5. On the final screen click **Back to Dashboard**
6. Under **Test users** → click **Add Users** → add the Gmail addresses you want to authorize

---

## Step 4 — Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. For **Application type** select **Desktop app**
4. Give it a name (e.g. `gmail-mcp-desktop`) → click **Create**
5. A dialog appears — click **Download JSON**
6. Rename the downloaded file to `credentials.json`
7. Move it to the root of this project:

```
gmail-mcp/
└── credentials.json   ← here
```

---

## Step 5 — Install Dependencies

```bash
cd /path/to/gmail-mcp
npm install
```

---

## Step 6 — Authorize Gmail Accounts

Run this for each Gmail account you want to use, giving each a unique alias:

```bash
npm run auth -- --alias personal
npm run auth -- --alias work
```

Each command will:
1. Print an authorization URL in the terminal
2. Open your browser (or paste the URL manually)
3. Ask you to log in and grant access
4. Save a token file at `accounts/<alias>.json`

You can authorize as many accounts as you want with different aliases.

---

## Step 7 — Add to Claude Code

Run this once in your terminal:

```bash
claude mcp add gmail-mcp node /path/to/gmail-mcp/src/index.js
```

Replace `/path/to/gmail-mcp` with the actual absolute path to this project.

---

## Step 8 — Verify the Connection

Inside Claude Code, type:

```
/mcp
```

You should see `gmail-mcp` listed as connected with these tools available:

| Tool | Description |
|---|---|
| `list_accounts` | List all authorized Gmail accounts |
| `search_emails` | Search emails by query in a given account |
| `get_email` | Fetch a single email by message ID |
| `list_threads` | List email threads by query |

---

## Step 9 — Use It

You can now ask Claude things like:

- *"List my Gmail accounts"*
- *"Search my personal Gmail for emails from billing in the last 30 days"*
- *"Get the latest invoice thread from my work account"*
- *"Show unread emails in my work inbox"*

---

## Project Structure

```
.
├── accounts/              ← token files per alias (auto-created)
│   └── personal.json
│   └── work.json
├── src/
│   ├── auth/
│   │   ├── account-manager.js
│   │   ├── authorize-account.js
│   │   ├── oauth-client.js
│   │   └── token-store.js
│   ├── config/
│   │   ├── constants.js
│   │   └── env.js
│   ├── gmail/
│   │   ├── gmail-client.js
│   │   └── gmail-service.js
│   ├── mcp/
│   │   ├── server.js
│   │   ├── tool-schemas.js
│   │   └── tools.js
│   ├── utils/
│   │   ├── errors.js
│   │   ├── gmail-formatters.js
│   │   ├── logger.js
│   │   └── validators.js
│   └── index.js
├── credentials.json       ← your Google OAuth credentials (do not commit)
├── .env
└── package.json
```

---

## Notes

- `credentials.json` and `accounts/*.json` contain sensitive tokens — never commit them to git
- Tokens are auto-refreshed when Google rotates them
- To revoke access, delete the corresponding `accounts/<alias>.json` file
