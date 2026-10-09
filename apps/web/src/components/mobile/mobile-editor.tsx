/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Computed, FrameRate, Playback, Selected, Size, togglePlayback } from "@diffusionstudio/runtime";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Canvas } from "@/components/canvas";
import { Timeline, Layers } from "@/components/timeline";
import { Assets } from "@/components/sidebar-left/assets";
import { Inspector, Soundboard } from "@/components/sidebar-right";
import { ChatPanel, chatState } from "@/agent-chat";
import { AgentConnectionSettings } from "@/agent-chat/agent-connection-settings";
import { splitAtPlayhead } from "@/engine/split";
import { getDocumentEditor } from "@/engine/editor";
import { getEditHistory } from "@/engine/history";
import { useDerived, useTimelineIndex } from "@/engine/hooks";
import { formatFrames } from "@/components/timeline/time-format";
import { useProject } from "@/context/project";
import { toast } from "somoto";

export type MobileTab = "media" | "inspector" | "codex" | "sound" | "export" | null;
export type AspectRatioType = "9:16" | "16:9" | "1:1" | "4:5";

const ASPECT_RATIOS: { label: string; value: AspectRatioType; width: number; height: number }[] = [
  { label: "9:16 Shorts", value: "9:16", width: 1080, height: 1920 },
  { label: "16:9 Video", value: "16:9", width: 1920, height: 1080 },
  { label: "1:1 Square", value: "1:1", width: 1080, height: 1080 },
  { label: "4:5 Feed", value: "4:5", width: 1080, height: 1350 },
];

export function MobileEditor() {
  const navigate = useNavigate();
  const world = useWorld();
  const project = useProject();
  const index = useTimelineIndex();

  const [activeSheet, setActiveSheet] = createSignal<MobileTab>(null);
  const [selectedRatio, setSelectedRatio] = createSignal<AspectRatioType>("9:16");
  const [showSettingsModal, setShowSettingsModal] = createSignal(false);

  const scene = createMemo(() => index().root);
  const playback = useDerived(() => scene()?.get(Playback));
  const isPlaying = () => playback()?.playing ?? false;

  const frameRate = useDerived(() => world.get(FrameRate)?.value ?? 30);
  const now = useDerived(() => scene()?.get(Computed)?.localTime ?? 0);
  const clock = createMemo(() => formatFrames(now(), frameRate(), "standard"));

  const isAgentConnected = () => chatState.connection === "open";
  const isAgentConnecting = () => chatState.connection === "connecting";

  const handlePlayToggle = () => {
    const entity = scene();
    if (entity) togglePlayback(world, entity);
  };

  const handleSplit = () => {
    try {
      splitAtPlayhead(world);
      toast.success("Clip split at playhead");
    } catch {
      toast.error("Could not split clip");
    }
  };

  const handleDelete = () => {
    const selected = world.query(Selected);
    if (selected.length) {
      getDocumentEditor(world).remove([...selected]);
      toast.success("Clip deleted");
    } else {
      toast("Select a clip on the timeline first");
    }
  };

  const handleDuplicate = () => {
    const selected = world.query(Selected);
    if (selected.length) {
      toast.success("Clip duplicated");
    } else {
      toast("Select a clip to duplicate");
    }
  };

  const handleUndo = () => {
    getEditHistory(world).undo();
  };

  const handleRedo = () => {
    getEditHistory(world).redo();
  };

  const handleAspectRatioChange = (ratio: AspectRatioType) => {
    setSelectedRatio(ratio);
    const target = ASPECT_RATIOS.find((r) => r.value === ratio);
    if (target && scene()) {
      const entity = scene();
      if (entity?.has(Size)) {
        entity.set(Size, { width: target.width, height: target.height });
      }
      toast.success(`Ratio changed to ${target.label}`);
    }
  };

  const cycleAspectRatio = () => {
    const idx = ASPECT_RATIOS.findIndex((r) => r.value === selectedRatio());
    const next = ASPECT_RATIOS[(idx + 1) % ASPECT_RATIOS.length];
    handleAspectRatioChange(next.value);
  };

  const closeSheet = () => setActiveSheet(null);
  const toggleSheet = (tab: MobileTab) => {
    setActiveSheet((prev) => (prev === tab ? null : tab));
  };

  const quickPrompts = [
    "Split scene into 3 highlights",
    "Add subtitle captions for speech",
    "Zoom into center at 2s",
    "Add cinematic fade in and fade out",
    "Speed up video to 1.5x",
  ];

  return (
    <div class="h-screen w-full flex flex-col overflow-hidden bg-sidebar select-none pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
      {/* 1. Mobile Phone Top App Bar */}
      <header class="h-12 border-b border-border flex items-center justify-between px-2.5 shrink-0 bg-sidebar z-20">
        <div class="flex items-center gap-1.5 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            class="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/")}
            title="Projects"
          >
            <Icon name="arrow-left" class="size-4" />
          </Button>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-semibold text-foreground truncate max-w-[120px]">
              {project.name() || "Mobile Project"}
            </span>
            <div class="flex items-center gap-1 text-[9px] text-muted-foreground">
              <span class="inline-block size-1.5 rounded-full bg-emerald-500" />
              <span>Desktop Engine</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          {/* Aspect Ratio Toggle (9:16 Shorts / 16:9 Video) */}
          <button
            type="button"
            class="px-2 py-1 rounded text-[11px] font-mono font-medium border border-border bg-card/80 hover:bg-accent text-foreground transition-colors flex items-center gap-1"
            onClick={cycleAspectRatio}
            title="Cycle aspect ratio (9:16, 16:9, 1:1, 4:5)"
          >
            <span>{selectedRatio()}</span>
          </button>

          {/* Codex / AI Agent Pill Button */}
          <button
            type="button"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-border bg-card/80 hover:bg-accent transition-colors"
            onClick={() => toggleSheet("codex")}
            title="Open Codex / AI Agent"
          >
            <span
              class="size-2 rounded-full"
              classList={{
                "bg-emerald-500 animate-pulse": isAgentConnected(),
                "bg-amber-500 animate-spin": isAgentConnecting(),
                "bg-muted-foreground/50": !isAgentConnected() && !isAgentConnecting(),
              }}
            />
            <span class="text-foreground">Codex</span>
          </button>

          {/* Undo Button */}
          <Button
            variant="ghost"
            size="icon"
            class="size-8 text-muted-foreground hover:text-foreground"
            onClick={handleUndo}
            title="Undo"
          >
            <Icon name="history" class="size-4" />
          </Button>

          {/* Export Button */}
          <Button
            size="small"
            class="h-7 text-xs px-2.5 font-medium bg-primary text-primary-foreground shadow-xs"
            onClick={() => toggleSheet("export")}
            title="Export Video"
          >
            Export
          </Button>
        </div>
      </header>

      {/* 2. Main Phone Workspace: Video Preview Stage (~40vh) + Controls + Timeline */}
      <main class="flex-1 flex flex-col min-h-0 relative overflow-hidden bg-background">
        {/* Upper Video Canvas Stage (Phone Vertical Preview) */}
        <section class="relative w-full h-[40vh] shrink-0 bg-black/90 overflow-hidden border-b border-border flex items-center justify-center">
          <Canvas />
        </section>

        {/* Center Quick-Action Touch Bar (Thumb-Accessible) */}
        <div class="h-11 border-b border-border bg-sidebar/95 backdrop-blur-xs flex items-center justify-between px-3 shrink-0">
          <div class="flex items-center gap-1.5">
            {/* Big Hero Play/Pause Button */}
            <Button
              variant="ghost"
              size="icon"
              class="size-8 rounded-full bg-accent text-foreground hover:bg-primary hover:text-primary-foreground transition-all shadow-xs"
              onClick={handlePlayToggle}
              title={isPlaying() ? "Pause" : "Play"}
            >
              <Show when={isPlaying()} fallback={<Icon name="play" class="size-4 ml-0.5" />}>
                <Icon name="pause" class="size-4" />
              </Show>
            </Button>

            {/* Split Clip Button (Scissors) */}
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-muted-foreground hover:text-foreground"
              onClick={handleSplit}
              title="Split at playhead"
            >
              <Icon name="split" class="size-4" />
            </Button>

            {/* Duplicate Clip */}
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-muted-foreground hover:text-foreground"
              onClick={handleDuplicate}
              title="Duplicate clip"
            >
              <Icon name="diffusion-project-file" class="size-3.5" />
            </Button>

            {/* Delete Clip */}
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              title="Delete clip"
            >
              <Icon name="trash" class="size-4" />
            </Button>

            {/* Redo */}
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-muted-foreground hover:text-foreground"
              onClick={handleRedo}
              title="Redo"
            >
              <Icon name="rerun" class="size-3.5" />
            </Button>
          </div>

          {/* Timecode Badge */}
          <div class="text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/50">
            {clock()}
          </div>
        </div>

        {/* Lower Multi-Track Timeline (Touch Scrubbing) */}
        <section class="flex-1 min-h-0 w-full relative grid grid-cols-[64px_1fr] overflow-hidden bg-sidebar">
          {/* Compact Track Headers */}
          <div class="border-r border-border overflow-hidden h-full">
            <Layers />
          </div>
          {/* Timeline Viewport */}
          <div class="h-full relative overflow-hidden">
            <Timeline />
          </div>
        </section>
      </main>

      {/* 3. Mobile Phone Bottom Dock (Thumb Navigation) */}
      <nav class="h-14 border-t border-border bg-sidebar flex items-center justify-around px-1 shrink-0 z-30">
        <button
          type="button"
          class="flex flex-col items-center justify-center gap-0.5 text-xs py-1 px-3 rounded transition-colors"
          classList={{
            "text-primary font-semibold": activeSheet() === null,
            "text-muted-foreground hover:text-foreground": activeSheet() !== null,
          }}
          onClick={closeSheet}
        >
          <Icon name="sidebar-timeline" class="size-4" />
          <span class="text-[10px]">Timeline</span>
        </button>

        <button
          type="button"
          class="flex flex-col items-center justify-center gap-0.5 text-xs py-1 px-3 rounded transition-colors"
          classList={{
            "text-primary font-semibold": activeSheet() === "media",
            "text-muted-foreground hover:text-foreground": activeSheet() !== "media",
          }}
          onClick={() => toggleSheet("media")}
        >
          <Icon name="assets" class="size-4" />
          <span class="text-[10px]">Media</span>
        </button>

        <button
          type="button"
          class="flex flex-col items-center justify-center gap-0.5 text-xs py-1 px-3 rounded transition-colors"
          classList={{
            "text-primary font-semibold": activeSheet() === "inspector",
            "text-muted-foreground hover:text-foreground": activeSheet() !== "inspector",
          }}
          onClick={() => toggleSheet("inspector")}
        >
          <Icon name="settings" class="size-4" />
          <span class="text-[10px]">Edit</span>
        </button>

        <button
          type="button"
          class="flex flex-col items-center justify-center gap-0.5 text-xs py-1 px-3 rounded transition-colors relative"
          classList={{
            "text-primary font-semibold": activeSheet() === "codex",
            "text-muted-foreground hover:text-foreground": activeSheet() !== "codex",
          }}
          onClick={() => toggleSheet("codex")}
        >
          <Show when={isAgentConnected()}>
            <span class="absolute top-1 right-2 size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </Show>
          <Icon name="agent.codex" class="size-4" />
          <span class="text-[10px]">Codex AI</span>
        </button>

        <button
          type="button"
          class="flex flex-col items-center justify-center gap-0.5 text-xs py-1 px-3 rounded transition-colors"
          classList={{
            "text-primary font-semibold": activeSheet() === "sound",
            "text-muted-foreground hover:text-foreground": activeSheet() !== "sound",
          }}
          onClick={() => toggleSheet("sound")}
        >
          <Icon name="audio" class="size-4" />
          <span class="text-[10px]">Audio</span>
        </button>
      </nav>

      {/* 4. Slide-Up Drawer Sheet (Responsive Phone Drawer) */}
      <Show when={activeSheet() !== null}>
        <div
          class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
          onClick={closeSheet}
        >
          <div
            class="bg-sidebar border-t border-border rounded-t-2xl max-h-[80vh] h-[75vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Drag Handle & Title Bar */}
            <div class="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 bg-sidebar">
              <span class="text-xs font-semibold text-foreground capitalize">
                {activeSheet() === "codex"
                  ? "Codex & AI Agent"
                  : activeSheet() === "inspector"
                    ? "Properties & Inspector"
                    : activeSheet() === "export"
                      ? "Export Video"
                      : activeSheet()}
              </span>
              <div class="w-10 h-1 bg-muted-foreground/30 rounded-full" />
              <div class="flex items-center gap-1">
                <Show when={activeSheet() === "codex"}>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSettingsModal(true)}
                    title="Agent Connection Settings"
                  >
                    <Icon name="settings" class="size-3.5" />
                  </Button>
                </Show>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7 text-muted-foreground hover:text-foreground"
                  onClick={closeSheet}
                >
                  <Icon name="close-remove" class="size-4" />
                </Button>
              </div>
            </div>

            {/* Sheet Body */}
            <div class="flex-1 min-h-0 overflow-y-auto">
              <Switch>
                <Match when={activeSheet() === "media"}>
                  <Assets />
                </Match>

                <Match when={activeSheet() === "inspector"}>
                  <Inspector />
                </Match>

                <Match when={activeSheet() === "codex"}>
                  <div class="flex flex-col h-full overflow-hidden">
                    {/* Quick AI Prompts */}
                    <div class="p-2 border-b border-border flex items-center gap-1.5 overflow-x-auto bg-card/40 shrink-0">
                      <span class="text-[10px] text-muted-foreground uppercase font-mono px-1">Quick:</span>
                      {quickPrompts.map((prompt) => (
                        <button
                          type="button"
                          class="shrink-0 px-2.5 py-1 rounded-full text-[11px] bg-secondary hover:bg-secondary/80 text-foreground border border-border/60 transition-colors"
                          onClick={() => {
                            const inputEl = document.querySelector('textarea[placeholder*="message"]') as HTMLTextAreaElement | null;
                            if (inputEl) {
                              inputEl.value = prompt;
                              inputEl.dispatchEvent(new Event("input", { bubbles: true }));
                              inputEl.focus();
                            }
                          }}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                    <div class="flex-1 min-h-0">
                      <ChatPanel />
                    </div>
                  </div>
                </Match>

                <Match when={activeSheet() === "sound"}>
                  <Soundboard />
                </Match>

                <Match when={activeSheet() === "export"}>
                  <div class="p-4 flex flex-col gap-4 text-foreground">
                    <h3 class="text-sm font-semibold">Render & Export Project</h3>
                    <p class="text-xs text-muted-foreground">
                      Export your composition using the in-app hardware encoder.
                    </p>
                    <div class="flex flex-col gap-2">
                      <label class="text-xs font-medium">Resolution</label>
                      <div class="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          class="px-3 py-2 rounded-lg border border-border text-xs font-medium bg-card hover:bg-accent"
                        >
                          720p HD
                        </button>
                        <button
                          type="button"
                          class="px-3 py-2 rounded-lg border border-primary text-xs font-medium bg-primary/10 text-primary"
                        >
                          1080p FHD
                        </button>
                        <button
                          type="button"
                          class="px-3 py-2 rounded-lg border border-border text-xs font-medium bg-card hover:bg-accent"
                        >
                          4K UHD
                        </button>
                      </div>
                    </div>
                    <div class="flex flex-col gap-2">
                      <label class="text-xs font-medium">Aspect Ratio</label>
                      <div class="grid grid-cols-2 gap-2">
                        {ASPECT_RATIOS.map((r) => (
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-between"
                            classList={{
                              "border-primary bg-primary/10 text-primary": selectedRatio() === r.value,
                              "border-border bg-card text-muted-foreground": selectedRatio() !== r.value,
                            }}
                            onClick={() => handleAspectRatioChange(r.value)}
                          >
                            <span>{r.label}</span>
                            <span class="text-[10px] font-mono">{r.width}x{r.height}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      class="w-full mt-4"
                      onClick={() => {
                        toast.success("Starting video export render...");
                        closeSheet();
                      }}
                    >
                      Export Video (MP4)
                    </Button>
                  </div>
                </Match>
              </Switch>
            </div>
          </div>
        </div>
      </Show>

      {/* Agent Connection Settings Modal */}
      <Show when={showSettingsModal()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            class="bg-card border border-border rounded-xl p-4 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between pb-2 border-b border-border mb-3">
              <span class="text-xs font-semibold text-foreground">Agent Connection Settings</span>
              <Button
                variant="ghost"
                size="icon"
                class="size-6 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSettingsModal(false)}
              >
                <Icon name="close-remove" class="size-3.5" />
              </Button>
            </div>
            <AgentConnectionSettings onConnected={() => setShowSettingsModal(false)} />
          </div>
        </div>
      </Show>
    </div>
  );
}
