/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { SceneId } from "../schemas";
import { NonNegativeTime } from "../time";

export const renderPreview = defineTool({
  name: "render_preview",
  title: "Render preview",
  description:
    "Encode a fast, low-resolution video preview (default 480p, 15fps) of a scene or range for agent inspection. Much faster and cheaper than a full export. Returns the output path and render metadata.",
  input: z.object({
    id: SceneId.optional().describe("scene id to preview (default: primary scene)"),
    start: NonNegativeTime.optional().describe("start time in seconds, frames (\"45f\"), or \"MM:SS\" (default: 0)"),
    end: NonNegativeTime.optional().describe("end time in seconds, frames, or \"MM:SS\" (default: workarea or scene end)"),
    resolution: z
      .number()
      .positive()
      .optional()
      .describe("vertical pixel resolution (default: 480)"),
    fps: z
      .number()
      .positive()
      .optional()
      .describe("preview frame rate (default: 15)"),
    path: z
      .string()
      .optional()
      .describe("absolute output file path; defaults to a fresh file in the temp directory"),
  }),
  output: z.object({
    path: z.string().describe("absolute path of the rendered video"),
    width: z.number().describe("encoded width in pixels"),
    height: z.number().describe("encoded height in pixels"),
    duration: z.number().describe("duration in seconds"),
    fps: z.number().describe("encoded frame rate"),
    size: z.number().describe("file size in bytes"),
  }),
  environment: "renderer",
});
