# Hardened local Docker rehearsal

This is a private deployment rehearsal. Public production deployment is **not approved**. The working internship demo continues to use `compose.yaml`, its own database volume and `http://localhost:3000`.

## Start a clean installation

Use Node 24, npm, Docker Engine/Compose with Linux containers and Playwright Chromium. From the repository root:

```powershell
npm ci
npx playwright install chromium
npm run production:init
npm run production:up -- --bootstrap
npm run production:verify
npm run production:recovery-drill
```

The address is `https://pandian.localhost:3443`. Chromium resolves `.localhost` to loopback. The separate hostname keeps production cookies and HSTS policy away from the HTTP demonstration. A private local CA supplies TLS; it is **not installed in system/browser trust**. `production:verify` verifies the actual certificate using the exported CA, then uses a browser-only certificate exception for its isolated Chromium context. No public DNS or ACME configuration is supplied.

`production:init` generates independent random database, authentication, administrator and backup secrets in `$HOME/.pandian-stores/hardened`, outside Git and the Docker build context. On Windows its ACL grants access only to the operator; on POSIX the directory is mode 0700 and service-readable secret files are 0640. Read `operator_account.json` locally to obtain the generated administrator login. The published demo password does not work here. There is no demo seed or fictional seller profile in this database.

Set `PANDIAN_OPERATIONS_DIR` to an absolute external directory before initialization to choose another location. `PANDIAN_COMPOSE_PROJECT` must be a separate `pandian-...` name. `PANDIAN_HTTPS_PORT` overrides the private `compose.env` port; keep this value consistent across commands. The default project is `pandian-hardened`. Never use the demo's project or volume for this rehearsal.

After the first bootstrap, use `npm run production:up` without `--bootstrap`. Repeated bootstrap refuses an existing user table. Updates run migrations through the operator job before starting the app. Back up and rehearse schema upgrades before changing a populated installation; no automatic reverse migrations or destructive rollback is provided.

## Deployment controls

| Boundary        | Behavior                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime image   | Next standalone server, UID 1000, read-only root filesystem, writable bounded cache/tmpfs, no npm/Yarn, tests, migration scripts or owner credentials. Normal development/demo builds retain their existing startup commands.                                                                                                                                                                                    |
| Database        | PostgreSQL 17.12; container runs directly as postgres UID 70 without capabilities or gosu. No database host port. `pandian_owner` owns migrations; `pandian_app` has an explicit reviewed DML grant list, no DDL, temporary tables, TRUNCATE, trigger alteration or owner membership.                                                                                                                            |
| History         | Existing PostgreSQL guards remain active. Ledger inserts require posting triggers. Financial rows and audit history stay immutable. ID-column UPDATE grants on invoices/payments permit PostgreSQL row locks; immutable triggers reject actual edits.                                                                                                                                                            |
| Secrets         | Compose mounts only runtime database/auth files into the app. Administrative URLs and operator account files are restricted to the operator service. Files are not a managed secret vault; protect the host, Docker socket and backups.                                                                                                                                                                          |
| Network         | App and database networks are internal. Only the TLS proxy joins an edge network and publishes a port, bound to 127.0.0.1. Proxy replaces forwarded identity headers, bounds headers/body/read times and serves TLS 1.2/1.3.                                                                                                                                                                                     |
| Startup         | Explicit production mode requires HTTPS, random auth secret, `pandian_app`, and both demo flags false. Checks reject elevated runtime privileges, demo users/profiles/invoices and unsafe schema access. Real invoicing still requires configured, validated business details and product tax settings.                                                                                                          |
| Authentication  | Account counters persist in PostgreSQL: 10 attempts/account/minute. Production adds 30 attempts/client IPv4 or IPv6 /64/minute and 300 attempts/deployment/minute. HMAC namespaces separate account, IP and global keys. Better Auth retains its additional in-process limits. A global limit can temporarily reject legitimate logins under abuse; it bounds account-counter growth and is not DDoS protection. |
| Resource bounds | App/operator/proxy CPU, memory, PID and rotating log limits; dropped capabilities and no privilege escalation. App health requires database readiness. Database query/idle-transaction limits are 30 seconds and lock timeout is five seconds.                                                                                                                                                                   |
| Logs            | Proxy access logs omit request paths, headers, client addresses and response headers. Application errors expose safe codes. Docker logs remain private operator data. No external alert receiver or incident response service is configured.                                                                                                                                                                     |

A compiled TypeScript launcher validates configuration and database privileges before importing Next. This is necessary because a failing Next instrumentation hook can leave its server process running. Actual negative-startup tests require exit 1 for each enabled demo flag. The database gate also rejects role membership and ownership of database objects, including when schema CREATE permission has subsequently been revoked.

Both app and proxy use Docker's init process. The proxy health check's BusyBox TLS helper otherwise leaves orphaned zombies under Caddy as PID 1, eventually exhausting the PID cap. Docker verification includes 200 consecutive TLS health probes and checks child reaping without relaxing that cap.

The runtime DML role is shared by application requests; HTTP authorization supplies user-role/customer isolation. This is not per-user PostgreSQL RLS. A database owner or Docker/host administrator remains privileged. Container read-only flags do not protect a compromised host.

## Credentials and recovery

To rotate/reset an existing account, securely edit `operator_account.json` with its email, name and a fresh password of at least 16 characters, then run:

```powershell
npm run production:rotate-password
```

The operator job hashes the replacement, revokes all that account's sessions and appends an operator password-rotation audit event. It refuses unknown accounts and never prints passwords. This is privileged manual recovery, not email recovery, MFA, a deactivation workflow or an invitation service. Back up the business database first and retain an external record identifying the operator. The application audit's target actor ID does not establish the human operator's identity.

To rotate database/authentication secrets, maintain the private URL/password files consistently, rerun the migration/operator job and recreate the affected services. Changing a file alone does not refresh cached sessions/connections. Do not regenerate/overwrite a populated installation's secrets with `production:init`. PostgreSQL's bootstrap password file alone does not rotate an existing database role.

## Encrypted backups and a restore rehearsal

```powershell
npm run production:backup
npm run production:restore-check
npm run production:recovery-drill
```

`production:backup` streams PostgreSQL 17 custom-format `pg_dump` output directly into AES-256-GCM, with a random 96-bit nonce and a separately generated 256-bit key. No plaintext dump is written to the host. Incomplete files keep `.partial`; successful files include an authentication tag and are verified before the latest-backup pointer is updated. Backups contain password hashes and session data and remain sensitive even when encrypted. Store the backup key separately from any off-host backup copy.

Restore authenticates the entire encrypted file **before** creating a new `pandian_recovery_<timestamp>` database. It never cleans, drops or overwrites the operational database. `pg_restore` errors stop verification. Every `nova` table and the Drizzle migration table are compared by count and complete-row hash. Source writes after the backup legitimately cause a mismatch; pause writes for a comparison rehearsal. This comparison is sized for the local fixture and can reach the query/memory limit on large databases.

`production:recovery-drill` creates a disposable, populated benchmark database, exercises the restricted runtime role and retries, encrypts/restores it and compares every table. Its fixture contains the INR 7,875 sample invoice, 88 remaining packets and INR 3,875 outstanding. The operational production-mode app never sees that fictional database. The source fixture is dropped after the drill; the recovery database and encrypted backup remain for inspection. Rehearsal and operational latest-backup pointers are separate.

The executed local populated drill completed in approximately six seconds. That is not a production RTO. Backups are manual and local: no scheduled retention, off-host replication, immutable storage, tested loss of this host, alert delivery or contractual RPO/RTO has been established. Do not delete recovery databases until an operator has reviewed them. This tooling does not perform a production switchover.

## Verification and release gate

Run normal migrations, `verify:system`, lint/format/type checking, Vitest, the complete three-engine browser matrix, both npm audits, then the Docker verification and recovery commands. Each browser/unit fixture uses the same isolated test database; run them sequentially. Docker verification uses separate private databases. CI is configured to rehearse hardened Docker as well as the existing regression/audit jobs; no remote CI pass is claimed.

Also execute the native image scans; a clean npm audit does not assess operating-system packages or binaries:

```powershell
docker scout cves --only-severity critical,high --exit-code local://pandian-hardened-app:latest
docker scout cves --only-severity critical,high --exit-code local://pandian-hardened-db:latest
docker scout cves --only-severity critical,high --exit-code local://pandian-hardened-proxy:latest
```

Base images and application dependencies are pinned. Dockerfiles apply available security updates from the same Alpine stable branch. These package repositories are mutable; rebuilds are not bit-identical. Retain the built image digests/SBOM and rescan, rather than treating a cached build as a fresh patch check. No forced dependency upgrade or audit suppression is used.

Public release remains blocked until remaining container findings are resolved or independently adjudicated, live TLS/DNS and hosting isolation are reviewed, off-host recovery and alerting are proved, real seller/tax configuration is supplied, and realistic load/operational acceptance is completed. No 9/10 public-production rating or statutory compliance is certified by this local rehearsal.

References: [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [PostgreSQL privileges](https://www.postgresql.org/docs/17/ddl-priv.html), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
