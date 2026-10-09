/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { InspectValue, PropValue, SerializedAssetRef } from "@diffusionstudio/jsx";

export type { PropValue, SerializedAssetRef, InspectValue };

export type EditValue = PropValue | SerializedAssetRef;

export interface SourceSet {
  kind: "set";
  source: string;
  props: Record<string, EditValue>;
  text?: string;
}

export interface SourceInsert {
  kind: "insert";
  source: string;
  parent: string;
  tag: string;
  props: Record<string, EditValue>;
  before?: string;
  text?: string;
}

export interface SourceMove {
  kind: "move";
  source: string;
  parent: string;
  before?: string;
}

export interface SourceRemove {
  kind: "remove";
  source: string;
}

export type SourceIteration = Record<string, { props: Record<string, EditValue>; text?: string; pending?: string }>;

export interface SourceUnroll {
  kind: "unroll";
  source: string;
  iterations: SourceIteration[];
}

export interface SourceVariable {
  kind: "variable";
  file: string;
  name: string;
  value: InspectValue;
}

export type SourceEdit = SourceSet | SourceInsert | SourceMove | SourceRemove | SourceUnroll | SourceVariable;

export interface WriteResult {
  skipped: string[];
  ids?: Record<string, string>;
  unrolled?: string[];
  error?: string;
}

export type ProjectInfo = {
  id: string;
  name: string;
  displayName: string;
  dir: string;
  entry: string;
  modifiedAt: string;
  createdAt: string;
};

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

export type AgentId = "claude-desktop" | "cursor" | "vscode" | "codex";

export type McpAgentStatus = {
  id: AgentId;
  label: string;
  detected: boolean;
  connected: boolean;
  config: string;
  unavailable: string | null;
};

export type McpStatus = {
  url: string;
  agents: McpAgentStatus[];
};

export type McpApplyRequest = {
  add: AgentId[];
  remove: AgentId[];
};

export type McpApplyResult = {
  added: AgentId[];
  removed: AgentId[];
  failures: { id: AgentId; error: string }[];
};

export type CodexCloudState =
  | "checking"
  | "tunnel-client-missing"
  | "installing"
  | "ready"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type CodexCloudStatus = {
  state: CodexCloudState;
  clientAvailable: boolean;
  clientManaged: boolean;
  clientPath: string | null;
  clientVersion: string | null;
  mcpReachable: boolean;
  tunnelId: string | null;
  connectedAt: string | null;
  connectedDurationMs: number | null;
  healthUrl: string | null;
  lastError: string | null;
};

export type CodexCloudStartRequest = {
  tunnelId: string;
  apiKey: string;
};

export type CliStatus = {
  installed: boolean;
  path: string | null;
  managed: boolean;
  available: boolean;
};

export type FsEntry = {
  name: string;
  kind: "file" | "directory";
  size: number;
  mtime: number;
  link?: boolean;
};

export type FsStat = {
  size: number;
  mtime: number;
};
