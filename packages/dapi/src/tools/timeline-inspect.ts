/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const TimelineClip = z.object({
  id: z.string().describe("clip entity ID or source stamp"),
  name: z.string().optional(),
  start: z.number().describe("start time in seconds"),
  duration: z.number().describe("duration in seconds"),
  offset: z.number().optional().describe("source media offset in seconds"),
  source: z.string().optional().describe("referenced media asset path or generator"),
  text: z.string().optional().describe("text content if text clip"),
});

export const TimelineTrack = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().describe("video, audio, text, or general"),
  clips: z.array(TimelineClip),
});

export const TimelineScene = z.object({
  id: z.string(),
  duration: z.number().describe("seconds"),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  workarea: z.object({ start: z.number(), end: z.number() }).optional(),
  tracks: z.array(TimelineTrack),
});

export const timelineInspect = defineTool({
  name: "timeline_inspect",
  title: "Timeline state inspect",
  description:
    "Inspect the current project timeline: scenes, tracks, and clips with their IDs, timing, and media sources. Inspect before and after editing to plan and verify cuts.",
  input: z.object({}),
  output: z.object({
    projectDir: z.string().nullable(),
    currentTime: z.number().nullable(),
    scenes: z.array(TimelineScene),
  }),
  environment: "renderer",
});
