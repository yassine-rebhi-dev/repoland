#!/usr/bin/env node
import { main } from "./cli.js";

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`repoland: ${(e as Error).message}`);
  process.exitCode = 2;
}
