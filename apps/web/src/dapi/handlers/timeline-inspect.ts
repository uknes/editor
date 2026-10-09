/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AdjustmentLayer,
  Chars,
  ChildOf,
  Computed,
  FrameRate,
  Geometry,
  Group,
  Name,
  Scene,
  Sequential,
  Source,
  Trim,
  Workarea,
  buildTimelineLayers,
  findGeometryAsset,
  getActiveEntity,
  isCaption,
  isText,
  store,
} from "@diffusionstudio/runtime";
import { Or } from "koota";

import type { Entity } from "koota";
import type { TimelineClip, TimelineTrack, TimelineScene } from "@diffusionstudio/dapi";
import type { ToolHandler } from "../handler";

export const timelineInspect: ToolHandler<"timeline_inspect"> = async (_, ctx) => {
  const session = ctx.session();
  if (!session) {
    return {
      projectDir: null,
      currentTime: null,
      scenes: [],
    };
  }

  const { world, project } = session;
  const fps = world.get(FrameRate)?.value || 30;
  const active = getActiveEntity(world);
  const currentTime = active ? (active.get(Computed)?.localTime ?? 0) / fps : null;

  const scenes: TimelineScene[] = [];
  const sceneEntities = world.query(Scene);

  for (const scene of sceneEntities) {
    const computed = scene.get(Computed);
    const duration = (computed?.duration ?? 0) / fps;
    const width = computed?.width ?? 1920;
    const height = computed?.height ?? 1080;
    const wa = scene.get(Workarea);
    const workarea = wa ? { start: wa.start / fps, end: wa.end / fps } : undefined;

    const layers = buildTimelineLayers(world, scene);
    const tracks: TimelineTrack[] = [];

    for (const layer of layers) {
      const trackEntity = layer.entity;
      const trackId = String(trackEntity.id());
      const trackName = trackEntity.get(Name)?.value || undefined;

      let trackType = "general";
      if (layer.kind === "keyframe-track") {
        trackType = "keyframes";
      } else if (layer.entity.has(Sequential)) {
        trackType = "sequence";
      }

      const clips: TimelineClip[] = [];
      const computedStore = store(world, Computed);

      const collectClip = (entity: Entity) => {
        const id = entity.get(Source)?.value || String(entity.id());
        const name = entity.get(Name)?.value || undefined;
        const start = (computedStore.start[entity.id()] ?? 0) / fps;
        const end = (computedStore.end[entity.id()] ?? 0) / fps;
        const clipDuration = Math.max(0, end - start);
        const trim = entity.get(Trim);
        const offset = trim?.start !== undefined ? trim.start / fps : undefined;
        const asset = findGeometryAsset(world, entity);
        const source = entity.get(Source)?.value || asset?.path || undefined;
        const text = isText(entity) ? entity.get(Chars)?.value : undefined;

        if (trackType === "general" || trackType === "sequence") {
          if (isText(entity) || isCaption(entity)) {
            trackType = "text";
          } else if (asset?.type === "AUDIO") {
            trackType = "audio";
          } else if (asset?.type === "VIDEO" || asset?.type === "IMAGE") {
            trackType = "video";
          }
        }

        clips.push({
          id,
          name,
          start,
          duration: clipDuration,
          offset,
          source,
          text,
        });
      };

      if (trackEntity.has(Sequential)) {
        const children = [...world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(trackEntity))];
        for (const child of children) {
          collectClip(child);
        }
      } else if (layer.kind === "geometry" || layer.kind === "sub-item") {
        collectClip(trackEntity);
      }

      tracks.push({
        id: trackId,
        name: trackName,
        type: trackType,
        clips,
      });
    }

    scenes.push({
      id: String(scene.id()),
      duration,
      fps,
      width,
      height,
      workarea,
      tracks,
    });
  }

  return {
    projectDir: project.dir(),
    currentTime,
    scenes,
  };
};
