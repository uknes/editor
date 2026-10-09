/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getEditHistory } from "@/engine/history";
import type { ToolHandler } from "../handler";

export const timelineUndo: ToolHandler<"timeline_undo"> = async (_, ctx) => {
  const { world } = ctx.requireSession();
  const history = getEditHistory(world);
  const hadUndo = history.canUndo();
  if (hadUndo) {
    history.undo();
  }
  return {
    undone: hadUndo,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
  };
};
