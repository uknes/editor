/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, Switch, Match, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import {
  fetchCodexCloudStatus,
  installCodexCloudTunnelClient,
  onCodexCloudStatusChanged,
  startCodexCloud,
  stopCodexCloud,
} from "@/lib/mcp";

import {
  DashboardFormModal,
  DashboardInfoActionRow,
  DashboardSurfaceCard,
  DashboardTitledSection,
} from "./shared";

const CODEX_CLOUD_TUNNEL_KEY = "diffusion:codex-cloud:tunnel-id";
const TUNNEL_CLIENT_URL = "https://github.com/openai/tunnel-client/releases";
const STATUS_REFRESH_MS = 4000;

function formatUptime(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export function DashboardCodexCloudSection() {
  const [status, { refetch, mutate }] = createResource(fetchCodexCloudStatus);
  const [formOpen, setFormOpen] = createSignal(false);
  const [tunnelId, setTunnelId] = createSignal(localStorage.getItem(CODEX_CLOUD_TUNNEL_KEY) ?? "");
  const [apiKey, setApiKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    const unsubscribe = onCodexCloudStatusChanged((newStatus) => {
      mutate(newStatus);
    });
    onCleanup(unsubscribe);
  });

  const state = () => status()?.state ?? "checking";
  const isConnected = () => state() === "connected";
  const isConnecting = () => state() === "connecting";
  const isReconnecting = () => state() === "reconnecting";
  const isInstalling = () => state() === "installing";
  const isMissing = () => state() === "tunnel-client-missing";

  const ticker = setInterval(() => {
    if (isConnected()) {
      setNow(Date.now());
    }
  }, 1000);
  onCleanup(() => clearInterval(ticker));

  const pollTimer = setInterval(() => {
    if (isConnected() || isConnecting() || isReconnecting() || isInstalling()) {
      void refetch();
    }
  }, STATUS_REFRESH_MS);
  onCleanup(() => clearInterval(pollTimer));

  const description = () => {
    const current = status();
    if (!current) return "Checking secure tunnel support...";

    switch (current.state) {
      case "tunnel-client-missing":
        return "OpenAI tunnel-client is required to connect Codex Cloud.";
      case "installing":
        return "Downloading and installing OpenAI tunnel-client…";
      case "connecting":
        return "Connecting to Codex Cloud tunnel…";
      case "reconnecting":
        return "Connection interrupted. Reconnecting…";
      case "connected": {
        const id = current.tunnelId ? ` to ${current.tunnelId}` : "";
        let uptime = "";
        if (current.connectedAt) {
          const ms = now() - new Date(current.connectedAt).getTime();
          uptime = ` • Connected for ${formatUptime(Math.max(0, ms))}`;
        }
        return `Connected${id}${uptime} • Local MCP reachable.`;
      }
      case "error":
        return current.lastError || "Connection error occurred.";
      case "ready":
      case "disconnected":
      default:
        if (!current.mcpReachable) {
          return "The local Diffusion Studio MCP endpoint is not reachable.";
        }
        return "Ready to connect Codex Cloud without exposing the local MCP server.";
    }
  };

  const closeForm = () => {
    setApiKey("");
    setFormOpen(false);
  };

  const handleInstall = async () => {
    setBusy(true);
    try {
      await installCodexCloudTunnelClient();
      await refetch();
      toast("tunnel-client installed", {
        description: "OpenAI tunnel-client is ready to connect Codex Cloud.",
      });
    } catch (e) {
      toast.error("Could not install tunnel-client", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
      void refetch();
    }
  };

  const handleConnect = async () => {
    const id = tunnelId().trim();
    const key = apiKey().trim();
    if (!id || !key) return;

    setBusy(true);
    try {
      await startCodexCloud({ tunnelId: id, apiKey: key });
      localStorage.setItem(CODEX_CLOUD_TUNNEL_KEY, id);
      closeForm();
      await refetch();
      toast("Codex Cloud connected", {
        description: "The secure tunnel is running while Diffusion Studio stays open.",
      });
    } catch (e) {
      toast.error("Could not connect Codex Cloud", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
      setApiKey("");
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await stopCodexCloud();
      await refetch();
      toast("Codex Cloud disconnected");
    } catch (e) {
      toast.error("Could not disconnect Codex Cloud", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DashboardTitledSection
        title="Codex Cloud"
        description="Connect Codex Cloud to this running editor through OpenAI Secure MCP Tunnel."
      >
        <DashboardSurfaceCard class="flex flex-col gap-3">
          <DashboardInfoActionRow
            layout="inline"
            leadingSize="sm"
            title="Codex Cloud"
            leading={<Icon name="agent.codex" class="text-foreground" />}
            description={description()}
            action={
              <Switch>
                <Match when={isMissing()}>
                  <Button
                    variant="secondary"
                    disabled={busy()}
                    onClick={() => void handleInstall()}
                  >
                    Install
                  </Button>
                </Match>

                <Match when={isInstalling()}>
                  <Button variant="secondary" disabled>
                    Installing…
                  </Button>
                </Match>

                <Match when={isConnecting()}>
                  <Button variant="secondary" disabled>
                    Connecting…
                  </Button>
                </Match>

                <Match when={isConnected()}>
                  <Button
                    variant="secondary"
                    disabled={busy()}
                    onClick={() => void handleDisconnect()}
                  >
                    Disconnect
                  </Button>
                </Match>

                <Match when={isReconnecting()}>
                  <Button
                    variant="secondary"
                    disabled={busy()}
                    onClick={() => void handleDisconnect()}
                  >
                    Disconnect
                  </Button>
                </Match>

                <Match when={true}>
                  <Button
                    variant="secondary"
                    disabled={
                      busy() ||
                      !status() ||
                      (!isConnected() && !status()?.mcpReachable)
                    }
                    onClick={() => setFormOpen(true)}
                  >
                    Connect
                  </Button>
                </Match>
              </Switch>
            }
          />
        </DashboardSurfaceCard>

        <Show when={isMissing()}>
          <p class="px-2 pt-3 text-xs text-muted-foreground">
            <span>OpenAI tunnel-client enables local tools to reach Codex Cloud without public endpoints. </span>
            <a href={TUNNEL_CLIENT_URL} target="_blank" class="text-primary hover:underline">
              Official Releases
            </a>
          </p>
        </Show>
      </DashboardTitledSection>

      <DashboardFormModal
        open={formOpen()}
        title="Connect Codex Cloud"
        onClose={closeForm}
        footer={
          <>
            <Button variant="ghost" disabled={busy()} onClick={closeForm}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={busy() || tunnelId().trim().length === 0 || apiKey().trim().length === 0}
              onClick={() => void handleConnect()}
            >
              {busy() ? "Connecting..." : "Connect"}
            </Button>
          </>
        }
      >
        <div class="flex flex-col gap-4">
          <TextField>
            <TextFieldLabel uiSize="compact">Tunnel ID</TextFieldLabel>
            <TextFieldInput
              uiSize="compact"
              value={tunnelId()}
              placeholder="tunnel_..."
              spellcheck={false}
              onInput={(event) => setTunnelId(event.currentTarget.value)}
            />
          </TextField>

          <TextField>
            <TextFieldLabel uiSize="compact">Runtime API key</TextFieldLabel>
            <TextFieldInput
              uiSize="compact"
              type="password"
              value={apiKey()}
              placeholder="Paste the tunnel runtime key"
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setApiKey(event.currentTarget.value)}
            />
          </TextField>

          <p class="text-xs text-muted-foreground">
            The runtime key is passed only to the local tunnel process for this connection. Diffusion Studio never saves or logs it.
          </p>
        </div>
      </DashboardFormModal>
    </>
  );
}
