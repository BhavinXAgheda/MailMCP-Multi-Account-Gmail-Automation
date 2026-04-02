import { promises as fs } from "fs";
import { google } from "googleapis";
import { env } from "../config/env.js";
import { SCOPES } from "../config/constants.js";
import { AppError } from "../utils/errors.js";

async function readCredentialsFile() {
  const filePath = env.GOOGLE_CREDENTIALS_PATH;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new AppError(
        `Google credentials file not found at ${filePath}`,
        "CREDENTIALS_NOT_FOUND",
        500
      );
    }
    throw new AppError("Invalid credentials.json format", "INVALID_CREDENTIALS_FILE", 500);
  }
}

export async function createOAuthClient() {
  const credentials = await readCredentialsFile();
  const config = credentials.installed || credentials.web;

  if (!config?.client_id || !config?.client_secret || !config?.redirect_uris?.length) {
    throw new AppError(
      "credentials.json must include client_id, client_secret, and redirect_uris",
      "INVALID_CREDENTIALS_FILE",
      500
    );
  }

  return new google.auth.OAuth2(config.client_id, config.client_secret, config.redirect_uris[0]);
}

export function buildAuthUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
  });
}

export async function exchangeCodeForTokens(oauth2Client, code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}
