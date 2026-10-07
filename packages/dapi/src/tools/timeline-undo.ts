/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const timelineUndo = defineTool({
  name: "timeline_undo",
  title: "Timeline undo",
  description:
    "Undo the most recent edit operation on the project timeline. Reverts edits safely using Diffusion Studio's undo history.",
  input: z.object({}),
  output: z.object({
    undone: z.boolean().describe("whether an operation was undone"),
    canUndo: z.boolean().describe("whether further undo steps are available"),
    canRedo: z.boolean().describe("whether redo steps are available"),
  }),
  environment: "renderer",
});
