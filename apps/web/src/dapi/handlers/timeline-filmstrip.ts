/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createImageEncoder, decodePng } from "@diffusionstudio/encoder";
import { Computed, FrameRate, Scene, Workarea } from "@diffusionstudio/runtime";
import { TIME_FPS } from "@diffusionstudio/jsx";
import { DapiError } from "@diffusionstudio/dapi";
import { createCapture } from "@/engine/capture";
import { requireScene } from "../lib/scene";
import { SheetCollector } from "../lib/sheets";

import type { ToolHandler } from "../handler";

const SHEET_CAPTURE_HEIGHT = 1080;

export const timelineFilmstrip: ToolHandler<"timeline_filmstrip"> = async (
  { id, start, end, frameCount = 8, separate, perSheet },
  ctx,
) => {
  const { world, project } = ctx.requireSession();
  const scene = id ? requireScene(world, id, "timeline_filmstrip") : world.query(Scene)[0];
  if (!scene) {
    throw new DapiError("not-found", "No scene found on timeline for filmstrip.");
  }

  const fps = world.get(FrameRate)?.value || TIME_FPS;
  const workarea = scene.get(Workarea);
  const computed = scene.get(Computed);
  const sceneDurationFrames = workarea
    ? workarea.end - workarea.start
    : computed?.duration ?? 0;
  const sceneDurationSeconds = sceneDurationFrames / fps;

  const startSeconds = Math.max(0, start ?? (workarea ? workarea.start / fps : 0));
  const endSeconds = Math.min(
    sceneDurationSeconds || 300,
    end ?? (workarea ? workarea.end / fps : sceneDurationSeconds || 5),
  );

  const count = Math.max(1, Math.min(36, frameCount));
  const shots: number[] = [];
  if (count === 1 || endSeconds <= startSeconds) {
    shots.push(Math.round(startSeconds * TIME_FPS));
  } else {
    const step = (endSeconds - startSeconds) / (count - 1);
    for (let i = 0; i < count; i++) {
      shots.push(Math.round((startSeconds + i * step) * TIME_FPS));
    }
  }

  const target = await createCapture(world, scene, { dir: project.dir() });
  try {
    const encoder = await createImageEncoder(target.world, { frames: shots, resolution: 720 });

    let sheets: SheetCollector | undefined;
    if (!separate) {
      const aspect = encoder.bounds.width / encoder.bounds.height;
      const height = Math.max(encoder.bounds.height, SHEET_CAPTURE_HEIGHT);
      sheets = new SheetCollector(shots.length, { width: height * aspect, height }, perSheet);
      encoder.resize(sheets.cellHeight);
    }

    const abortHandler = () => encoder.cancel();
    ctx.signal.addEventListener("abort", abortHandler);

    try {
      const result = await encoder.render();
      if (result.type === "canceled") throw new DapiError("canceled", "Filmstrip canceled");
      if (result.type === "error") throw result.error;
      if (!sheets) return result.data;

      for (const [index, { timecode, png }] of result.data.entries()) {
        await sheets.add(index, { at: shots[index]!, timecode, image: await decodePng(png) });
      }
      return sheets.result();
    } finally {
      ctx.signal.removeEventListener("abort", abortHandler);
    }
  } finally {
    target.dispose();
  }
};
