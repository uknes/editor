/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createResource, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Switch as Toggle, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AGENT_ICONS,
  applyMcp,
  fetchCliStatus,
  fetchCodexCloudStatus,
  fetchMcpStatus,
  installCli,
  startCodexCloud,
  stopCodexCloud,
  uninstallCli,
  type AgentId,
  type McpAgentStatus,
} from "@/lib/mcp";
import { isDesktop } from "@/projects";

import {
  DashboardDividedStack,
  DashboardFormModal,
  DashboardInfoActionRow,
  DashboardScrollView,
  DashboardSurfaceCard,
  DashboardSurfaceSection,
  DashboardTitledSection,
} from "./shared";

const MCP_DOCS_URL = "https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers";

// --- Agents ------------------------------------------------------------------

type AgentRowProps = {
  agent: McpAgentStatus;
  /** The state the switch is moving to while a write is in flight. */
  pending: boolean | undefined;
  onChange: (connected: boolean) => void;
};

function AgentRow(props: AgentRowProps) {
  const checked = () => props.pending ?? props.agent.connected;

  return (
    <DashboardInfoActionRow
      layout="inline"
      leadingSize="sm"
      title={props.agent.label}
      leading={<Icon name={AGENT_ICONS[props.agent.id]} class="text-foreground" />}
      action={
        <Toggle
          checked={checked()}
          disabled={props.pending !== undefined}
          onChange={props.onChange}
          class="flex shrink-0 items-center"
        >
          <SwitchInput aria-label={`Connect ${props.agent.label}`} />
          <SwitchControl variant="compact">
            <SwitchThumb variant="compact" />
          </SwitchControl>
        </Toggle>
      }
    />
  );
}

function DashboardAgentsSection() {
  const [status, { refetch }] = createResource(fetchMcpStatus);
  const [pending, setPending] = createSignal<Partial<Record<AgentId, boolean>>>({});

  const labelOf = (id: AgentId) => status()?.agents.find((agent) => agent.id === id)?.label ?? id;

  /** Every agent not yet connected. */
  const connectable = () => (status()?.agents ?? []).filter((agent) => !agent.connected);

  /**
   * Writes the change straight into the agents' configs — a switch is not a
   * draft. Whatever fails snaps back, with the reason in a toast.
   */
  const apply = async (add: AgentId[], remove: AgentId[]) => {
    if (add.length + remove.length === 0) return;
    setPending((current) => ({
      ...current,
      ...Object.fromEntries(add.map((id) => [id, true])),
      ...Object.fromEntries(remove.map((id) => [id, false])),
    }));
    try {
      const result = await applyMcp({ add, remove });
      const changed = result.added.length + result.removed.length;
      if (result.failures.length > 0) {
        toast.error(changed > 0 ? "Some agents could not be updated" : "Agents could not be updated", {
          description: result.failures.map((failure) => `${labelOf(failure.id)}: ${failure.error}`).join("\n"),
        });
      }
    } catch (e) {
      toast.error("Could not update the agents", { description: (e as Error).message });
    } finally {
      await refetch();
      setPending((current) => {
        const next = { ...current };
        for (const id of [...add, ...remove]) delete next[id];
        return next;
      });
    }
  };

  const setConnected = (agent: McpAgentStatus, connected: boolean) =>
    apply(connected ? [agent.id] : [], connected ? [] : [agent.id]);

  const enableAll = () => apply(connectable().map((agent) => agent.id), []);

  return (
    <DashboardTitledSection
      title="Agents"
      description="Connect to Diffusion Studio’s MCP server to create and edit videos with your agents."
      action={
        <Button variant="link" class="h-4" disabled={connectable().length === 0} onClick={enableAll}>
          Enable all
        </Button>
      }
    >
      <DashboardSurfaceCard class="flex flex-col gap-3">
        <Show
          when={status()}
          fallback={<p class="text-xs text-muted-foreground">Checking agents...</p>}
        >
          {(current) => (
            <DashboardDividedStack>
              <For each={current().agents}>
                {(agent) => (
                  <AgentRow
                    agent={agent}
                    pending={pending()[agent.id]}
                    onChange={(connected) => void setConnected(agent, connected)}
                  />
                )}
              </For>
            </DashboardDividedStack>
          )}
        </Show>
      </DashboardSurfaceCard>
    </DashboardTitledSection>
  );
}

// --- MCP server --------------------------------------------------------------

const COPIED_LABEL_MS = 2000;

function DashboardMcpServerSection() {
  const [status] = createResource(fetchMcpStatus);
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));

  const copy = async () => {
    const url = status()?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      // The button itself says so for a moment, then goes back to its label.
      setCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
    } catch (e) {
      toast.error("Failed to copy", { description: (e as Error).message });
    }
  };

  return (
    <DashboardTitledSection title="MCP Server">
      <DashboardSurfaceCard class="flex flex-col gap-3">
        <DashboardInfoActionRow
          layout="inline"
          leadingSize="sm"
          title="Diffusion Studio MCP"
          leading={<Icon name="ai-mcp-cli" class="text-foreground" />}
          description="Connect any other agent that supports MCP over Streamable HTTP."
          action={
            <div class="flex shrink-0 items-center gap-2">
              <div class="flex h-7 w-41 items-center rounded-md bg-input px-2">
                <span class="min-w-0 flex-1 truncate text-xs text-foreground">{status()?.url ?? "..."}</span>
              </div>
              <Button variant="secondary" disabled={!status()} onClick={copy}>
                {copied() ? "Copied!" : "Copy URL"}
              </Button>
            </div>
          }
        />
      </DashboardSurfaceCard>
      <p class="px-2 pt-3 text-xs text-muted-foreground">
        <span>Available locally while Diffusion Studio is running. </span>
        <a href={MCP_DOCS_URL} target="_blank" class="text-primary hover:underline">
          What is MCP?
        </a>
      </p>
    </DashboardTitledSection>
  );
}


// --- Codex Cloud -------------------------------------------------------------

const CODEX_CLOUD_TUNNEL_KEY = "diffusion:codex-cloud:tunnel-id";
const TUNNEL_CLIENT_URL = "https://github.com/openai/tunnel-client/releases";

function DashboardCodexCloudSection() {
  const [status, { refetch }] = createResource(fetchCodexCloudStatus);
  const [formOpen, setFormOpen] = createSignal(false);
  const [tunnelId, setTunnelId] = createSignal(localStorage.getItem(CODEX_CLOUD_TUNNEL_KEY) ?? "");
  const [apiKey, setApiKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const running = () => status()?.state === "running";
  const statusTimer = setInterval(() => {
    if (running()) void refetch();
  }, 5000);
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

// --- CLI ---------------------------------------------------------------------

function DashboardCliSection() {
  const [status, { refetch }] = createResource(fetchCliStatus);
  const [busy, setBusy] = createSignal(false);

  const handleInstall = async () => {
    setBusy(true);
    try {
      const result = await installCli();
      if (result.status === "installed") {
        toast("CLI installed", { description: "Run diffusion --help in a terminal to get started." });
      }
      if (result.status === "error") {
        toast.error("Could not install the CLI", { description: result.error });
      }
    } catch (e) {
      toast.error("Could not install the CLI", { description: (e as Error).message });
    } finally {
      setBusy(false);
      void refetch();
    }
  };

  const handleUninstall = async () => {
    setBusy(true);
    try {
      const result = await uninstallCli();
      if (result.status === "removed") toast("CLI uninstalled");
      if (result.status === "error") toast.error("Could not uninstall the CLI", { description: result.error });
    } catch (e) {
      toast.error("Could not uninstall the CLI", { description: (e as Error).message });
    } finally {
      setBusy(false);
      void refetch();
    }
  };

  return (
    <DashboardSurfaceSection
      title="CLI"
      description="Give agents access to Diffusion Studio through terminal commands."
    >
      <DashboardInfoActionRow
        layout="inline"
        leadingSize="sm"
        title="diffusion CLI"
        leading={<Icon name="dapi-cli" class="text-foreground" />}
        description="Diffusion Studio’s command-line tool for accessing its media tools and managing projects."
        action={
          <Switch>
            <Match when={!status()}>
              <Button variant="secondary" disabled>
                Install
              </Button>
            </Match>
            <Match when={status()?.installed && status()?.managed}>
              <Tooltip>
                <TooltipTrigger as={Button} variant="secondary" disabled={busy()} onClick={handleUninstall}>
                  Uninstall
                </TooltipTrigger>
                <TooltipContent>Installed at {status()?.path}</TooltipContent>
              </Tooltip>
            </Match>
            <Match when={status()?.installed}>
              <Tooltip>
                <TooltipTrigger as={Button} variant="on">
                  Installed
                </TooltipTrigger>
                <TooltipContent>Found at {status()?.path}. Not a link, so it is left alone.</TooltipContent>
              </Tooltip>
            </Match>
            <Match when={true}>
              <Button variant="secondary" disabled={busy()} onClick={handleInstall}>
                Install
              </Button>
            </Match>
          </Switch>
        }
      />
    </DashboardSurfaceSection>
  );
}

export function DashboardMcpView() {
  return (
    <DashboardScrollView>
      <Show
        when={isDesktop()}
        fallback={
          <DashboardSurfaceSection title="MCP & CLI">
            <p class="text-xs text-muted-foreground">
              Connecting coding agents and installing the command line tool is available in the desktop app.
            </p>
          </DashboardSurfaceSection>
        }
      >
        <DashboardAgentsSection />
        <DashboardMcpServerSection />
        <DashboardCodexCloudSection />
        <DashboardCliSection />
      </Show>
    </DashboardScrollView>
  );
}
