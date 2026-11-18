import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  realpathSync,
  chmodSync,
} from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import {
  operationsDirectory as dir,
  compose,
  composeProcess,
  backupSecret,
  localOrigin,
} from "./lib/production-local";
import {
  encryptBackup,
  verifyBackup,
  decryptBackup,
} from "./lib/encrypted-backup";

const action = process.argv[2];
try {
  if (action === "init") {
    if (existsSync(dir) && readdirSync(dir).length > 0)
      throw new Error(
        "Operations directory already exists; existing secrets will not be overwritten.",
      );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const actual = relative(realpathSync(process.cwd()), realpathSync(dir));
    if (actual === "" || (!actual.startsWith("..") && !isAbsolute(actual)))
      throw new Error(
        "Resolved operational directory must stay outside the repository.",
      );
    if (process.platform !== "win32") chmodSync(dir, 0o700);
    if (process.platform === "win32") {
      const identity = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], {
        encoding: "utf8",
      }).match(/S-1-[0-9-]+/);
      if (!identity)
        throw new Error("Unable to identify the Windows operator.");
      execFileSync(
        "icacls",
        [dir, "/inheritance:r", "/grant:r", `*${identity[0]}:(OI)(CI)F`],
        { stdio: "pipe" },
      );
    }
    const secret = () => randomBytes(32).toString("hex");
    const postgres = secret(),
      owner = secret(),
      runtime = secret();
    const files: Record<string, string> = {
      postgres_password: postgres,
      admin_url: `postgresql://postgres:${postgres}@db:5432/pandian`,
      owner_url: `postgresql://pandian_owner:${owner}@db:5432/pandian`,
      runtime_url: `postgresql://pandian_app:${runtime}@db:5432/pandian`,
      auth_secret: randomBytes(48).toString("hex"),
      backup_key: secret(),
      "operator_account.json": JSON.stringify(
        {
          name: "Pandian Stores Administrator",
          email: "admin@pandian.local",
          password: randomBytes(24).toString("hex"),
        },
        null,
        2,
      ),
      "compose.env": `PANDIAN_SECRETS_DIR=${dir.replaceAll("\\", "/")}\nPANDIAN_HTTPS_PORT=3443\nPANDIAN_OPERATOR_GID=${process.getgid?.() ?? 1000}\n`,
    };
    for (const [name, value] of Object.entries(files))
      writeFileSync(resolve(dir, name), value + "\n", {
        flag: "wx",
        mode: 0o640,
      });
    console.log(
      `Private local deployment files created at ${dir}. Read operator_account.json locally for the generated login. No demo credentials were copied.`,
    );
  } else if (action === "up") {
    compose(["build", "db", "operations", "app", "proxy"]);
    compose(["up", "-d", "--wait", "db"]);
    // The initial bootstrap is explicit; a repeat deployment must only migrate.
    compose([
      "run",
      "--rm",
      "operations",
      "scripts/production-database.ts",
      ...(process.argv.includes("--bootstrap") ? ["--bootstrap"] : []),
    ]);
    compose(["up", "-d", "--wait", "app", "proxy"]);
    const certificate = compose(
      [
        "exec",
        "-T",
        "proxy",
        "cat",
        "/data/caddy/pki/authorities/local/root.crt",
      ],
      true,
    );
    writeFileSync(resolve(dir, "local-ca.crt"), certificate, { mode: 0o600 });
    console.log(
      `Hardened rehearsal available at ${localOrigin()}. Local CA exported; no system trust settings changed.`,
    );
  } else if (action === "status") {
    compose(["ps"]);
  } else if (action === "stop") {
    compose(["stop"]);
  } else if (action === "rotate-password") {
    compose([
      "run",
      "--rm",
      "--no-deps",
      "operations",
      "scripts/rotate-password.ts",
    ]);
  } else if (action === "backup") {
    const source =
      process.argv.find((arg) => arg.startsWith("--source="))?.split("=")[1] ??
      "pandian";
    if (!/^(pandian|pandian_permissions_[a-f0-9]+_test)$/.test(source))
      throw new Error("Unsupported backup source.");
    const folder = resolve(dir, "backups");
    mkdirSync(folder, { mode: 0o700, recursive: true });
    const destination = resolve(
      folder,
      new Date().toISOString().replaceAll(/[:.]/g, "-") + ".pgdump.aesgcm",
    );
    const { child, completed } = composeProcess([
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "pandian_owner",
      "-d",
      source,
      "--format=custom",
      "--no-owner",
      "--no-acl",
    ]);
    try {
      // Do not finalize the encrypted file until pg_dump itself exits cleanly.
      const verifiedDump = Readable.from(
        (async function* () {
          for await (const chunk of child.stdout!) yield chunk;
          await completed;
        })(),
      );
      await encryptBackup(verifiedDump, destination, backupSecret());
    } catch (error) {
      child.kill();
      throw error;
    }
    await verifyBackup(destination, backupSecret());
    writeFileSync(
      resolve(
        dir,
        source === "pandian"
          ? "latest-backup.json"
          : "latest-rehearsal-backup.json",
      ),
      JSON.stringify({
        source,
        file: destination,
        createdAt: new Date().toISOString(),
      }) + "\n",
      {
        mode: 0o600,
      },
    );
    console.log(
      `Authenticated encrypted backup: ${destination}. Keep a separate protected copy of backup_key; do not store that key with off-host backups.`,
    );
  } else if (action === "restore-check") {
    const { source, file } = JSON.parse(
      readFileSync(
        resolve(
          dir,
          process.argv.includes("--rehearsal")
            ? "latest-rehearsal-backup.json"
            : "latest-backup.json",
        ),
        "utf8",
      ),
    );
    if (
      typeof source !== "string" ||
      !/^(pandian|pandian_permissions_[a-f0-9]+_test)$/.test(source) ||
      typeof file !== "string"
    )
      throw new Error("Invalid backup metadata.");
    await verifyBackup(file, backupSecret());
    const target = `pandian_recovery_${Date.now()}`;
    compose([
      "exec",
      "-T",
      "db",
      "createdb",
      "-U",
      "postgres",
      "--owner=pandian_owner",
      "--template=template0",
      target,
    ]);
    const { child, completed } = composeProcess([
      "exec",
      "-T",
      "db",
      "pg_restore",
      "-U",
      "pandian_owner",
      "--dbname=" + target,
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
    ]);
    try {
      await Promise.all([
        decryptBackup(file, backupSecret(), child.stdin!),
        completed,
      ]);
    } catch (error) {
      child.kill();
      throw error;
    }
    compose([
      "run",
      "--rm",
      "--no-deps",
      "operations",
      "scripts/production-check.ts",
      "--restored=" + target,
      "--source=" + source,
    ]);
    console.log(
      `Recovery rehearsal verified in ${target}. Operational database was not overwritten. Recovery database retained for inspection.`,
    );
  } else if (action === "recovery-drill") {
    const start = performance.now();
    const output = compose(
      [
        "run",
        "--rm",
        "--no-deps",
        "operations",
        "scripts/production-check.ts",
        "--keep-benchmark",
      ],
      true,
    );
    console.log(output);
    const source = output.match(
      /^RECOVERY_SOURCE=(pandian_permissions_[a-f0-9]+_test)$/m,
    )?.[1];
    if (!source) throw new Error("No verified recovery fixture was created.");
    const cli = [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/production-local.ts"),
    ];
    try {
      execFileSync(process.execPath, [...cli, "backup", "--source=" + source], {
        stdio: "inherit",
      });
      execFileSync(process.execPath, [...cli, "restore-check", "--rehearsal"], {
        stdio: "inherit",
      });
      console.log(
        `Populated benchmark backup/recovery drill completed in ${Math.ceil((performance.now() - start) / 1000)} seconds. This measures a small local fixture, not a production recovery SLA.`,
      );
    } finally {
      compose(["exec", "-T", "db", "dropdb", "-U", "postgres", source]);
    }
  } else {
    throw new Error(
      "Use init, up [--bootstrap], status, stop, rotate-password, backup, restore-check or recovery-drill.",
    );
  }
} catch (error) {
  // Do not print child process objects, SQL, URLs or credentials.
  console.error(
    "Local deployment operation failed.",
    error instanceof Error && !("status" in error)
      ? error.message
      : "Check the container status and sanitized service logs.",
  );
  process.exitCode = 1;
}
