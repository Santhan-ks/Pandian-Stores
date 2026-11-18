import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { readFileSync } from "node:fs";

export const operationsDirectory = resolve(
  process.env.PANDIAN_OPERATIONS_DIR ??
    resolve(homedir(), ".pandian-stores", "hardened"),
);
const inside = relative(process.cwd(), operationsDirectory);
if (
  !isAbsolute(operationsDirectory) ||
  inside === "" ||
  (!inside.startsWith("..") && !isAbsolute(inside))
)
  throw new Error(
    "Operational secrets and backups must stay outside the repository.",
  );
const project = process.env.PANDIAN_COMPOSE_PROJECT ?? "pandian-hardened";
if (!/^pandian-[a-z0-9-]+$/.test(project))
  throw new Error("Use a dedicated pandian- Docker project name.");
export const composeArgs = [
  "compose",
  "--project-name",
  project,
  "--env-file",
  resolve(operationsDirectory, "compose.env"),
  "--file",
  "compose.production.yaml",
];
export function compose(args: string[], capture = false, timeout?: number) {
  return execFileSync("docker", [...composeArgs, ...args], {
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    timeout,
  });
}
export function composeProcess(args: string[]) {
  const child = spawn("docker", [...composeArgs, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume(); // pg_dump errors can contain business data. Report exit status only.
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Database tool exited unsuccessfully.")),
    );
  });
  // Attach a handler immediately; callers also await the original promise.
  void completed.catch(() => {});
  return { child, completed };
}
export function backupSecret() {
  return readFileSync(
    resolve(operationsDirectory, "backup_key"),
    "utf8",
  ).trim();
}
export function localOrigin() {
  const config = readFileSync(
    resolve(operationsDirectory, "compose.env"),
    "utf8",
  );
  const port =
    process.env.PANDIAN_HTTPS_PORT ??
    config.match(/^PANDIAN_HTTPS_PORT=(\d+)$/m)?.[1];
  if (!port || Number(port) < 1024 || Number(port) > 65535)
    throw new Error("Invalid local HTTPS port.");
  return `https://pandian.localhost:${port}`;
}
