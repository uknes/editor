/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";

import type { ChildProcess } from "node:child_process";
import type { CodexCloudStartRequest, CodexCloudStatus } from "./main-channels";

const MCP_URL = "http://127.0.0.1:3274/mcp";
const TUNNEL_ID_RE = /^tunnel_[0-9a-f]{32}$/;
const STARTUP_GRACE_MS = 350;

let child: ChildProcess | null = null;
let activeTunnelId: string | null = null;
let startedAt: string | null = null;
let lastError: string | null = null;

function clientBinary(): string {
  return process.env.TUNNEL_CLIENT_BIN ?? "tunnel-client";
}

export function validateTunnelId(tunnelId: string): string {
  if (!TUNNEL_ID_RE.test(tunnelId)) {
    throw new Error("Invalid tunnel id. Expected tunnel_ followed by 32 lowercase hexadecimal characters.");
  }
  return tunnelId;
}

export function buildTunnelArgs(tunnelId: string): string[] {
  return [
    "run",
    "--control-plane.tunnel-id",
    tunnelId,
    "--mcp.server-url",
    MCP_URL,
    "--health.listen-addr",
    "127.0.0.1:0",
    "--log.level",
    "info",
    "--log.format",
    "struct-text",
  ];
}

function tunnelClientAvailable(): boolean {
  const result = spawnSync(clientBinary(), ["--help"], {
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  return result.error === undefined;
}

async function mcpReachable(timeoutMs = 1200): Promise<boolean> {
  const url = new URL(MCP_URL);
  return await new Promise((resolve) => {
    const socket = connect({
      host: url.hostname,
      port: Number(url.port),
    });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function isRunning(): boolean {
  return child !== null && child.exitCode === null && child.signalCode === null;
}

function scrubLog(value: unknown): string {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-…")
    .trimEnd();
}

export async function codexCloudStatus(): Promise<CodexCloudStatus> {
  return {
    state: isRunning() ? "running" : "stopped",
    clientAvailable: tunnelClientAvailable(),
    mcpReachable: await mcpReachable(),
    tunnelId: isRunning() ? activeTunnelId : null,
    startedAt: isRunning() ? startedAt : null,
    error: lastError,
  };
}

export async function startCodexCloud(request: CodexCloudStartRequest): Promise<CodexCloudStatus> {
  if (isRunning()) return codexCloudStatus();

  const tunnelId = validateTunnelId(request.tunnelId.trim());
  const apiKey = request.apiKey.trim();
  if (!apiKey) throw new Error("A Tunnel runtime API key is required.");
  if (!tunnelClientAvailable()) {
    throw new Error("OpenAI tunnel-client was not found on PATH. Install it before connecting Codex Cloud.");
  }
  if (!(await mcpReachable())) {
    throw new Error("Diffusion Studio MCP is not reachable at http://127.0.0.1:3274/mcp.");
  }

  lastError = null;
  activeTunnelId = tunnelId;
  startedAt = new Date().toISOString();

  const proc = spawn(clientBinary(), buildTunnelArgs(tunnelId), {
    env: {
      ...process.env,
      CONTROL_PLANE_API_KEY: apiKey,
      CONTROL_PLANE_TUNNEL_ID: tunnelId,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  child = proc;

  proc.stdout?.on("data", (chunk) => {
    const line = scrubLog(chunk);
    if (line) console.log(`[codex-cloud] ${line}`);
  });
  proc.stderr?.on("data", (chunk) => {
    const line = scrubLog(chunk);
    if (line) console.error(`[codex-cloud] ${line}`);
  });

  proc.once("exit", (code, signal) => {
    if (child !== proc) return;
    child = null;
    startedAt = null;
    if (code !== 0) {
      lastError = signal
        ? `Secure MCP Tunnel stopped with signal ${signal}.`
        : `Secure MCP Tunnel exited with code ${code ?? "unknown"}.`;
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, STARTUP_GRACE_MS);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          signal
            ? `Secure MCP Tunnel stopped with signal ${signal} during startup.`
            : `Secure MCP Tunnel exited with code ${code ?? "unknown"} during startup.`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      proc.off("error", onError);
      proc.off("exit", onExit);
    };
    proc.once("error", onError);
    proc.once("exit", onExit);
  });

  return codexCloudStatus();
}

export async function stopCodexCloud(): Promise<CodexCloudStatus> {
  const proc = child;
  child = null;
  activeTunnelId = null;
  startedAt = null;
  lastError = null;

  if (proc && proc.exitCode === null && proc.signalCode === null) {
    proc.kill("SIGTERM");
  }

  return codexCloudStatus();
}
