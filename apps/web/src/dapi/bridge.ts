/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isDapiError } from "@diffusionstudio/dapi";
import { createDesktopToolTransport } from "./transport";

import type { DapiCall, DapiCancel, DapiReply } from "@diffusionstudio/dapi";
import type { Handlers, ServedToolName, ToolContext } from "./handler";
import type { ToolTransport } from "./transport";

/** Builds the per-call context; the bridge supplies the abort signal. */
export type ContextFactory = (signal: AbortSignal) => ToolContext;

/**
 * Answers renderer tools independently of how calls reach the renderer.
 * Desktop uses Electron IPC; browser/mobile can attach an authenticated relay
 * transport without changing the handlers or editor engine.
 */
class ToolBridge {
  private handlers: Handlers | null = null;
  private context: ContextFactory | null = null;
  private held: DapiCall[] = [];
  private readonly inFlight = new Map<string, AbortController>();
  private transport: ToolTransport | null = null;
  private stopTransport: (() => void) | null = null;

  constructor() {
    const desktop = createDesktopToolTransport();
    if (desktop) this.attach(desktop);
  }

  attach(transport: ToolTransport): () => void {
    if (this.transport) {
      throw new Error("A DAPI transport is already attached");
    }

    this.transport = transport;
    this.stopTransport = transport.start({
      call: (call) => void this.dispatch(call),
      cancel: (cancel) => this.cancel(cancel),
    });

    return () => {
      if (this.transport !== transport) return;
      this.stopTransport?.();
      this.stopTransport = null;
      this.transport = null;
      this.held = [];
      for (const controller of this.inFlight.values()) controller.abort();
      this.inFlight.clear();
    };
  }

  register(handlers: Handlers, context: ContextFactory): () => void {
    this.handlers = handlers;
    this.context = context;
    const held = this.held;
    this.held = [];
    for (const call of held) void this.dispatch(call);
    return () => {
      if (this.handlers === handlers) {
        this.handlers = null;
        this.context = null;
      }
    };
  }

  private cancel(cancel: DapiCancel): void {
    this.inFlight.get(cancel.id)?.abort();
  }

  private async dispatch(call: DapiCall): Promise<void> {
    if (!this.handlers || !this.context) {
      this.held.push(call);
      return;
    }

    const controller = new AbortController();
    this.inFlight.set(call.id, controller);

    let reply: DapiReply;
    try {
      const handler = this.handlers[call.tool as ServedToolName];
      if (!handler) throw new Error(`The app has no handler for "${call.tool}"`);
      // Every handler takes its own parsed args; the map's union type cannot
      // express that pairing, so the call site widens.
      const run = handler as (args: unknown, ctx: ToolContext) => Promise<unknown>;
      reply = { id: call.id, ok: true, data: await run(call.args, this.context(controller.signal)) };
    } catch (error) {
      const message = (error as Error).message;
      reply = {
        id: call.id,
        ok: false,
        error: isDapiError(error) ? { code: error.code, message } : { message },
      };
    } finally {
      this.inFlight.delete(call.id);
    }

    if (controller.signal.aborted) return;
    try {
      this.transport?.reply(reply);
    } catch (error) {
      console.error("[dapi] failed to send tool reply:", error);
    }
  }
}

export const toolBridge = new ToolBridge();

export function attachToolTransport(transport: ToolTransport): () => void {
  return toolBridge.attach(transport);
}
