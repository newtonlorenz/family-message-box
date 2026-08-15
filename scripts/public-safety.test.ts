import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanPublicTree } from "./public-safety.mjs";

const temporaryDirectories: string[] = [];

function fixture(files: Record<string, string>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "public-safety-"));
  temporaryDirectories.push(directory);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("public release safety scan", () => {
  it("accepts examples and clearly synthetic fixtures", () => {
    const directory = fixture({
      ".env.example": "TOKEN=replace-me\n",
      "test.ts": 'const number = "+447700900123";\n',
    });

    expect(scanPublicTree(directory)).toEqual([]);
  });

  it("rejects private configuration, identity, and key material", () => {
    const directory = fixture({
      ".env": "TOKEN=secret\n",
      "firmware/include/device_config.h": "private Wi-Fi\n",
      "notes.md": "/Users/dan/private\n-----BEGIN PRIVATE KEY-----\n",
    });

    expect(scanPublicTree(directory)).toEqual([
      ".env: forbidden public path",
      "firmware/include/device_config.h: forbidden public path",
      "notes.md: private home path",
      "notes.md: private key material",
    ]);
  });

  it("scans the publishable git file set and skips ignored local env files", () => {
    const directory = fixture({
      ".gitignore": ".env\n",
      ".env": "TOKEN=local-only\n",
      "README.md": "# Public project\n",
    });
    execFileSync("git", ["init", "-b", "main"], { cwd: directory });
    execFileSync("git", ["add", ".gitignore", "README.md"], {
      cwd: directory,
    });

    expect(scanPublicTree(directory)).toEqual([]);
  });
});
