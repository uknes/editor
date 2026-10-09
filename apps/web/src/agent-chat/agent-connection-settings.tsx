/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal } from "solid-js";
import { toast } from "somoto";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import {
  getCustomAgentUrl,
  reconnectAgentClient,
  setCustomAgentUrl,
} from "./connection";
import { chatState, ensureConnected } from "./store";

export function AgentConnectionSettings(props: { compact?: boolean; onConnected?: () => void }) {
  const [url, setUrl] = createSignal(getCustomAgentUrl() ?? "");
  const [isConnecting, setIsConnecting] = createSignal(false);

  const status = () => chatState.connection;
  const isConnected = () => status() === "open";

  const handleSaveAndConnect = async () => {
    const target = url().trim();
    if (!target) {
      setCustomAgentUrl(null);
      reconnectAgentClient();
      toast("Agent endpoint cleared", { description: "Using default resolution." });
      return;
    }

    // Auto-prefix ws:// if protocol missing
    let normalized = target;
    if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://") && !normalized.startsWith("http://") && !normalized.startsWith("https://")) {
      normalized = `ws://${normalized}`;
      setUrl(normalized);
    }
    // Convert http(s) to ws(s) if user typed web address
    if (normalized.startsWith("http://")) normalized = normalized.replace("http://", "ws://");
    if (normalized.startsWith("https://")) normalized = normalized.replace("https://", "wss://");

    setCustomAgentUrl(normalized);
    setIsConnecting(true);
    reconnectAgentClient();
    ensureConnected();

    toast("Connecting to AI Agent host", {
      description: `Attempting connection to ${normalized}...`,
    });

    // Check connection after 3 seconds
    setTimeout(() => {
      setIsConnecting(false);
      if (chatState.connection === "open") {
        toast.success("AI Agent Connected", {
          description: "Codex / AI Agent is ready to execute edits.",
        });
        props.onConnected?.();
      } else {
        toast("Agent connection pending", {
          description: "Make sure Codex or Diffusion Studio is running on that address.",
        });
      }
    }, 3000);
  };

  const handleDisconnect = () => {
    setCustomAgentUrl(null);
    setUrl("");
    reconnectAgentClient();
    toast("Agent disconnected");
  };

  const handlePreset = (presetUrl: string) => {
    setUrl(presetUrl);
  };

  return (
    <div class="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3.5 text-xs">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon name="agent.codex" class="size-4 text-primary" />
          <span class="font-medium text-foreground">AI Agent Connection</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="size-2 rounded-full"
            classList={{
              "bg-emerald-500 animate-pulse": isConnected(),
              "bg-amber-500 animate-spin": isConnecting() || status() === "connecting",
              "bg-muted-foreground/50": !isConnected() && !isConnecting() && status() !== "connecting",
            }}
          />
          <span class="text-[11px] capitalize text-muted-foreground">
            {isConnected() ? "Connected" : isConnecting() ? "Connecting..." : status()}
          </span>
        </div>
      </div>

      <p class="text-[11px] text-muted-foreground leading-relaxed">
        Connect to Codex, Claude Code, or any AI agent server running on your PC or cloud tunnel.
      </p>

      <div class="flex flex-col gap-1.5">
        <TextField class="w-full" value={url()} onChange={setUrl}>
          <TextFieldLabel class="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
            Agent Host Address (WebSocket)
          </TextFieldLabel>
          <TextFieldInput
            placeholder="e.g. ws://192.168.1.100:3275 or wss://codex.yourdomain.com"
            class="h-8 text-xs font-mono"
          />
        </TextField>

        <div class="flex flex-wrap gap-1.5 pt-1">
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => handlePreset("ws://192.168.1.50:3275")}
          >
            LAN PC (Port 3275)
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => handlePreset("ws://10.0.2.2:3275")}
          >
            Android Emulator Host
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => handlePreset("ws://localhost:3275")}
          >
            Localhost
          </button>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-1">
        <Show when={isConnected() || getCustomAgentUrl()}>
          <Button variant="ghost" size="small" class="h-7 text-xs text-muted-foreground" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </Show>
        <Button
          size="small"
          class="h-7 text-xs"
          onClick={handleSaveAndConnect}
          disabled={isConnecting()}
        >
          {isConnected() ? "Reconnect" : "Connect Agent"}
        </Button>
      </div>
    </div>
  );
}
