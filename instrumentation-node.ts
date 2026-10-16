import { mkdirSync } from "node:fs";
import path from "node:path";

import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";
import { startScheduler } from "@/lib/scheduled-tasks";

/**
 * Points pi's own read/write paths at a `data` directory beside the running
 * checkout instead of the user profile, so a development or self-hosted run
 * never reads or writes `~/.pi`.
 *
 * The packaged desktop app does not need this: its Rust launcher resolves the
 * data root next to the installed program and passes both env vars to the
 * server process. Those are already set by the time this runs, and an explicit
 * value always wins — `PI_WEB_DATA_DIR` and either pi variable can be set by
 * hand to relocate a checkout's data.
 *
 * `PI_CODING_AGENT_DIR` is the SDK's own override for `getAgentDir()`, which is
 * where sessions, `auth.json`, `models.json`, `settings.json` and `mcp.json`
 * live. `PI_AGENT_HOME` is the fork's override for `userHome()`
 * (`lib/user-home.ts`), which drives the default `pi-cwd` working directory and
 * the file-access allow-list.
 */
function applyCheckoutDataDir(): void {
  if (process.env.PI_AGENT_HOME || process.env.PI_CODING_AGENT_DIR) return;

  const configured = process.env.PI_WEB_DATA_DIR?.trim();
  // Only an absolute path is usable: a relative one would resolve against
  // whatever directory the server happened to be started from.
  const dataRoot =
    configured && path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), "data");

  const agentDir = path.join(dataRoot, "agent");
  process.env.PI_AGENT_HOME = dataRoot;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    mkdirSync(dataRoot, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
  } catch (error) {
    // A read-only checkout is not fatal for every route, so report and continue
    // rather than refusing to start the server.
    console.warn(
      `[pi-web] could not create the data directory ${dataRoot}: ${String(error)}`,
    );
    return;
  }
  console.log(`[pi-web] data directory: ${dataRoot}`);
}

export function registerNodeInstrumentation(): void {
  applyCheckoutDataDir();
  configureHttpDispatcher();

  // Scheduled tasks must fire without anyone having opened a page, and the
  // packaged app keeps this server alive while its window is hidden in the tray.
  if (process.env.PI_WEB_DISABLE_SCHEDULER !== "1") startScheduler();

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
