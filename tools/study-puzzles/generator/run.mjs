#!/usr/bin/env node
// Generates one Study puzzle set in a process of its own (DESIGN.md §7). The dev
// API starts it and reads one JSON event per line from stdout.
//
//   node tools/study-puzzles/generator/run.mjs --dir=<set folder> [--engine=<module>]
//
// `--dir` holds the set's `set.json` (status "running", the configuration).
// `--engine` names a module exporting `createEngine()` — the tests' stand-in;
// the default is Stage 5B + amath_cli from the amath-engine checkout.
//
// It stops cleanly — children ended, the set written as "stopped" with every
// puzzle already made — on SIGTERM / SIGINT, and when its stdin closes (the dev
// server that started it has gone away).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEngine as createRealEngine } from "../lib/engine.mjs";
import { generateSet } from "../lib/generate.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) => /^--([^=]+)=(.*)$/.exec(arg))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);
if (!args.dir) {
  console.error("usage: run.mjs --dir=<set folder> [--engine=<module>]");
  process.exit(2);
}

const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
process.stdin.on("error", stop);
process.stdin.resume();
process.stdout.on("error", stop);

const emit = (event) => {
  if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify(event)}\n`);
};

try {
  const createEngine = args.engine
    ? (await import(pathToFileURL(resolve(args.engine)).href)).createEngine
    : createRealEngine;
  await generateSet({
    dir: resolve(args.dir),
    engine: createEngine(),
    emit,
    signal: controller.signal,
  });
  process.exit(0);
} catch (error) {
  emit({ type: "fatal", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
