import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// MCP clients (e.g. Claude Desktop) often spawn the server without setting cwd;
// resolving from the repo root avoids paths like "/accounts".
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

function requiredEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveFromProjectRoot(maybeRelative) {
  if (path.isAbsolute(maybeRelative)) return maybeRelative;
  return path.resolve(PROJECT_ROOT, maybeRelative);
}

export const env = {
  PROJECT_ROOT,
  GOOGLE_CREDENTIALS_PATH: resolveFromProjectRoot(
    requiredEnv("GOOGLE_CREDENTIALS_PATH", "./credentials.json")
  ),
  ACCOUNTS_DIR: resolveFromProjectRoot(requiredEnv("ACCOUNTS_DIR", "./accounts")),
  DEFAULT_GMAIL_USER_ID: requiredEnv("DEFAULT_GMAIL_USER_ID", "me"),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info"
};
