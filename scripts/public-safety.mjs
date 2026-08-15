import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ignoredDirectories = new Set([
  ".git",
  ".pio",
  "coverage",
  "data",
  "dist",
  "node_modules",
  "work",
]);
const binaryExtensions = new Set([
  ".bin",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".png",
  ".stl",
  ".webp",
]);
const scannerFixturePaths = new Set([
  "scripts/public-safety.mjs",
  "scripts/public-safety.test.ts",
]);
const forbiddenPathPatterns = Object.freeze([
  /(^|\/)\.env$/,
  /(^|\/)device_config\.h$/,
  /(^|\/)rens?[-_]/i,
  /\.(?:db|db-shm|db-wal|gcode|m4a|mp3|ogg|p12|pdf|pfx|wav)$/i,
]);
const forbiddenContentPatterns = Object.freeze([
  { label: "private home path", pattern: /\/Users\/(?:clawd|dan)(?:\/|\b)/i },
  {
    label: "private host identity",
    pattern: /clawd@|192\.168\.4\.(?:34|66)\b/i,
  },
  {
    label: "private project name",
    pattern: /Ren[’']s\s+Chatter\s*Box|REN_CHATTERBOX/i,
  },
  {
    label: "private phone fixture",
    pattern: /34606819995|34637943797|90808560689313/,
  },
  {
    label: "private key material",
    pattern: /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/,
  },
]);

export function scanPublicTree(rootDirectory) {
  const failures = [];

  function scanFile(relativePath) {
    const absolutePath = path.join(rootDirectory, relativePath);
    if (!fs.statSync(absolutePath).isFile()) return;
    for (const pattern of forbiddenPathPatterns) {
      if (pattern.test(relativePath))
        failures.push(`${relativePath}: forbidden public path`);
    }
    if (scannerFixturePaths.has(relativePath)) return;
    if (binaryExtensions.has(path.extname(relativePath).toLowerCase())) return;
    const text = fs.readFileSync(absolutePath, "utf8");
    for (const { label, pattern } of forbiddenContentPatterns) {
      if (pattern.test(text)) failures.push(`${relativePath}: ${label}`);
    }
  }

  function gitCandidateFiles() {
    try {
      execFileSync(
        "git",
        ["-C", rootDirectory, "rev-parse", "--is-inside-work-tree"],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      const output = execFileSync("git", [
        "-C",
        rootDirectory,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ]);
      return output.toString("utf8").split("\0").filter(Boolean);
    } catch {
      return null;
    }
  }

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(rootDirectory, absolutePath)
        .split(path.sep)
        .join("/");
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (entry.isFile()) scanFile(relativePath);
    }
  }

  const candidateFiles = gitCandidateFiles();
  if (candidateFiles) {
    for (const relativePath of candidateFiles) scanFile(relativePath);
  } else {
    visit(rootDirectory);
  }
  return Object.freeze([...new Set(failures)].sort());
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const rootDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const failures = scanPublicTree(rootDirectory);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Public-safety scan passed.");
  }
}
