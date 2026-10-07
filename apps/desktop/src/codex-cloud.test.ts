/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { buildTunnelArgs, validateTunnelId } from "./codex-cloud";

describe("Codex Cloud tunnel", () => {
  it("accepts only canonical tunnel ids", () => {
    expect(validateTunnelId("tunnel_0123456789abcdef0123456789abcdef"))
      .toBe("tunnel_0123456789abcdef0123456789abcdef");
    expect(() => validateTunnelId("tunnel_bad")).toThrow(/Invalid tunnel id/);
  });

  it("builds loopback-only tunnel arguments without credentials", () => {
    const args = buildTunnelArgs("tunnel_0123456789abcdef0123456789abcdef");
    expect(args).toContain("http://127.0.0.1:3274/mcp");
    expect(args.join(" ")).not.toMatch(/api.?key/i);
    expect(args.join(" ")).not.toMatch(/sk-/);
  });
});
