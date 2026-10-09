/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TunnelClientManager,
  extractZip,
  releaseAssetName,
  releaseDownloadUrl,
  resolvePlatformArch,
} from "./tunnel-client-manager";

function createMockZip(entries: { name: string; content: string }[]): Buffer {
  const parts: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fnBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = Buffer.from(entry.content, "utf8");
    const deflated = deflateRawSync(dataBuf);

    // Local Header (30 bytes)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // method = deflate
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0, 12); // date
    lh.writeUInt32LE(0, 14); // crc
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(dataBuf.length, 22);
    lh.writeUInt16LE(fnBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra len

    parts.push(lh, fnBuf, deflated);

    // Central Directory Entry (46 bytes)
    const cde = Buffer.alloc(46);
    cde.writeUInt32LE(0x02014b50, 0);
    cde.writeUInt16LE(20, 4);
    cde.writeUInt16LE(20, 6);
    cde.writeUInt16LE(0, 8);
    cde.writeUInt16LE(8, 10);
    cde.writeUInt16LE(0, 12);
    cde.writeUInt16LE(0, 14);
    cde.writeUInt32LE(0, 16);
    cde.writeUInt32LE(deflated.length, 20);
    cde.writeUInt32LE(dataBuf.length, 24);
    cde.writeUInt16LE(fnBuf.length, 28);
    cde.writeUInt16LE(0, 30); // extra len
    cde.writeUInt16LE(0, 32); // comment len
    cde.writeUInt16LE(0, 34); // disk
    cde.writeUInt16LE(0, 36); // int attr
    cde.writeUInt32LE(0, 38); // ext attr
    cde.writeUInt32LE(offset, 42); // local header offset

    cdEntries.push(cde, fnBuf);
    offset += 30 + fnBuf.length + deflated.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of cdEntries) cdSize += c.length;

  // EOCD (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, ...cdEntries, eocd]);
}

describe("TunnelClientManager platform resolution", () => {
  it("resolves Windows x64 and arm64 correctly", () => {
    expect(resolvePlatformArch("win32", "x64")).toEqual({ platform: "windows", arch: "amd64" });
    expect(resolvePlatformArch("win32", "arm64")).toEqual({ platform: "windows", arch: "arm64" });
  });

  it("resolves macOS x64 and arm64 correctly", () => {
    expect(resolvePlatformArch("darwin", "x64")).toEqual({ platform: "darwin", arch: "amd64" });
    expect(resolvePlatformArch("darwin", "arm64")).toEqual({ platform: "darwin", arch: "arm64" });
  });

  it("resolves Linux x64 and arm64 correctly", () => {
    expect(resolvePlatformArch("linux", "x64")).toEqual({ platform: "linux", arch: "amd64" });
    expect(resolvePlatformArch("linux", "arm64")).toEqual({ platform: "linux", arch: "arm64" });
  });

  it("throws for unsupported platform or arch", () => {
    expect(() => resolvePlatformArch("freebsd" as never, "x64")).toThrow(/Platform "freebsd"/);
    expect(() => resolvePlatformArch("linux", "ia32" as never)).toThrow(/Architecture "ia32"/);
  });

  it("constructs release asset name and download URL", () => {
    const asset = releaseAssetName("v0.0.16", { platform: "windows", arch: "amd64" });
    expect(asset).toBe("tunnel-client-v0.0.16-windows-amd64.zip");
    expect(releaseDownloadUrl("v0.0.16", asset)).toBe(
      "https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-v0.0.16-windows-amd64.zip",
    );
  });
});

describe("extractZip", () => {
  it("extracts files safely from a valid zip archive", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ds-zip-test-"));
    try {
      const zip = createMockZip([
        { name: "tunnel-client.exe", content: "mock-binary-data" },
        { name: "NOTICE", content: "mock-notice" },
      ]);
      const result = extractZip(zip, tempDir);
      expect(result.extracted.length).toBe(2);
      expect(result.extracted[0]).toContain("tunnel-client.exe");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects zip entries attempting path traversal", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ds-zip-test-"));
    try {
      const zip = createMockZip([
        { name: "../outside.txt", content: "bad" },
      ]);
      expect(() => extractZip(zip, tempDir)).toThrow(/Security violation/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("TunnelClientManager detection", () => {
  it("reports missing when neither env, managed, nor system binary is available", () => {
    const manager = new TunnelClientManager("/nonexistent-dir-12345");
    vi.spyOn(manager, "probeBinary").mockReturnValue(false);
    const info = manager.detect();
    expect(info.available).toBe(false);
    expect(info.path).toBeNull();
  });

  it("detects managed binary when present and executable", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ds-test-user-data-"));
    try {
      const manager = new TunnelClientManager(tempDir);
      const managedPath = manager.getManagedBinaryPath();
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(managedPath), { recursive: true });
      await writeFile(managedPath, "fake-binary");
      vi.spyOn(manager, "probeBinary").mockImplementation((p) => p === managedPath);

      const info = manager.detect();
      expect(info.available).toBe(true);
      expect(info.managed).toBe(true);
      expect(info.path).toBe(managedPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("TunnelClientManager installation lifecycle", () => {
  it("coalesces concurrent install calls into a single in-flight operation", async () => {
    const manager = new TunnelClientManager("/test-dir");
    let resolvePromise: (value: any) => void = () => {};
    const slowPromise = new Promise<any>((res) => {
      resolvePromise = res;
    });

    (manager as any).activeInstallPromise = slowPromise;

    const p1 = manager.install();
    const p2 = manager.install();

    const mockResult = { available: true, managed: true, path: "/mock/bin", version: "v0.0.16" };
    resolvePromise(mockResult);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(mockResult);
    expect(r2).toBe(mockResult);
  });
});
