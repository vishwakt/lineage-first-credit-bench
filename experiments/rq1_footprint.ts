// RQ1: change footprint of adding source N (N = 1..8) to each design, measured from the
// tagged commits rq1-s0 .. rq1-s8 with git diff --numstat. Files are classified as
// shared (adapters, used by both designs), lineage specific, or baseline specific; a
// design's footprint is its specific files plus the shared ones.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

type Bucket = "shared" | "lineage" | "baseline" | "other";
const bucket = (f: string): Bucket =>
  f.startsWith("src/adapters/") ? "shared"
  : f.startsWith("src/lineage/") || f.startsWith("migrations/lineage/") ? "lineage"
  : f.startsWith("src/baseline/") || f.startsWith("migrations/baseline/") ? "baseline"
  : "other";
const moduleOf = (f: string) => f.split("/").slice(0, -1).join("/");

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
const steps = [];
for (let n = 1; n <= 8; n++) {
  const from = `rq1-s${n - 1}`, to = `rq1-s${n}`;
  const files = git("diff", "--numstat", from, to)
    .trim().split("\n").filter(Boolean)
    .map((l) => { const [a, d, f] = l.split("\t"); return { file: f, added: Number(a), deleted: Number(d), bucket: bucket(f) }; });
  const created = new Set(git("diff", "--name-status", "--diff-filter=A", from, to).trim().split("\n").filter(Boolean).map((l) => l.split("\t")[1]));
  const design = (name: "lineage" | "baseline") => {
    const mine = files.filter((f) => f.bucket === "shared" || f.bucket === name);
    return {
      filesTouched: mine.length,
      filesCreated: mine.filter((f) => created.has(f.file)).length,
      linesChanged: mine.reduce((s, f) => s + f.added + f.deleted, 0),
      modulesModified: new Set(mine.map((f) => moduleOf(f.file))).size,
      specificFiles: mine.filter((f) => f.bucket === name).length,
      specificLines: mine.filter((f) => f.bucket === name).reduce((s, f) => s + f.added + f.deleted, 0),
    };
  };
  steps.push({
    n, from, to,
    commit: git("rev-parse", to).trim(),
    files,
    lineage: design("lineage"),
    baseline: design("baseline"),
    other: files.filter((f) => f.bucket === "other").map((f) => f.file),
  });
}
mkdirSync("results/raw", { recursive: true });
writeFileSync("results/raw/rq1_footprint.json", JSON.stringify({ generated: "git diff --numstat between rq1-s(N-1) and rq1-sN", steps }, null, 2) + "\n");
for (const s of steps) console.log(s.n, "lineage", JSON.stringify(s.lineage), "baseline", JSON.stringify(s.baseline), s.other.length ? "OTHER " + s.other : "");
