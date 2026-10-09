/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { app } from "electron";

export const PINNED_TUNNEL_CLIENT_VERSION = "v0.0.16";
export const GITHUB_REPO = "openai/tunnel-client";

/**
 * Pinned official SHA256 checksums from the OpenAI tunnel-client v0.0.16 release:
 * https://github.com/openai/tunnel-client/releases/download/v0.0.16/SHA256SUMS.txt
 */
export const PINNED_CHECKSUMS: Record<string, string> = {
  "tunnel-client-v0.0.16-windows-amd64.zip": "edef7241b0c647fcb30f1a80ff376b6b25c51927960f257a3f01e21b17c2aba6",
  "tunnel-client-v0.0.16-windows-arm64.zip": "ecd748288b9bd9cc8f5a963855eb143f4788b831475156703d0bafdcd2dcb149",
  "tunnel-client-v0.0.16-darwin-amd64.zip": "57b3dd73f2d042c7aeb5664681f7538078359f55538b9e048640f1df71a0c83f",
  "tunnel-client-v0.0.16-darwin-arm64.zip": "a160820d45089b5253d8d671fe2a689bde0f73d78c135d1497a7b33f28a3ac62",
  "tunnel-client-v0.0.16-linux-amd64.zip": "d60cdba019bce451bcc3a15478cc5b9cb11270b049f5b56ea39a80b517f8b117",
  "tunnel-client-v0.0.16-linux-arm64.zip": "963d0384aaa7c798778479c45673f9051a4039dd891aef8f8978d2a1a628b74f",
};

export type PlatformArch = {
  platform: "windows" | "darwin" | "linux";
  arch: "amd64" | "arm64";
};

export type TunnelClientBinaryInfo = {
  available: boolean;
  managed: boolean;
  path: string | null;
  version: string | null;
};

/**
 * Resolves current node platform and architecture to OpenAI tunnel-client naming.
 */
export function resolvePlatformArch(platform = process.platform, arch = process.arch): PlatformArch {
  let mappedPlatform: PlatformArch["platform"];
  if (platform === "win32") {
    mappedPlatform = "windows";
  } else if (platform === "darwin") {
    mappedPlatform = "darwin";
  } else if (platform === "linux") {
    mappedPlatform = "linux";
  } else {
    throw new Error(`Platform "${platform}" is not supported for OpenAI tunnel-client.`);
  }

  let mappedArch: PlatformArch["arch"];
  if (arch === "x64") {
    mappedArch = "amd64";
  } else if (arch === "arm64") {
    mappedArch = "arm64";
  } else {
    throw new Error(`Architecture "${arch}" is not supported for OpenAI tunnel-client.`);
  }

  return { platform: mappedPlatform, arch: mappedArch };
}

export function releaseAssetName(version: string, platformArch: PlatformArch): string {
  return `tunnel-client-${version}-${platformArch.platform}-${platformArch.arch}.zip`;
}

export function releaseDownloadUrl(version: string, assetName: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/${version}/${assetName}`;
}

export function binaryFileName(platform = process.platform): string {
  return platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
}

/**
 * Parses a ZIP archive buffer and extracts files cleanly without external dependencies.
 * Validates against directory traversal (zip-slip).
 */
export function extractZip(zipBuffer: Buffer, targetDir: string): { extracted: string[] } {
  const buf = zipBuffer;
  if (buf.length < 22) {
    throw new Error("Invalid zip file: buffer too small");
  }

  // Find End of Central Directory record (0x06054b50) scanning backwards
  let eocdOffset = -1;
  const maxSearch = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= maxSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid zip file: End of Central Directory not found");
  }

  const entriesCount = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const extracted: string[] = [];
  let p = cdOffset;

  for (let i = 0; i < entriesCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      break;
    }

    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);

    const rawName = buf.subarray(p + 46, p + 46 + fnLen).toString("utf8");
    p += 46 + fnLen + extraLen + commentLen;

    // Normalize and sanitize name to prevent path traversal
    const normalizedName = rawName.replace(/\\/g, "/");
    if (
      normalizedName.includes("..") ||
      normalizedName.startsWith("/") ||
      /^[a-zA-Z]:/.test(normalizedName)
    ) {
      throw new Error(`Security violation: zip contains malicious path "${rawName}"`);
    }

    // Skip directories
    if (normalizedName.endsWith("/")) {
      continue;
    }

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid local header for entry "${rawName}"`);
    }

    const localFnLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFnLen + localExtraLen;
    const compressedData = buf.subarray(dataStart, dataStart + compSize);

    let uncompressed: Buffer;
    if (method === 0) {
      uncompressed = compressedData;
    } else if (method === 8) {
      uncompressed = Buffer.from(inflateRawSync(compressedData));
    } else {
      throw new Error(`Unsupported compression method ${method} for entry "${rawName}"`);
    }

    const destPath = resolve(targetDir, normalizedName);
    // Ensure destination remains inside targetDir
    if (!destPath.startsWith(resolve(targetDir))) {
      throw new Error(`Path traversal detected: "${destPath}" escapes target directory`);
    }

    // Write file
    const fileDir = dirname(destPath);
    if (!existsSync(fileDir)) {
      mkdirSyncRecursive(fileDir);
    }
    const fs = require("node:fs");
    fs.writeFileSync(destPath, uncompressed);
    extracted.push(destPath);
  }

  return { extracted };
}

function mkdirSyncRecursive(dir: string): void {
  const fs = require("node:fs");
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Downloads a URL over HTTPS following redirects, verifying sha256.
 */
export async function downloadWithChecksum(
  url: string,
  expectedChecksum: string,
  timeoutMs = 60000,
): Promise<Buffer> {
  const follow = async (currentUrl: string, redirectsRemaining = 5): Promise<Buffer> => {
    if (redirectsRemaining <= 0) {
      throw new Error("Too many redirects while downloading tunnel-client.");
    }

    return new Promise((resolvePromise, reject) => {
      const parsedUrl = new URL(currentUrl);
      if (parsedUrl.protocol !== "https:") {
        return reject(new Error("Insecure protocol: tunnel-client download requires HTTPS."));
      }

      const req = httpsGet(
        currentUrl,
        {
          headers: {
            "User-Agent": "Diffusion-Studio-Desktop",
            Accept: "application/octet-stream, application/zip",
          },
        },
        (res) => {
          if (
            res.statusCode &&
            [301, 302, 303, 307, 308].includes(res.statusCode) &&
            res.headers.location
          ) {
            res.resume();
            const nextUrl = new URL(res.headers.location, currentUrl).toString();
            return resolvePromise(follow(nextUrl, redirectsRemaining - 1));
          }

          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed with HTTP ${res.statusCode}: ${res.statusMessage}`));
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            resolvePromise(buffer);
          });
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Download timed out after ${timeoutMs}ms.`));
      });
      req.on("error", reject);
    });
  };

  const buffer = await follow(url);
  const actualHash = createHash("sha256").update(buffer).digest("hex");

  if (actualHash.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new Error(
      `Checksum verification failed for tunnel-client archive. Expected ${expectedChecksum}, got ${actualHash}.`,
    );
  }

  return buffer;
}

export class TunnelClientManager {
  private activeInstallPromise: Promise<TunnelClientBinaryInfo> | null = null;
  private readonly customUserDataDir?: string;

  constructor(customUserDataDir?: string) {
    this.customUserDataDir = customUserDataDir;
  }

  /**
   * The directory Diffusion Studio manages tunnel-client binaries in.
   */
  getManagedDirectory(): string {
    const root = this.customUserDataDir ?? (typeof app !== "undefined" && app.getPath ? app.getPath("userData") : process.cwd());
    return join(root, "tunnel-client");
  }

  /**
   * Path to the managed binary in the application-owned directory.
   */
  getManagedBinaryPath(): string {
    return join(this.getManagedDirectory(), binaryFileName());
  }

  /**
   * Probe whether a binary at a specific path is operational.
   */
  probeBinary(path: string): boolean {
    try {
      const result = spawnSync(path, ["--help"], {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
        timeout: 2000,
      });
      return result.error === undefined && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Detects whether tunnel-client is available and where it is located.
   */
  detect(): TunnelClientBinaryInfo {
    // 1. Explicit environment variable override
    const envBin = process.env.TUNNEL_CLIENT_BIN;
    if (envBin && existsSync(envBin) && this.probeBinary(envBin)) {
      return {
        available: true,
        managed: false,
        path: envBin,
        version: "custom-env",
      };
    }

    // 2. Application-managed binary
    const managedPath = this.getManagedBinaryPath();
    if (existsSync(managedPath) && this.probeBinary(managedPath)) {
      return {
        available: true,
        managed: true,
        path: managedPath,
        version: PINNED_TUNNEL_CLIENT_VERSION,
      };
    }

    // 3. System PATH
    const systemName = binaryFileName();
    if (this.probeBinary(systemName)) {
      return {
        available: true,
        managed: false,
        path: systemName,
        version: "system-path",
      };
    }

    return {
      available: false,
      managed: false,
      path: null,
      version: null,
    };
  }

  /**
   * Downloads and installs the official OpenAI tunnel-client binary into the managed directory.
   */
  async install(version = PINNED_TUNNEL_CLIENT_VERSION): Promise<TunnelClientBinaryInfo> {
    if (this.activeInstallPromise) {
      return this.activeInstallPromise;
    }

    this.activeInstallPromise = (async () => {
      const platformArch = resolvePlatformArch();
      const asset = releaseAssetName(version, platformArch);
      const expectedChecksum = PINNED_CHECKSUMS[asset];

      if (!expectedChecksum) {
        throw new Error(`No verified checksum found for official release asset "${asset}".`);
      }

      const downloadUrl = releaseDownloadUrl(version, asset);
      const managedDir = this.getManagedDirectory();
      const stageDir = join(dirname(managedDir), `.tunnel-client-stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

      try {
        await mkdir(stageDir, { recursive: true });

        // Download and verify integrity
        const archiveBuffer = await downloadWithChecksum(downloadUrl, expectedChecksum);

        // Extract files cleanly
        extractZip(archiveBuffer, stageDir);

        const expectedBinaryName = binaryFileName();
        const stagedBinaryPath = join(stageDir, expectedBinaryName);

        if (!existsSync(stagedBinaryPath)) {
          throw new Error(`Downloaded archive did not contain expected binary "${expectedBinaryName}".`);
        }

        // On Unix, ensure execute permissions
        if (process.platform !== "win32") {
          await chmod(stagedBinaryPath, 0o755);
          const stagedCloudflared = join(stageDir, "cloudflared");
          if (existsSync(stagedCloudflared)) {
            await chmod(stagedCloudflared, 0o755);
          }
        }

        // Prepare managed directory
        await mkdir(managedDir, { recursive: true });

        // Move all staged files into managed directory
        const stagedEntries = await readdir(stageDir);
        for (const entry of stagedEntries) {
          const src = join(stageDir, entry);
          const dst = join(managedDir, entry);
          // Remove old file if it exists to allow atomic replacement
          await rm(dst, { force: true, recursive: true }).catch(() => {});
          await rename(src, dst).catch(async () => {
            // Fallback for cross-device or permission lock
            const content = await readFile(src);
            await writeFile(dst, content);
            if (process.platform !== "win32" && (entry === expectedBinaryName || entry === "cloudflared")) {
              await chmod(dst, 0o755);
            }
          });
        }

        const installedPath = this.getManagedBinaryPath();
        if (!this.probeBinary(installedPath)) {
          throw new Error("Installed tunnel-client failed execution check.");
        }

        return {
          available: true,
          managed: true,
          path: installedPath,
          version,
        };
      } finally {
        await rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
    })();

    try {
      return await this.activeInstallPromise;
    } finally {
      this.activeInstallPromise = null;
    }
  }

  /**
   * Removes the managed tunnel-client binary.
   */
  async uninstall(): Promise<void> {
    const managedDir = this.getManagedDirectory();
    await rm(managedDir, { recursive: true, force: true }).catch(() => {});
  }
}

export const tunnelClientManager = new TunnelClientManager();
