import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { authorizeAlias, getAuthorizationUrl } from "./account-manager.js";
import { logger } from "../utils/logger.js";

function parseAliasFromArgs(argv) {
  const aliasIndex = argv.indexOf("--alias");
  if (aliasIndex === -1 || !argv[aliasIndex + 1]) {
    throw new Error('Usage: npm run auth -- --alias <account_alias>');
  }
  return argv[aliasIndex + 1];
}

async function main() {
  const alias = parseAliasFromArgs(process.argv);
  const authUrl = await getAuthorizationUrl();

  console.log(`\nAuthorize alias "${alias}" by opening this URL:\n`);
  console.log(authUrl);
  console.log("\nAfter approving access, paste the returned authorization code.\n");

  const rl = readline.createInterface({ input, output });
  const code = (await rl.question("Authorization code: ")).trim();
  rl.close();

  await authorizeAlias(alias, code);
  logger.info("Account authorization completed", { alias });
}

main().catch((error) => {
  logger.error("Account authorization failed", { message: error.message });
  process.exit(1);
});
