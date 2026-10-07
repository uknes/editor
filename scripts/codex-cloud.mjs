#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

export const DEFAULT_MCP_URL = "http://127.0.0.1:3274/mcp";
export const DEFAULT_TUNNEL_CLIENT = "tunnel-client";
export const TUNNEL_ID_RE = /^tunnel_[0-9a-f]{32}$/;

const HELP = `Diffusion Studio ↔ Codex Cloud bridge

Usage:
  npm run codex:cloud -- status [options]
  npm run codex:cloud -- doctor --tunnel-id <tunnel_id> [options]
  npm run codex:cloud -- run --tunnel-id <tunnel_id> [options]

Commands:
  status   Check tunnel-client and the local Diffusion MCP endpoint.
  doctor   Run OpenAI tunnel-client diagnostics against Diffusion's MCP server.
  run      Keep a Secure MCP Tunnel connected to Diffusion Studio.

Options:
  --tunnel-id <id>         OpenAI Secure MCP Tunnel id. Also read from
                           CONTROL_PLANE_TUNNEL_ID or OPENAI_TUNNEL_ID.
  --mcp-url <url>          Local MCP URL (default: ${DEFAULT_MCP_URL}).
  --client <path>          tunnel-client binary (default: tunnel-client on PATH,
                           or TUNNEL_CLIENT_BIN).
  --open-ui                Ask tunnel-client to open its local operator UI.
  --allow-remote-mcp       Permit a non-loopback --mcp-url. Off by default.
  -h, --help               Show this help.

Authentication:
  Set CONTROL_PLANE_API_KEY in the environment for doctor/run. The bridge never
  puts the key in argv and never writes it to disk.
`;

export function parseArgs(argv) {
  const args = {
    command: "status",
    tunnelId: process.env.CONTROL_PLANE_TUNNEL_ID ?? process.env.OPENAI_TUNNEL_ID ?? null,
    mcpUrl: DEFAULT_MCP_URL,
    client: process.env.TUNNEL_CLIENT_BIN ?? DEFAULT_TUNNEL_CLIENT,
    openUi: false,
    allowRemoteMcp: false,
    help: false,
  };

  const input = [...argv];
  if (input[0] && !input[0].startsWith("-")) args.command = input.shift();

  for (let i = 0; i < input.length; i++) {
    const arg = input[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--open-ui") {
      args.openUi = true;
      continue;
    }
    if (arg === "--allow-remote-mcp") {
      args.allowRemoteMcp = true;
      continue;
    }
    if (arg === "--tunnel-id" || arg === "--mcp-url" || arg === "--client") {
      const value = input[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--tunnel-id") args.tunnelId = value;
      if (arg === "--mcp-url") args.mcpUrl = value;
      if (arg === "--client") args.client = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!new Set(["status", "doctor", "run"]).has(args.command)) {
    throw new Error(`Unknown command: ${args.command}`);
  }
  return args;
}

export function validateTunnelId(tunnelId) {
  if (!tunnelId) throw new Error("Missing tunnel id. Pass --tunnel-id or set CONTROL_PLANE_TUNNEL_ID.");
  if (!TUNNEL_ID_RE.test(tunnelId)) {
    throw new Error("Invalid tunnel id. Expected tunnel_ followed by 32 lowercase hexadecimal characters.");
  }
  return tunnelId;
}

export function validateMcpUrl(rawUrl, allowRemote = false) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid MCP URL: ${rawUrl}`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("MCP URL must use http:// or https://");
  }
  if (!url.pathname || url.pathname === "/") {
    throw new Error("MCP URL must include the MCP path (normally /mcp)");
  }
  if (!allowRemote && !isLoopbackHost(url.hostname)) {
    throw new Error(
      `Refusing non-loopback MCP target ${url.hostname}. Pass --allow-remote-mcp only if this is intentional.`,
    );
  }
  return url;
}

export function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function buildTunnelArgs(command, { tunnelId, mcpUrl, openUi = false }) {
  const base = [
    command,
    "--control-plane.tunnel-id",
    tunnelId,
    "--mcp.server-url",
    mcpUrl,
  ];

  if (command === "run") {
    base.push("--health.listen-addr", "127.0.0.1:0", "--log.level", "info", "--log.format", "struct-text");
    if (openUi) base.push("--open-web-ui");
  } else if (command === "doctor") {
    base.push("--explain");
  }
  return base;
}

export function tunnelClientAvailable(binary) {
  const result = spawnSync(binary, ["--help"], { stdio: "ignore", shell: false });
  return result.error === undefined;
}

export async function mcpReachable(rawUrl, timeoutMs = 1200) {
  const url = validateMcpUrl(rawUrl, true);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return await new Promise((resolve) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function redactedEnvironment(env = process.env) {
  return {
    hasRuntimeKey: Boolean(env.CONTROL_PLANE_API_KEY || env.OPENAI_API_KEY),
    hasTunnelId: Boolean(env.CONTROL_PLANE_TUNNEL_ID || env.OPENAI_TUNNEL_ID),
  };
}

async function status(args) {
  const local = await mcpReachable(args.mcpUrl).catch(() => false);
  const client = tunnelClientAvailable(args.client);
  const env = redactedEnvironment();

  console.log(`tunnel-client: ${client ? "available" : "not found"}`);
  console.log(`Diffusion MCP: ${local ? "reachable" : "not reachable"} (${args.mcpUrl})`);
  console.log(`runtime key: ${env.hasRuntimeKey ? "set" : "not set"}`);
  console.log(`tunnel id: ${args.tunnelId ? "set" : "not set"}`);

  if (!client || !local) process.exitCode = 1;
}

async function forward(command, args) {
  validateTunnelId(args.tunnelId);
  validateMcpUrl(args.mcpUrl, args.allowRemoteMcp);

  if (!process.env.CONTROL_PLANE_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error(
      "CONTROL_PLANE_API_KEY is not set. Create a Tunnel runtime API key and provide it via the environment.",
    );
  }
  if (!tunnelClientAvailable(args.client)) {
    throw new Error(
      `Could not find ${args.client}. Install the latest OpenAI tunnel-client release or set TUNNEL_CLIENT_BIN.`,
    );
  }
  if (!(await mcpReachable(args.mcpUrl))) {
    throw new Error(`Diffusion Studio MCP is not reachable at ${args.mcpUrl}. Start the desktop app first.`);
  }

  const tunnelArgs = buildTunnelArgs(command, {
    tunnelId: args.tunnelId,
    mcpUrl: args.mcpUrl,
    openUi: args.openUi,
  });

  const child = spawn(args.client, tunnelArgs, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  const relaySigint = () => {
    if (!child.killed) child.kill("SIGINT");
  };
  const relaySigterm = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", relaySigint);
  process.once("SIGTERM", relaySigterm);

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) resolve(128);
      else resolve(code ?? 1);
    });
  });
  process.removeListener("SIGINT", relaySigint);
  process.removeListener("SIGTERM", relaySigterm);
  process.exitCode = exitCode;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.command === "status") return status(args);
  return forward(args.command, args);
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(`codex-cloud: ${error.message}`);
    process.exitCode = 1;
  });
}
