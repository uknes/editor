/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { CompileResult, SourceEdit, WriteResult } from "./types";

/** Converts camelCase to PascalCase (e.g. "keyframeTrack" -> "KeyframeTrack") */
function toPascalCase(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

/**
 * Extracts and parses props from a JSX tag string.
 */
function parseProps(propString: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const propRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|\{([^}]+)\}))?/g;
  let match: RegExpExecArray | null;

  while ((match = propRegex.exec(propString)) !== null) {
    const key = match[1];
    if (match[2] !== undefined) {
      props[key] = match[2];
    } else if (match[3] !== undefined) {
      props[key] = match[3];
    } else if (match[4] !== undefined) {
      const val = match[4].trim();
      if (val === "true") props[key] = true;
      else if (val === "false") props[key] = false;
      else if (!isNaN(Number(val)) && val !== "") props[key] = Number(val);
      else {
        try {
          props[key] = JSON.parse(val);
        } catch {
          props[key] = val;
        }
      }
    } else {
      props[key] = true;
    }
  }

  return props;
}

export type ParsedJsxNode = {
  tag: string;
  sourceId: string;
  rawTag: string;
  props: Record<string, unknown>;
  text?: string;
  children: ParsedJsxNode[];
};

/**
 * Parses simplified JSX tree from composition source.
 */
export function parseCompositionJsx(source: string): ParsedJsxNode | null {
  // Find top level <stage ...>...</stage>
  const stageMatch = /<stage\b([^>]*)>([\s\S]*?)<\/stage>|<stage\b([^>]*)\/>/.exec(source);
  if (!stageMatch) return null;

  const stageProps = parseProps(stageMatch[1] || stageMatch[3] || "");
  const stageInner = stageMatch[2] || "";

  let idCounter = 0;
  const rootNode: ParsedJsxNode = {
    tag: "stage",
    sourceId: "index.tsx#stage_0",
    rawTag: "stage",
    props: stageProps,
    children: [],
  };

  function parseChildren(content: string, parentNode: ParsedJsxNode) {
    // Regex for matching tags: <tag ...>...</tag> or <tag ... />
    const tagRegex = /<([a-zA-Z0-9]+)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let childMatch: RegExpExecArray | null;

    while ((childMatch = tagRegex.exec(content)) !== null) {
      const tag = childMatch[1];
      const attrStr = childMatch[2] || "";
      const innerContent = childMatch[3];
      const props = parseProps(attrStr);
      idCounter++;

      const sourceId = typeof props.id === "string" ? String(props.id) : `index.tsx#${tag}_${idCounter}`;

      const node: ParsedJsxNode = {
        tag,
        sourceId,
        rawTag: tag,
        props,
        children: [],
      };

      if (innerContent !== undefined) {
        // Check if there are nested tags
        if (/<[a-zA-Z0-9]+/.test(innerContent)) {
          parseChildren(innerContent, node);
        } else {
          node.text = innerContent.trim();
        }
      }

      parentNode.children.push(node);
    }
  }

  parseChildren(stageInner, rootNode);
  return rootNode;
}

/**
 * Emits CommonJS Solid bundle from parsed JSX tree.
 */
function emitNodeJs(node: ParsedJsxNode): string {
  const componentName = toPascalCase(node.tag);
  const propsObj: Record<string, unknown> = {
    ...node.props,
    "data-source": node.sourceId,
  };

  const propEntries: string[] = [];
  for (const [key, value] of Object.entries(propsObj)) {
    if (key === "children" || key === "id") continue;
    if (typeof value === "string") {
      propEntries.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      propEntries.push(`${JSON.stringify(key)}: ${value}`);
    } else {
      propEntries.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    }
  }

  if (node.text !== undefined && node.text.length > 0) {
    propEntries.push(`children: ${JSON.stringify(node.text)}`);
  } else if (node.children.length > 0) {
    const childrenJs = node.children.map((c) => emitNodeJs(c)).join(",\n        ");
    propEntries.push(`get children() {
      return [
        ${childrenJs}
      ];
    }`);
  }

  return `createComponent(${componentName}, {
    ${propEntries.join(",\n    ")}
  })`;
}

/**
 * Compiles a project TSX entry into the Solid universal CJS bundle evaluated by `evaluate(code)`.
 */
export function compileProjectSource(source: string, _filename = "index.tsx"): CompileResult {
  try {
    const parsed = parseCompositionJsx(source);
    if (!parsed) {
      return {
        ok: false,
        error: "No <stage> element found in entry file. Project must export a component returning <stage>.",
      };
    }

    const emittedStage = emitNodeJs(parsed);

    // Build CommonJS module
    const code = `
const {
  createComponent,
  Stage,
  Scene,
  Video,
  Image,
  Audio,
  Text,
  TextRange,
  Sequence,
  Captions,
  AdjustmentLayer,
  SolidPaint,
  LinearGradientPaint,
  RadialGradientPaint,
  ImagePaint,
  VideoPaint,
  ColorStop,
  Stroke,
  Shadow,
  Effect,
  Mask,
  Animation,
  KeyframeTrack,
  Keyframe,
  HtmlPaint,
  Html,
  ShaderPaint,
  SurfacePaint,
  Surface,
  Rect,
  Group
} = require('@diffusionstudio/jsx');

function Project() {
  return ${emittedStage};
}

module.exports = {
  default: Project
};
`;

    return { ok: true, code: code.trim() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Applies AST SourceEdits to project TSX source code.
 */
export function applyEditsToSource(source: string, edits: SourceEdit[]): { source: string; result: WriteResult } {
  const tree = parseCompositionJsx(source);
  if (!tree) {
    return {
      source,
      result: { skipped: edits.map((e) => (e as { source?: string }).source || "unknown"), error: "Failed to parse JSX tree" },
    };
  }

  const skipped: string[] = [];
  const assignedIds: Record<string, string> = {};

  function findNode(curr: ParsedJsxNode, targetSource: string): ParsedJsxNode | null {
    if (curr.sourceId === targetSource || curr.props["data-source"] === targetSource || curr.props.id === targetSource) {
      return curr;
    }
    for (const child of curr.children) {
      const found = findNode(child, targetSource);
      if (found) return found;
    }
    return null;
  }

  function removeNode(curr: ParsedJsxNode, targetSource: string): boolean {
    const index = curr.children.findIndex((c) => c.sourceId === targetSource || c.props.id === targetSource);
    if (index !== -1) {
      curr.children.splice(index, 1);
      return true;
    }
    for (const child of curr.children) {
      if (removeNode(child, targetSource)) return true;
    }
    return false;
  }

  for (const edit of edits) {
    if (edit.kind === "set") {
      const target = findNode(tree, edit.source);
      if (!target) {
        skipped.push(edit.source);
        continue;
      }
      for (const [propName, propVal] of Object.entries(edit.props)) {
        target.props[propName] = propVal;
      }
      if (edit.text !== undefined) {
        target.text = edit.text;
      }
    } else if (edit.kind === "insert") {
      const parentNode = findNode(tree, edit.parent);
      if (!parentNode) {
        skipped.push(edit.source);
        continue;
      }
      const realId = `elem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      assignedIds[edit.source] = realId;

      const newNode: ParsedJsxNode = {
        tag: edit.tag,
        sourceId: realId,
        rawTag: edit.tag,
        props: { ...edit.props, id: realId },
        children: [],
        text: edit.text,
      };

      if (edit.before) {
        const beforeIdx = parentNode.children.findIndex((c) => c.sourceId === edit.before || c.props.id === edit.before);
        if (beforeIdx !== -1) {
          parentNode.children.splice(beforeIdx, 0, newNode);
        } else {
          parentNode.children.push(newNode);
        }
      } else {
        parentNode.children.push(newNode);
      }
    } else if (edit.kind === "remove") {
      if (!removeNode(tree, edit.source)) {
        skipped.push(edit.source);
      }
    } else if (edit.kind === "move") {
      const target = findNode(tree, edit.source);
      const parentNode = findNode(tree, edit.parent);
      if (!target || !parentNode) {
        skipped.push(edit.source);
        continue;
      }
      removeNode(tree, edit.source);
      if (edit.before) {
        const idx = parentNode.children.findIndex((c) => c.sourceId === edit.before || c.props.id === edit.before);
        if (idx !== -1) parentNode.children.splice(idx, 0, target);
        else parentNode.children.push(target);
      } else {
        parentNode.children.push(target);
      }
    }
  }

  // Re-serialize JSX tree
  function serializeNode(node: ParsedJsxNode, indent = "    "): string {
    const propsList: string[] = [];
    for (const [k, v] of Object.entries(node.props)) {
      if (k === "data-source") continue;
      if (typeof v === "string") {
        propsList.push(`${k}="${v}"`);
      } else if (typeof v === "boolean") {
        if (v) propsList.push(k);
        else propsList.push(`${k}={false}`);
      } else {
        propsList.push(`${k}={${JSON.stringify(v)}}`);
      }
    }
    const propStr = propsList.length > 0 ? " " + propsList.join(" ") : "";

    if (node.text !== undefined && node.text.length > 0) {
      return `${indent}<${node.tag}${propStr}>${node.text}</${node.tag}>`;
    }

    if (node.children.length === 0) {
      return `${indent}<${node.tag}${propStr} />`;
    }

    const childIndent = indent + "  ";
    const serializedChildren = node.children.map((c) => serializeNode(c, childIndent)).join("\n");
    return `${indent}<${node.tag}${propStr}>\n${serializedChildren}\n${indent}</${node.tag}>`;
  }

  const newSource = `export default function Project() {
  return (
${serializeNode(tree, "    ")}
  );
}
`;

  return {
    source: newSource,
    result: {
      skipped,
      ids: Object.keys(assignedIds).length > 0 ? assignedIds : undefined,
    },
  };
}
