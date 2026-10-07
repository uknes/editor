/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createResource, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import {
  fetchCodexCloudStatus,
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
const STATUS_REFRESH_MS = 5000;

export function DashboardCodexCloudSection() {
  const [status, { refetch }] = createResource(fetchCodexCloudStatus);
  const [formOpen, setFormOpen] = createSignal(false);
  const [tunnelId, setTunnelId] = createSignal(localStorage.getItem(CODEX_CLOUD_TUNNEL_KEY) ?? "");
  const [apiKey, setApiKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const running = () => status()?.state === "running";
  const statusTimer = setInterval(() => {
    if (running()) void refetch();
  }, STATUS_REFRESH_MS);
  onCleanup(() => clearInterval(statusTimer));

  const description = () => {
    const current = status();
    if (!current) return "Checking secure tunnel support...";
    if (current.state === "running") {
      return current.tunnelId
        ? `Secure MCP Tunnel is running for ${current.tunnelId}.`
        : "Secure MCP Tunnel is running.";
    }
    if (!current.clientAvailable) return "OpenAI tunnel-client is not installed or not available on PATH.";
    if (!current.mcpReachable) return "The local Diffusion Studio MCP endpoint is not reachable.";
    if (current.error) return current.error;
    return "Ready to connect Codex Cloud without exposing the local MCP server.";
  };

  const closeForm = () => {
    setApiKey("");
    setFormOpen(false);
  };

  const connect = async () => {
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
      toast.error("Could not connect Codex Cloud", { description: (e as Error).message });
    } finally {
      setBusy(false);
      setApiKey("");
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await stopCodexCloud();
      await refetch();
      toast("Codex Cloud disconnected");
    } catch (e) {
      toast.error("Could not disconnect Codex Cloud", { description: (e as Error).message });
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
              <Button
                variant="secondary"
                disabled={
                  busy() ||
                  !status() ||
                  (!running() && (!status()!.clientAvailable || !status()!.mcpReachable))
                }
                onClick={() => running() ? void disconnect() : setFormOpen(true)}
              >
                {running() ? "Disconnect" : "Connect"}
              </Button>
            }
          />
        </DashboardSurfaceCard>

        <Show when={status() && !status()!.clientAvailable}>
          <p class="px-2 pt-3 text-xs text-muted-foreground">
            <span>Install OpenAI tunnel-client before connecting. </span>
            <a href={TUNNEL_CLIENT_URL} target="_blank" class="text-primary hover:underline">
              Releases
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
              onClick={() => void connect()}
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
            The runtime key is passed only to the local tunnel process for this connection. Diffusion Studio does not save it.
          </p>
        </div>
      </DashboardFormModal>
    </>
  );
}
