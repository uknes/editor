/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Where the agent host is. On the desktop, main answers over the existing
// IPC (the one desktop call the chat makes); a web build gets a configured
// URL, which a sandbox will hand out later. The client re-resolves on every
// reconnect, so a host that came back on another port is found again.

import { AgentChatClient } from "@diffusionstudio/agent-chat";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";

export const AGENT_ENDPOINT_STORAGE_KEY = "diffusion:agent-chat:endpoint";

export function getCustomAgentUrl(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(AGENT_ENDPOINT_STORAGE_KEY);
}

export function setCustomAgentUrl(url: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (url && url.trim()) {
    localStorage.setItem(AGENT_ENDPOINT_STORAGE_KEY, url.trim());
  } else {
    localStorage.removeItem(AGENT_ENDPOINT_STORAGE_KEY);
  }
}

const configuredUrl = (): string | null => 
  getCustomAgentUrl() || (import.meta.env.VITE_AGENT_CHAT_URL as string | undefined) || null;

export async function resolveEndpoint(): Promise<string | null> {
  if (window.desktop) return (await mainBridge.call(MAIN_CHANNELS.AGENT_CHAT_ENDPOINT, undefined))?.url ?? null;
  return configuredUrl();
}

/** Whether an agent host is available or can be configured by the user. */
export const hasHost = (): boolean => true;

export const client = new AgentChatClient({ resolveEndpoint });

export function reconnectAgentClient(): void {
  client.close();
  client.connect();
}
