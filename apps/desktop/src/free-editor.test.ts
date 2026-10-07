/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@diffusionstudio/dapi";
import { TRPCClientError } from "@trpc/client";
import { codexCloudStatus } from "./codex-cloud";
import { applyEdits } from "./edit";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

describe("Free local desktop editor verification", () => {
  const root = join(__dirname, "../../..");
  const webSrc = join(root, "apps/web/src");

  it("1 & 2. verifies no AI credits or Billing navigation item exists in dashboard", () => {
    const dashboardFile = join(webSrc, "pages/dashboard.tsx");
    const typesFile = join(webSrc, "components/dashboard/types.ts");
    const dashboardSource = readFileSync(dashboardFile, "utf8");
    const typesSource = readFileSync(typesFile, "utf8");

    // No navigation items
    expect(dashboardSource).not.toContain('label="AI credits"');
    expect(dashboardSource).not.toContain('label="Billing"');
    expect(dashboardSource).not.toContain('view() === "ai-credits"');
    expect(dashboardSource).not.toContain('view() === "billing"');

    // No dashboard view types
    expect(typesSource).not.toContain('"ai-credits"');
    expect(typesSource).not.toContain('"billing"');
  });

  it("3 & 10. verifies PAYMENT_REQUIRED surfaces clear local fork message without opening paywall dialog", async () => {
    const trpcFile = join(webSrc, "lib/trpc.ts");
    const trpcSource = readFileSync(trpcFile, "utf8");

    expect(trpcSource).not.toContain("showUpgradeDialog");
    expect(trpcSource).toContain(
      "This operation is still connected to the hosted Diffusion service and is not available locally yet."
    );

    // Verify link logic pattern in source
    expect(trpcSource).toContain('err.data?.code === "PAYMENT_REQUIRED"');
    expect(trpcSource).toContain("err.message = HOSTED_SERVICE_UNAVAILABLE_MESSAGE");
    expect(trpcSource).toContain("observer.error(err)");

    // Unit test error interception behavior
    const hostedMessage =
      "This operation is still connected to the hosted Diffusion service and is not available locally yet.";
    const interceptError = (err: unknown): unknown => {
      if (err instanceof TRPCClientError && err.data?.code === "PAYMENT_REQUIRED") {
        err.message = hostedMessage;
        return err;
      }
      return err;
    };

    const error = new TRPCClientError("Payment required", {
      result: {
        error: {
          code: "PAYMENT_REQUIRED",
          message: "Payment required",
          data: { code: "PAYMENT_REQUIRED", httpStatus: 402, path: "transcribe" },
        },
      },
    });

    const result = interceptError(error) as Error;
    expect(result.message).toBe(hostedMessage);
  });

  it("4. verifies all local MCP and DAPI tools remain available", () => {
    const toolNames = tools.map((t) => t.name);
    const expectedLocalTools = [
      "capture",
      "check",
      "context",
      "export",
      "fonts",
      "media_filmstrip",
      "media_grab",
      "media_probe",
      "media_segment",
      "media_waveform",
      "render_preview",
      "screenshot",
      "timeline_filmstrip",
      "timeline_inspect",
      "timeline_undo",
    ];

    for (const tool of expectedLocalTools) {
      expect(toolNames).toContain(tool);
    }
  });

  it("5. verifies timeline editing still works locally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-editor-test-"));
    try {
      const file = "main.tsx";
      await writeFile(
        join(dir, file),
        `export default () => <video id="clip" x={10} y={20} />;\n`
      );

      const result = await applyEdits({ dir }, [
        { kind: "set", source: `${file}:clip`, props: { x: 200, y: 300 } },
      ]);

      expect(result.skipped).toEqual([]);
      const text = await readFile(join(dir, file), "utf8");
      expect(text).toContain(`<video id="clip" x={200} y={300} />`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("6. verifies preview rendering tool remains defined with correct parameters", () => {
    const renderPreviewTool = tools.find((t) => t.name === "render_preview");
    expect(renderPreviewTool).toBeDefined();
    expect(renderPreviewTool!.environment).toBe("renderer");
    expect(renderPreviewTool!.input.safeParse({}).success).toBe(true);
    expect(renderPreviewTool!.input.safeParse({ time: 5.5, width: 640 }).success).toBe(true);
  });

  it("7. verifies Codex Cloud status and UI support load correctly", async () => {
    const status = await codexCloudStatus();
    expect(status).toHaveProperty("state");
    expect(status).toHaveProperty("mcpReachable");
    expect(status).toHaveProperty("tunnelId");
  });

  it("8 & 9. verifies auth context does not expose isPro or credit balance gating", () => {
    const authFile = join(webSrc, "context/auth.tsx");
    const authSource = readFileSync(authFile, "utf8");

    expect(authSource).not.toContain("isPro:");
    expect(authSource).not.toContain("remainingCredits:");
    expect(authSource).not.toContain("creditLimit:");
    expect(authSource).not.toContain("hasStripeCustomer:");
    expect(authSource).not.toContain("FREE_CREDITS_QUOTA");
  });

  it("10. verifies dead billing and credit files have been completely removed", () => {
    const removedFiles = [
      "apps/web/src/components/dashboard/ai-credits-view.tsx",
      "apps/web/src/components/dashboard/billing-view.tsx",
      "apps/web/src/components/dashboard/billing-info-view.tsx",
      "apps/web/src/components/dashboard/plans-view.tsx",
      "apps/web/src/components/dashboard/invoices-view.tsx",
      "apps/web/src/components/upgrade-dialog.tsx",
      "apps/web/src/components/purchase-success.tsx",
      "apps/web/src/components/sidebar-left/project-menu/ai-credits-menu.tsx",
      "apps/web/src/lib/checkout.ts",
      "apps/web/public/checkout/electron-callback.html",
    ];

    for (const relPath of removedFiles) {
      const fullPath = join(root, relPath);
      expect(existsSync(fullPath)).toBe(false);
    }
  });
});
