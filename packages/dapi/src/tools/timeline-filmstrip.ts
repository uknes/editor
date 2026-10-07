/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { checkSheetOptions, ImageRef, outputDirField, SceneId, sheetFields, TimecodedImage } from "../schemas";
import { NonNegativeTime } from "../time";

export const timelineFilmstrip = defineTool({
  name: "timeline_filmstrip",
  title: "Timeline filmstrip",
  description:
    "Sample evenly spaced frames across the composed timeline/scene to inspect cuts, scene composition, and gameplay flow. Returns a contact sheet or individual PNG images stamped with timecodes.",
  input: z
    .object({
      id: SceneId.optional().describe("scene id to sample (default: primary scene)"),
      start: NonNegativeTime.optional().describe("start time (default: 0)"),
      end: NonNegativeTime.optional().describe("end time (default: scene duration)"),
      frameCount: z
        .number()
        .int()
        .min(1)
        .max(36)
        .optional()
        .describe("number of evenly spaced frames to sample (default: 8)"),
      ...sheetFields,
      output: outputDirField,
    })
    .superRefine(checkSheetOptions),
  output: z.object({ images: z.array(ImageRef) }),
  result: z.array(TimecodedImage),
  environment: "renderer",
});
