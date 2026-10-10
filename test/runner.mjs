#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = __dirname;
const setupPath = path.join(testDir, "setup.mjs");

const userArgs = process.argv.slice(2);
let targetFiles = [];

if (userArgs.length > 0) {
  targetFiles = userArgs;
} else {
  targetFiles = fs
    .readdirSync(testDir)
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => path.join("test", file));
}

const nodeArgs = [
  "--import",
  `./${path.relative(process.cwd(), setupPath).replace(/\\/g, "/")}`,
  "--test",
  ...targetFiles,
];

const result = spawnSync(process.execPath, nodeArgs, {
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? (result.error ? 1 : 0));
