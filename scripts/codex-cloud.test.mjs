/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MCP_URL,
  buildTunnelArgs,
  isLoopbackHost,
  parseArgs,
  redactedEnvironment,
  validateMcpUrl,
  validateTunnelId,
} from "./codex-cloud.mjs";

test("parseArgs defaults to status and the loopback MCP URL", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, "status");
  assert.equal(parsed.mcpUrl, DEFAULT_MCP_URL);
});

test("parseArgs accepts run options", () => {
  const parsed = parseArgs([
    "run",
    "--tunnel-id",
    "tunnel_0123456789abcdef0123456789abcdef",
    "--client",
    "/opt/tunnel-client",
    "--open-ui",
  ]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.tunnelId, "tunnel_0123456789abcdef0123456789abcdef");
  assert.equal(parsed.client, "/opt/tunnel-client");
  assert.equal(parsed.openUi, true);
});

test("tunnel ids are strict", () => {
  assert.equal(
    validateTunnelId("tunnel_0123456789abcdef0123456789abcdef"),
    "tunnel_0123456789abcdef0123456789abcdef",
  );
  assert.throws(() => validateTunnelId("tunnel_NOT_A_REAL_ID"), /Invalid tunnel id/);
});

test("loopback MCP URLs are accepted", () => {
  assert.equal(validateMcpUrl("http://127.0.0.1:3274/mcp").hostname, "127.0.0.1");
  assert.equal(validateMcpUrl("http://localhost:3274/mcp").hostname, "localhost");
  assert.equal(validateMcpUrl("http://[::1]:3274/mcp").hostname, "[::1]");
});

test("remote MCP URLs require explicit opt in", () => {
  assert.throws(() => validateMcpUrl("https://example.com/mcp"), /Refusing non-loopback/);
  assert.equal(validateMcpUrl("https://example.com/mcp", true).hostname, "example.com");
});

test("loopback host recognition does not accept lookalikes", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("localhost.example.com"), false);
  assert.equal(isLoopbackHost("127.0.0.2"), false);
});

test("tunnel args keep secrets out of argv", () => {
  const args = buildTunnelArgs("run", {
    tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
    mcpUrl: DEFAULT_MCP_URL,
    openUi: true,
  });
  const joined = args.join(" ");
  assert.doesNotMatch(joined, /api-key/i);
  assert.doesNotMatch(joined, /sk-/);
  assert.match(joined, /--open-web-ui/);
});

test("environment status never returns the key value", () => {
  const env = redactedEnvironment({
    CONTROL_PLANE_API_KEY: "sk-secret-value",
    CONTROL_PLANE_TUNNEL_ID: "tunnel_0123456789abcdef0123456789abcdef",
  });
  assert.deepEqual(env, { hasRuntimeKey: true, hasTunnelId: true });
  assert.equal(JSON.stringify(env).includes("sk-secret"), false);
});
