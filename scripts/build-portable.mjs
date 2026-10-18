import { access, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Assembles a portable Windows build of Pi Agent Desktop.
 *
 * A portable build is the release executable plus the staged `resources/` tree,
 * copied side by side into one folder that can be zipped, moved to another
 * machine, and run without an installer or administrator rights.
 *
 * Why this layout works: on Windows `resource_dir()` resolves to the directory
 * holding the executable (tauri-utils `platform.rs`), and `native_paths.rs`
 * derives the data root from it as `<exe dir>/data`. So the portable folder is
 * self-contained by construction — everything the app writes lands in the
 * `data/` folder next to the executable rather than in the user profile.
 *
 * Usage:
 *   node scripts/build-portable.mjs [--out <dir>]
 *
 * Run `npm run desktop:prepare` and a release `tauri build --no-bundle` first;
 * this script only assembles what those two produced.
 */

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(rootDir, "src-tauri", "target", "release");
const resourcesDir = join(rootDir, "src-tauri", "resources");
const defaultOutDir = join(rootDir, "dist", "portable");

// Cargo's `[package] name`, not the `productName`. The NSIS/MSI bundlers rename
// it from the bundle config, but `--no-bundle` leaves the raw cargo output name.
const EXECUTABLE_NAME = "pi-agent-desktop.exe";
const LAUNCHER_NAME = "Pi Agent.cmd";
const STAGED_RESOURCES = ["server", "node", "component-versions.json"];

function parseArgs(argv) {
  const index = argv.indexOf("--out");
  if (index === -1) return { outDir: defaultOutDir };
  const value = argv[index + 1];
  if (!value) throw new Error("--out needs a directory");
  return { outDir: value };
}

/** Compressed size is what matters for a download; du-style raw size would lie. */
async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function requirePath(path, description) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(
      `${description} is missing: ${relative(rootDir, path) || path}\n` +
        "Run `npm run desktop:prepare` and `tauri build --no-bundle` first.",
    );
  }
}

function launcherScript() {
  // A portable copy is often run from a path with spaces or non-ASCII
  // characters, so quote the executable and keep the script CRLF for cmd.exe.
  return [
    "@echo off",
    "rem Portable launcher. Everything the app writes stays in .\\data next to it.",
    "setlocal",
    `start "" "%~dp0${EXECUTABLE_NAME}" %*`,
    "endlocal",
    "",
  ].join("\r\n");
}

const { outDir } = parseArgs(process.argv.slice(2));
const executable = join(releaseDir, EXECUTABLE_NAME);

await requirePath(executable, "Release executable");
await requirePath(join(resourcesDir, "server", "server.js"), "Staged Next.js server");
await requirePath(join(resourcesDir, "node", "node.exe"), "Bundled Node.js runtime");

// Rebuild from scratch so a portable folder never mixes two builds.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const destinationResources = join(outDir, "resources");
await mkdir(destinationResources, { recursive: true });
for (const entry of STAGED_RESOURCES) {
  const source = join(resourcesDir, entry);
  await access(source, constants.R_OK);
  await cp(source, join(destinationResources, entry), { recursive: true });
}

await cp(executable, join(outDir, EXECUTABLE_NAME));
await writeFile(join(outDir, LAUNCHER_NAME), launcherScript(), "utf8");
await writeFile(
  join(outDir, "PORTABLE.txt"),
  [
    "Pi Agent Desktop — portable build",
    "",
    "Double-click \"Pi Agent.cmd\" (or \"pi-agent-desktop.exe\") to start.",
    "",
    "All data the app writes lives in the data\\ folder next to the executable:",
    "  data\\agent   pi's sessions, credentials, models, settings, MCP config",
    "  data\\logs    desktop.log, server.log",
    "  data\\config  UI preferences",
    "  data\\cache   webview caches",
    "  data\\pi-cwd  the per-day scratch working directory",
    "",
    "The folder is self-contained: move it anywhere (USB stick, another PC)",
    "and the app keeps working. Deleting data\\ resets it to a fresh state.",
    "To keep the payload somewhere else, set PI_DESKTOP_DATA_DIR to an",
    "absolute path before launching.",
    "",
    "Requires the Microsoft Edge WebView2 runtime (preinstalled on Windows 11",
    "and current Windows 10).",
    "",
  ].join("\r\n"),
  "utf8",
);

const bytes = await directorySize(outDir);
console.log(`Portable build assembled at ${outDir}`);
console.log(`  executable  ${EXECUTABLE_NAME}`);
console.log(`  resources/  ${STAGED_RESOURCES.join(", ")}`);
console.log(`  total size  ${formatSize(bytes)}`);
