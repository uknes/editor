/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import {
  buildTunnelArgs,
  codexCloudStatus,
  scrubLog,
  stopCodexCloud,
  validateTunnelId,
} from "./codex-cloud";

describe("Codex Cloud tunnel", () => {
  it("accepts only canonical tunnel ids", () => {
    expect(validateTunnelId("tunnel_0123456789abcdef0123456789abcdef"))
      .toBe("tunnel_0123456789abcdef0123456789abcdef");
    expect(() => validateTunnelId("tunnel_bad")).toThrow(/Invalid tunnel id/);
    expect(() => validateTunnelId("tunnel_0123456789abcdef0123456789abcdeZ")).toThrow(/Invalid tunnel id/);
  });

  it("builds loopback-only tunnel arguments without credentials", () => {
    const args = buildTunnelArgs("tunnel_0123456789abcdef0123456789abcdef", "/tmp/health.txt");
    expect(args).toContain("http://127.0.0.1:3274/mcp");
    expect(args).toContain("--health.listen-addr");
    expect(args).toContain("127.0.0.1:0");
    expect(args).toContain("--health.url-file");
    expect(args).toContain("/tmp/health.txt");
    expect(args.join(" ")).not.toMatch(/api.?key/i);
    expect(args.join(" ")).not.toMatch(/sk-/);
  });

  it("redacts secrets and API keys from logs and errors", () => {
    const dirty = "Connecting with sk-proj-123456789abcdef and api_key=secretKey123";
    const cleaned = scrubLog(dirty);
    expect(cleaned).not.toContain("sk-proj-123456789abcdef");
    expect(cleaned).toContain("sk-…");
    expect(cleaned).not.toContain("secretKey123");
  });

  it("returns structured status with real backend state", async () => {
    const status = await codexCloudStatus();
    expect(status).toHaveProperty("state");
    expect(status).toHaveProperty("clientAvailable");
    expect(status).toHaveProperty("mcpReachable");
    expect(status).toHaveProperty("tunnelId");
    expect(status).toHaveProperty("connectedAt");
    expect(status).toHaveProperty("lastError");
  });

  it("stops and cleans up on user disconnect", async () => {
    const { tunnelClientManager } = await import("./tunnel-client-manager");
    vi.spyOn(tunnelClientManager, "detect").mockReturnValue({
      available: true,
      managed: true,
      path: "/mock/tunnel-client",
      version: "v0.0.16",
    });

    const status = await stopCodexCloud();
    expect(status.state).toBe("disconnected");
    expect(status.tunnelId).toBeNull();
  });
});
