// Records the machine, runtimes, and commit behind a set of results in ENVIRONMENT.md.

import { execFileSync } from "node:child_process";
import { cpus, platform, release, totalmem } from "node:os";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "../src/db/db.ts";

const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
};
const c = new pg.Client(config());
await c.connect();
const pgVersion = (await c.query("SHOW server_version")).rows[0].server_version;
const settings = (await c.query("SELECT name, setting FROM pg_settings WHERE name IN ('max_connections','shared_buffers','work_mem','synchronous_commit') ORDER BY name")).rows;
await c.end();

const commit = sh("git", ["rev-parse", "HEAD"]);
const dirty = sh("git", ["status", "--porcelain", "--untracked-files=no"]) !== "";
const lines = [
  "# Environment",
  "",
  "Written by `experiments/environment.ts` at the end of `scripts/reproduce.sh`; it describes the run whose results are in `results/raw`.",
  "",
  "| Item | Value |",
  "|---|---|",
  `| Commit | \`${commit}\`${dirty ? " (working tree had uncommitted changes)" : ""} |`,
  `| Date (UTC) | ${new Date().toISOString().slice(0, 16).replace("T", " ")} |`,
  `| CPU | ${cpus()[0].model}, ${cpus().length} logical cores |`,
  `| Memory | ${(totalmem() / 2 ** 30).toFixed(0)} GiB |`,
  `| Operating system | ${platform()} ${release()}${platform() === "darwin" ? ` (macOS ${sh("sw_vers", ["-productVersion"])})` : ""} |`,
  `| Node.js | ${process.version} |`,
  `| PostgreSQL | ${pgVersion} (container image postgres:17.6-alpine) |`,
  `| Docker | ${sh("docker", ["--version"])} |`,
  `| Python | ${sh("python3", ["--version"])} |`,
  ...settings.map((s) => `| PostgreSQL ${s.name} | ${s.setting} |`),
  "",
  "Corpus databases for the replay experiments are loaded with `synchronous_commit = off`; replay itself is read only. The throughput experiment runs with the server default.",
  "",
];
writeFileSync("ENVIRONMENT.md", lines.join("\n"));
console.log(lines.join("\n"));
