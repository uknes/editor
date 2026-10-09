/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type {
  CodexCloudStartRequest,
  CodexCloudStatus,
  McpApplyRequest,
  McpApplyResult,
  McpStatus,
} from "./types";

const STORAGE_AGENT_ENDPOINT = "agent_chat_custom_endpoint";
const STORAGE_CODEX_KEY = "codex_cloud_api_key";
const STORAGE_CODEX_TUNNEL = "codex_cloud_tunnel_id";

class MobileAgentHost {
  private codexStatus: CodexCloudStatus = {
    state: "ready",
    clientAvailable: true,
    clientManaged: true,
    clientPath: "mobile://codex-bridge",
    clientVersion: "1.0.0-mobile",
    mcpReachable: true,
    tunnelId: null,
    connectedAt: null,
    connectedDurationMs: null,
    healthUrl: null,
    lastError: null,
  };

  private listeners: Set<(status: CodexCloudStatus) => void> = new Set();

  constructor() {
    const savedTunnel = localStorage.getItem(STORAGE_CODEX_TUNNEL);
    if (savedTunnel) {
      this.codexStatus.tunnelId = savedTunnel;
    }
  }

  public onCodexChange(listener: (status: CodexCloudStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitCodexChange(): void {
    for (const listener of this.listeners) {
      listener({ ...this.codexStatus });
    }
  }

  public getAgentChatEndpoint(): { url: string } | null {
    const custom = localStorage.getItem(STORAGE_AGENT_ENDPOINT);
    if (custom && custom.trim()) {
      return { url: custom.trim() };
    }
    // If Codex Cloud tunnel is active:
    if (this.codexStatus.tunnelId) {
      return { url: `wss://${this.codexStatus.tunnelId}.tunnel.diffusion.studio/agent` };
    }
    // Local fallback
    return { url: "ws://127.0.0.1:9099" };
  }

  public getCodexCloudStatus(): CodexCloudStatus {
    return { ...this.codexStatus };
  }

  public startCodexCloud(req: CodexCloudStartRequest): CodexCloudStatus {
    try {
      localStorage.setItem(STORAGE_CODEX_TUNNEL, req.tunnelId);
      localStorage.setItem(STORAGE_CODEX_KEY, req.apiKey);

      this.codexStatus = {
        ...this.codexStatus,
        state: "connected",
        tunnelId: req.tunnelId,
        connectedAt: new Date().toISOString(),
        connectedDurationMs: 0,
        lastError: null,
      };
      this.emitCodexChange();
      return { ...this.codexStatus };
    } catch (err) {
      this.codexStatus.state = "error";
      this.codexStatus.lastError = err instanceof Error ? err.message : String(err);
      this.emitCodexChange();
      return { ...this.codexStatus };
    }
  }

  public stopCodexCloud(): CodexCloudStatus {
    this.codexStatus = {
      ...this.codexStatus,
      state: "ready",
      tunnelId: null,
      connectedAt: null,
      connectedDurationMs: null,
    };
    localStorage.removeItem(STORAGE_CODEX_TUNNEL);
    this.emitCodexChange();
    return { ...this.codexStatus };
  }

  public installTunnelClient(): CodexCloudStatus {
    this.codexStatus.state = "ready";
    this.emitCodexChange();
    return { ...this.codexStatus };
  }

  public getMcpStatus(): McpStatus {
    return {
      url: "http://localhost:3000/mcp",
      agents: [
        {
          id: "codex",
          label: "Codex Agent",
          detected: true,
          connected: this.codexStatus.state === "connected",
          config: "mobile://config/codex",
          unavailable: null,
        },
        {
          id: "claude-desktop",
          label: "Claude Desktop",
          detected: true,
          connected: false,
          config: "mobile://config/claude",
          unavailable: null,
        },
        {
          id: "cursor",
          label: "Cursor",
          detected: true,
          connected: false,
          config: "mobile://config/cursor",
          unavailable: null,
        },
        {
          id: "vscode",
          label: "VS Code",
          detected: true,
          connected: false,
          config: "mobile://config/vscode",
          unavailable: null,
        },
      ],
    };
  }

  public applyMcp(req: McpApplyRequest): McpApplyResult {
    return {
      added: req.add,
      removed: req.remove,
      failures: [],
    };
  }
}

export const mobileAgentHost = new MobileAgentHost();
