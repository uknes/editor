
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get as httpGet } from "node:http";

import type { ChildProcess } from "node:child_process";
import type { CodexCloudStartRequest, CodexCloudState, CodexCloudStatus } from "./main-channels";
import { tunnelClientManager } from "./tunnel-client-manager";

const MCP_URL = "http://127.0.0.1:3274/mcp";
const TUNNEL_ID_RE = /^tunnel_[0-9a-f]{32}$/;
const STARTUP_TIMEOUT_MS = 15000;
const MAX_RECONNECT_ATTEMPTS = 3;

let child: ChildProcess | null = null;
let activeTunnelId: string | null = null;
let activeApiKey: string | null = null;
let connectedAtDate: Date | null = null;
let lastError: string | null = null;
let currentState: CodexCloudState = "checking";
let healthUrl: string | null = null;
let healthUrlFile: string | null = null;
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let intentionallyStopped = false;

const listeners = new Set<(status: CodexCloudStatus) => void>();

export function onCodexCloudStatusChange(listener: (status: CodexCloudStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyStatusChanged(): void {
  const status = getSyncStatus();
  for (const listener of listeners) {
    try {
      listener(status);
    } catch (err) {
      console.error("[codex-cloud] listener error:", err);
    }
  }
}

export function validateTunnelId(tunnelId: string): string {
  if (!TUNNEL_ID_RE.test(tunnelId)) {
    throw new Error("Invalid tunnel id. Expected tunnel_ followed by 32 lowercase hexadecimal characters.");
  }
  return tunnelId;
}

export function buildTunnelArgs(tunnelId: string, healthFilePath?: string): string[] {
  const args = [
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
  if (healthFilePath) {
    args.push("--health.url-file", healthFilePath);
  }
  return args;
}

export async function mcpReachable(timeoutMs = 1200): Promise<boolean> {
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

export function scrubLog(value: unknown): string {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-…")
    .replace(/(api[_-]?key["':\s=]+)[A-Za-z0-9_-]+/gi, "$1***")
    .trimEnd();
}

/**
 * Checks the local health endpoint exposed by tunnel-client.
 */
async function probeHealth(endpointUrl: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL("/readyz", endpointUrl);
      const req = httpGet(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function getSyncStatus(): CodexCloudStatus {
  const binaryInfo = tunnelClientManager.detect();
  const connectedDurationMs = connectedAtDate ? Date.now() - connectedAtDate.getTime() : null;

  let state: CodexCloudState = currentState;
  if (!isRunning()) {
    if (state === "connecting" || state === "connected" || state === "reconnecting") {
      state = lastError ? "error" : "disconnected";
    } else if (state === "checking" || state === "ready" || state === "tunnel-client-missing") {
      state = binaryInfo.available ? "ready" : "tunnel-client-missing";
    }
  }

  return {
    state,
    clientAvailable: binaryInfo.available,
    clientManaged: binaryInfo.managed,
    clientPath: binaryInfo.path,
    clientVersion: binaryInfo.version,
    mcpReachable: false, // Updated by async codexCloudStatus()
    tunnelId: activeTunnelId,
    connectedAt: connectedAtDate ? connectedAtDate.toISOString() : null,
    connectedDurationMs,
    healthUrl,
    lastError,
  };
}

export async function codexCloudStatus(): Promise<CodexCloudStatus> {
  const sync = getSyncStatus();
  const isMcpReachable = await mcpReachable();

  let state = sync.state;
  if (!sync.clientAvailable && state !== "installing") {
    state = "tunnel-client-missing";
  } else if (!isRunning() && state !== "installing" && state !== "error" && state !== "reconnecting" && state !== "disconnected") {
    state = "ready";
  }

  currentState = state;

  return {
    ...sync,
    state,
    mcpReachable: isMcpReachable,
  };
}

export async function installTunnelClient(): Promise<CodexCloudStatus> {
  currentState = "installing";
  lastError = null;
  notifyStatusChanged();

  try {
    await tunnelClientManager.install();
    currentState = "ready";
    notifyStatusChanged();
    return await codexCloudStatus();
  } catch (error) {
    currentState = "error";
    lastError = scrubLog((error as Error).message);
    notifyStatusChanged();
    throw new Error(lastError);
  }
}

async function cleanupHealthFile(): Promise<void> {
  if (healthUrlFile) {
    const file = healthUrlFile;
    healthUrlFile = null;
    await rm(file, { force: true }).catch(() => {});
  }
}

export async function startCodexCloud(request: CodexCloudStartRequest): Promise<CodexCloudStatus> {
  if (isRunning()) return codexCloudStatus();

  const tunnelId = validateTunnelId(request.tunnelId.trim());
  const apiKey = request.apiKey.trim();
  if (!apiKey) throw new Error("A Tunnel runtime API key is required.");

  const binaryInfo = tunnelClientManager.detect();
  if (!binaryInfo.available || !binaryInfo.path) {
    currentState = "tunnel-client-missing";
    notifyStatusChanged();
    throw new Error("OpenAI tunnel-client was not found. Install it before connecting Codex Cloud.");
  }

  if (!(await mcpReachable())) {
    throw new Error("Diffusion Studio MCP is not reachable at http://127.0.0.1:3274/mcp.");
  }

  intentionallyStopped = false;
  lastError = null;
  activeTunnelId = tunnelId;
  activeApiKey = apiKey;
  currentState = "connecting";
  connectedAtDate = null;
  healthUrl = null;
  notifyStatusChanged();

  const tempHealthFile = join(tmpdir(), `tunnel-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  healthUrlFile = tempHealthFile;

  return new Promise<CodexCloudStatus>((resolve, reject) => {
    let resolved = false;

    const startupTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      lastError = "Connection timed out while waiting for tunnel-client readiness.";
      currentState = "error";
      stopCodexCloud();
      reject(new Error(lastError));
    }, STARTUP_TIMEOUT_MS);

    const proc = spawn(binaryInfo.path!, buildTunnelArgs(tunnelId, tempHealthFile), {
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

    proc.on("error", (error) => {
      if (child !== proc) return;
      child = null;
      connectedAtDate = null;
      lastError = scrubLog(error.message);
      currentState = "error";
      notifyStatusChanged();

      if (!resolved) {
        resolved = true;
        clearTimeout(startupTimer);
        reject(error);
      }
    });

    proc.once("exit", (code, signal) => {
      if (child !== proc) return;
      child = null;
      connectedAtDate = null;
      void cleanupHealthFile();

      if (!intentionallyStopped && (code !== 0 || signal !== null)) {
        lastError = signal
          ? `Secure MCP Tunnel stopped with signal ${signal}.`
          : `Secure MCP Tunnel exited with code ${code ?? "unknown"}.`;

        if (!resolved) {
          resolved = true;
          clearTimeout(startupTimer);
          currentState = "error";
          notifyStatusChanged();
          return reject(new Error(lastError));
        }

        // Active connection dropped unexpectedly: handle bounded reconnection
        handleUnexpectedDisconnect();
      } else {
        currentState = "disconnected";
        notifyStatusChanged();
      }
    });

    // Poll for the health URL file to become ready
    const pollHealth = async () => {
      if (resolved || child !== proc) return;

      try {
        const content = await readFile(tempHealthFile, "utf8").catch(() => "");
        const trimmed = content.trim();
        if (trimmed && trimmed.startsWith("http://")) {
          healthUrl = trimmed;
          const isHealthy = await probeHealth(trimmed);
          if (isHealthy) {
            resolved = true;
            clearTimeout(startupTimer);
            connectedAtDate = new Date();
            reconnectAttempts = 0;
            currentState = "connected";
            notifyStatusChanged();
            return resolve(codexCloudStatus());
          }
        }
      } catch {}

      if (!resolved && child === proc) {
        setTimeout(pollHealth, 350);
      }
    };

    setTimeout(pollHealth, 300);
  });
}

function handleUnexpectedDisconnect(): void {
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && activeTunnelId && activeApiKey) {
    reconnectAttempts++;
    currentState = "reconnecting";
    notifyStatusChanged();

    const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 5000);
    reconnectTimer = setTimeout(() => {
      if (currentState === "reconnecting" && activeTunnelId && activeApiKey) {
        startCodexCloud({ tunnelId: activeTunnelId, apiKey: activeApiKey }).catch((err) => {
          console.error("[codex-cloud] reconnect failed:", err);
        });
      }
    }, backoffMs);
  } else {
    currentState = "error";
    notifyStatusChanged();
  }
}

export async function stopCodexCloud(): Promise<CodexCloudStatus> {
  intentionallyStopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;

  const proc = child;
  child = null;
  activeTunnelId = null;
  activeApiKey = null;
  connectedAtDate = null;
  healthUrl = null;
  lastError = null;
  currentState = "disconnected";

  void cleanupHealthFile();

  if (proc && proc.exitCode === null && proc.signalCode === null) {
    try {
      proc.kill("SIGTERM");
    } catch {
      proc.kill();
    }
  }

  notifyStatusChanged();
  return codexCloudStatus();
}
