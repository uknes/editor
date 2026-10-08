/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Computed, FrameRate, Playback, Selected, togglePlayback } from "@diffusionstudio/runtime";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Canvas } from "@/components/canvas";
import { Timeline, Layers } from "@/components/timeline";
import { Assets } from "@/components/sidebar-left/assets";
import { Inspector, Soundboard } from "@/components/sidebar-right";
import { ChatPanel, chatState } from "@/agent-chat";
import { splitAtPlayhead } from "@/engine/split";
import { getDocumentEditor } from "@/engine/editor";
import { getEditHistory } from "@/engine/history";
import { useDerived, useTimelineIndex } from "@/engine/hooks";
import { formatFrames } from "@/components/timeline/time-format";
import { useProject } from "@/context/project";

export type MobileTab = "media" | "inspector" | "codex" | "sound" | null;

export function MobileEditor() {
  const navigate = useNavigate();
  const world = useWorld();
  const project = useProject();
  const index = useTimelineIndex();

  const [activeSheet, setActiveSheet] = createSignal<MobileTab>(null);

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
    splitAtPlayhead(world);
  };

  const handleDelete = () => {
    const selected = world.query(Selected);
    if (selected.length) {
      getDocumentEditor(world).remove([...selected]);
    }
  };

  const handleUndo = () => {
    getEditHistory(world).undo();
  };

  const handleRedo = () => {
    getEditHistory(world).redo();
  };

  const closeSheet = () => setActiveSheet(null);
  const toggleSheet = (tab: MobileTab) => {
    setActiveSheet((prev) => (prev === tab ? null : tab));
  };

  return (
    <div class="h-screen w-full flex flex-col overflow-hidden bg-sidebar select-none">
      {/* 1. Mobile Header (Top) */}
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
            <span class="text-xs font-semibold text-foreground truncate max-w-[130px]">
              {project.name() || "Untitled Project"}
            </span>
            <span class="text-[9px] text-muted-foreground uppercase tracking-wider font-mono">
              Portrait Editor
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1 shrink-0">
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

          {/* Undo / Redo */}
          <Button
            variant="ghost"
            size="icon"
            class="size-8 text-muted-foreground hover:text-foreground"
            onClick={handleUndo}
            title="Undo"
          >
            <Icon name="history" class="size-4" />
          </Button>

          {/* Export / Inspector trigger */}
          <Button
            size="small"
            class="h-7 text-xs px-2.5"
            onClick={() => toggleSheet("inspector")}
            title="Export & Settings"
          >
            Export
          </Button>
        </div>
      </header>

      {/* 2. Main Workspace: Canvas (Upper ~42vh) + Controls + Timeline (Lower) */}
      <main class="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {/* Upper: Video Canvas */}
        <section class="relative w-full h-[40vh] shrink-0 bg-background overflow-hidden border-b border-border">
          <Canvas />
        </section>

        {/* Action / Scrubber Control Bar */}
        <div class="h-10 border-b border-border bg-sidebar flex items-center justify-between px-3 shrink-0">
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-foreground"
              onClick={handlePlayToggle}
              title={isPlaying() ? "Pause" : "Play"}
            >
              <Show when={isPlaying()} fallback={<Icon name="play" class="size-4" />}>
                <Icon name="pause" class="size-4" />
              </Show>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-muted-foreground hover:text-foreground"
              onClick={handleSplit}
              title="Split at playhead"
            >
              <Icon name="split" class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              title="Delete clip"
            >
              <Icon name="trash" class="size-4" />
            </Button>
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

          <div class="text-[11px] font-mono text-muted-foreground bg-muted/30 px-2 py-0.5 rounded border border-border/40">
            {clock()}
          </div>
        </div>

        {/* Lower: Multi-track Timeline */}
        <section class="flex-1 min-h-0 w-full relative grid grid-cols-[68px_1fr] overflow-hidden bg-sidebar">
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

      {/* 3. Mobile Bottom Dock (Navigation) */}
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
          <span class="text-[10px]">Codex / AI</span>
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
          <span class="text-[10px]">Sound</span>
        </button>
      </nav>

      {/* 4. Slide-Up Drawer Sheet */}
      <Show when={activeSheet() !== null}>
        <div
          class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
          onClick={closeSheet}
        >
          <div
            class="bg-sidebar border-t border-border rounded-t-2xl max-h-[78vh] h-[72vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Drag Handle & Title */}
            <div class="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 bg-sidebar">
              <span class="text-xs font-semibold text-foreground capitalize">
                {activeSheet() === "codex"
                  ? "Codex & AI Agent"
                  : activeSheet() === "inspector"
                    ? "Properties & Export"
                    : activeSheet()}
              </span>
              <div class="w-10 h-1 bg-muted-foreground/30 rounded-full" />
              <Button
                variant="ghost"
                size="icon"
                class="size-7 text-muted-foreground hover:text-foreground"
                onClick={closeSheet}
              >
                <Icon name="close-remove" class="size-4" />
              </Button>
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
                    <ChatPanel />
                  </div>
                </Match>

                <Match when={activeSheet() === "sound"}>
                  <Soundboard />
                </Match>
              </Switch>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
