/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAIN_CHANNELS, MAIN_WIRE } from "@desktop/main-channels";
import { DAPI_WIRE } from "@diffusionstudio/dapi";
import { mobileProjectsEngine } from "./projects-engine";
import { mobileAgentHost } from "./agent-host";

type EventCallback = (payload: unknown) => void;

interface RequestEnvelope {
  id: string;
  channel: string;
  data: unknown;
}

export function initMobileDesktopBridge(): void {
  if (typeof window === "undefined") return;

  // If already running inside Electron desktop, preserve native bridge
  if (window.desktop && !(window.desktop as any).__isMobileBridge) {
    return;
  }

  const listeners = new Map<string, Set<EventCallback>>();

  function addListener(channel: string, cb: EventCallback): () => void {
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  }

  function emitToRenderer(channel: string, payload: unknown): void {
    const set = listeners.get(channel);
    if (set) {
      for (const cb of set) {
        try {
          cb(payload);
        } catch (e) {
          console.error(`[desktop-bridge] error in listener for ${channel}`, e);
        }
      }
    }
  }

  // Subscribe to project changes and notify renderer
  mobileProjectsEngine.onChange((dir, path) => {
    emitToRenderer(MAIN_WIRE.EVENT, {
      channel: MAIN_CHANNELS.PROJECTS_CHANGED,
      data: { dir, path },
    });
  });

  // Subscribe to Codex Cloud status changes
  mobileAgentHost.onCodexChange((status) => {
    emitToRenderer(MAIN_WIRE.EVENT, {
      channel: MAIN_CHANNELS.CODEX_CLOUD_CHANGED,
      data: status,
    });
  });

  // Handle incoming MAIN_WIRE.REQUEST
  async function handleRequest(envelope: RequestEnvelope): Promise<void> {
    const { id, channel, data } = envelope;

    try {
      let result: unknown;

      switch (channel) {
        // Projects
        case MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT:
          result = mobileProjectsEngine.defaultRoot();
          break;
        case MAIN_CHANNELS.PROJECTS_PICK_ROOT:
        case MAIN_CHANNELS.PROJECTS_PICK_FOLDER:
          result = mobileProjectsEngine.defaultRoot();
          break;
        case MAIN_CHANNELS.PROJECTS_SCAN:
          result = mobileProjectsEngine.scanProjects((data as { root: string })?.root || mobileProjectsEngine.defaultRoot());
          break;
        case MAIN_CHANNELS.PROJECTS_GET:
          result = mobileProjectsEngine.getProject((data as { dir: string }).dir);
          break;
        case MAIN_CHANNELS.PROJECTS_INIT:
          result = mobileProjectsEngine.initProject((data as { dir: string }).dir);
          break;
        case MAIN_CHANNELS.PROJECTS_RESOLVE:
          result = mobileProjectsEngine.resolveProject((data as { dir: string }).dir);
          break;
        case MAIN_CHANNELS.PROJECTS_CREATE: {
          const req = data as { root: string; displayName: string };
          result = mobileProjectsEngine.createProject(req.root, req.displayName);
          break;
        }
        case MAIN_CHANNELS.PROJECTS_RENAME: {
          const req = data as { dir: string; displayName: string };
          result = mobileProjectsEngine.renameProject(req.dir, req.displayName);
          break;
        }
        case MAIN_CHANNELS.PROJECTS_DUPLICATE:
          result = mobileProjectsEngine.duplicateProject((data as { dir: string }).dir);
          break;
        case MAIN_CHANNELS.PROJECTS_DELETE:
          mobileProjectsEngine.deleteProject((data as { dir: string }).dir);
          result = undefined;
          break;
        case MAIN_CHANNELS.PROJECTS_COMPILE:
          result = mobileProjectsEngine.compileProject((data as { dir: string }).dir);
          break;
        case MAIN_CHANNELS.PROJECTS_WRITE: {
          const req = data as { dir: string; edits: any[] };
          result = mobileProjectsEngine.writeProject(req.dir, req.edits);
          break;
        }
        case MAIN_CHANNELS.PROJECTS_WATCH:
          mobileProjectsEngine.watchProject((data as { dir: string }).dir);
          result = undefined;
          break;
        case MAIN_CHANNELS.PROJECTS_UNWATCH:
          mobileProjectsEngine.unwatchProject((data as { dir: string }).dir);
          result = undefined;
          break;
        case MAIN_CHANNELS.PROJECTS_MANIFEST_READ:
          result = mobileProjectsEngine.readManifest((data as { dir: string }).dir);
          break;
        case MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE: {
          const req = data as { dir: string; manifest: unknown };
          mobileProjectsEngine.writeManifest(req.dir, req.manifest);
          result = undefined;
          break;
        }
        case MAIN_CHANNELS.PROJECTS_CONFIG_READ:
          result = mobileProjectsEngine.readConfig((data as { dir: string }).dir);
          break;
        case MAIN_CHANNELS.PROJECTS_CONFIG_WRITE: {
          const req = data as { dir: string; config: unknown };
          mobileProjectsEngine.writeConfig(req.dir, req.config);
          result = undefined;
          break;
        }
        case MAIN_CHANNELS.PROJECTS_FS_LIST: {
          const req = data as { dir: string; source: string };
          result = mobileProjectsEngine.listEntries(req.dir, req.source);
          break;
        }
        case MAIN_CHANNELS.PROJECTS_FS_STAT: {
          const req = data as { dir: string; source: string };
          result = mobileProjectsEngine.statEntry(req.dir, req.source);
          break;
        }
        case MAIN_CHANNELS.PROJECTS_FS_REMOVE: {
          const req = data as { dir: string; path: string };
          mobileProjectsEngine.removeEntry(req.dir, req.path);
          result = undefined;
          break;
        }
        case MAIN_CHANNELS.PROJECTS_FS_REAL_PATH: {
          const req = data as { dir: string; source: string };
          result = `${req.dir}/${req.source}`;
          break;
        }

        // File transfer / write stream
        case MAIN_CHANNELS.FILE_TRANSFER:
        case MAIN_CHANNELS.FILE_WRITE_OPEN:
          result = { id: `write_${Date.now()}` };
          break;
        case MAIN_CHANNELS.FILE_WRITE_CHUNK:
        case MAIN_CHANNELS.FILE_WRITE_CLOSE:
        case MAIN_CHANNELS.FILE_WRITE_ABORT:
          result = undefined;
          break;

        // Agent Chat & Codex Cloud
        case MAIN_CHANNELS.AGENT_CHAT_ENDPOINT:
          result = mobileAgentHost.getAgentChatEndpoint();
          break;
        case MAIN_CHANNELS.CODEX_CLOUD_STATUS:
          result = mobileAgentHost.getCodexCloudStatus();
          break;
        case MAIN_CHANNELS.CODEX_CLOUD_START:
          result = mobileAgentHost.startCodexCloud(data as any);
          break;
        case MAIN_CHANNELS.CODEX_CLOUD_STOP:
          result = mobileAgentHost.stopCodexCloud();
          break;
        case MAIN_CHANNELS.CODEX_CLOUD_INSTALL:
          result = mobileAgentHost.installTunnelClient();
          break;

        // MCP & CLI
        case MAIN_CHANNELS.MCP_STATUS:
          result = mobileAgentHost.getMcpStatus();
          break;
        case MAIN_CHANNELS.MCP_APPLY:
          result = mobileAgentHost.applyMcp(data as any);
          break;
        case MAIN_CHANNELS.CLI_STATUS:
          result = { installed: true, path: "/system/bin/diffusion", managed: true, available: true };
          break;
        case MAIN_CHANNELS.CLI_INSTALL:
          result = { status: "installed" };
          break;
        case MAIN_CHANNELS.CLI_UNINSTALL:
          result = { status: "removed" };
          break;

        // Window & App state
        case MAIN_CHANNELS.WINDOW_IS_FULLSCREEN:
          result = !!document.fullscreenElement;
          break;
        case MAIN_CHANNELS.WINDOW_SET_COLOR_MODE:
        case MAIN_CHANNELS.WINDOW_SET_BUSY:
        case MAIN_CHANNELS.WINDOW_SHOW:
          result = undefined;
          break;
        case MAIN_CHANNELS.WINDOW_CAPTURE:
          result = { png: new Uint8Array(), width: window.innerWidth, height: window.innerHeight };
          break;
        case MAIN_CHANNELS.APP_OPEN_EXTERNAL:
          window.open((data as { url: string }).url, "_blank");
          result = undefined;
          break;
        case MAIN_CHANNELS.APP_SHOW_IN_FOLDER:
          result = undefined;
          break;
        case MAIN_CHANNELS.ANALYTICS_TRACK:
        case MAIN_CHANNELS.LOGS_GET:
          result = [];
          break;
        case MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK:
        case MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK:
          result = null;
          break;

        default:
          console.warn(`[desktop-bridge] Unhandled channel: ${channel}`);
          result = null;
      }

      // Send response back via MAIN_WIRE.RESPONSE
      emitToRenderer(MAIN_WIRE.RESPONSE, {
        id,
        ok: true,
        data: result,
      });
    } catch (err) {
      console.error(`[desktop-bridge] Error handling request ${channel}`, err);
      emitToRenderer(MAIN_WIRE.RESPONSE, {
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Create window.desktop
  const desktopApi = {
    __isMobileBridge: true,
    platform: "win32", // Match Windows desktop platform so all desktop features and layouts activate!
    getPathForFile: (file: File): string => {
      return (file as any).path || file.name;
    },
    send: (channel: string, payload: unknown): void => {
      if (channel === MAIN_WIRE.REQUEST) {
        handleRequest(payload as RequestEnvelope);
      } else if (channel === DAPI_WIRE.REPLY) {
        console.log("[desktop-bridge] DAPI Reply received:", payload);
      }
    },
    on: (channel: string, cb: EventCallback): (() => void) => {
      return addListener(channel, cb);
    },
  };

  // Assign to window.desktop
  (window as any).desktop = desktopApi;
  console.log("[desktop-bridge] Mobile Desktop Engine bridge initialized successfully (win32 desktop mode).");
}
