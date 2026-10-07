/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { computeOutputSize, createEncoder } from "@diffusionstudio/encoder";
import { Computed, FrameRate, Scene, Workarea } from "@diffusionstudio/runtime";
import { DapiError } from "@diffusionstudio/dapi";

import { createCapture } from "@/engine/capture";
import { ElectronWritableFileHandle } from "@/lib/electron-file-writable";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { requireScene } from "../lib/scene";

import type { ToolHandler } from "../handler";

export const renderPreview: ToolHandler<"render_preview"> = async (
  { id, start, end, resolution = 480, fps = 15, path },
  ctx,
) => {
  const { world, project } = ctx.requireSession();

  let scene = id ? requireScene(world, id, "render_preview") : world.query(Scene)[0];
  if (!scene) {
    throw new DapiError("not-found", "No scene found in project to preview.");
  }

  const computed = scene.get(Computed);
  const worldFps = world.get(FrameRate)?.value || 30;
  const fullDurationSeconds = (computed?.duration || 0) / worldFps;

  const startSeconds = Math.max(0, start ?? 0);
  const endSeconds = Math.min(fullDurationSeconds || 300, end ?? (fullDurationSeconds || 5));

  if (startSeconds >= endSeconds) {
    throw new DapiError("invalid-input", `start (${startSeconds}s) must be less than end (${endSeconds}s)`);
  }

  const duration = endSeconds - startSeconds;
  const target = path ?? `${project.dir()}/exports/preview-${Date.now()}.mp4`;

  const { width, height } = computeOutputSize(
    computed?.width || 1920,
    computed?.height || 1080,
    resolution,
  );

  const capture = await createCapture(world, scene, {
    dir: project.dir(),
    frameRate: fps,
    mode: "offline-video",
  });

  const handle = new ElectronWritableFileHandle(target);
  try {
    const captureScene = capture.node;
    captureScene.set(Workarea, {
      start: Math.round(startSeconds * fps),
      end: Math.round(endSeconds * fps),
    });

    const encoder = await createEncoder(capture.world, {
      video: {
        enabled: true,
        codec: "avc",
        resolution,
        fps,
        bitrate: 1.5e6,
      },
      audio: {
        enabled: true,
        codec: "aac",
        sampleRate: 44100,
        bitrate: 64e3,
      },
      format: "mp4",
      target: handle,
    });

    const abortHandler = () => encoder.cancel();
    ctx.signal.addEventListener("abort", abortHandler);

    try {
      const result = await encoder.render();
      if (result.type === "canceled") {
        throw new DapiError("canceled", "Preview render canceled");
      }
      if (result.type === "error") {
        throw result.error;
      }
    } finally {
      ctx.signal.removeEventListener("abort", abortHandler);
    }
  } catch (error) {
    await handle.dispose().catch(() => {});
    throw error;
  } finally {
    capture.dispose();
  }

  const stat = await mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_STAT, {
    dir: project.dir(),
    source: target,
  });

  return {
    path: target,
    width,
    height,
    duration,
    fps,
    size: stat?.size ?? 0,
  };
};
