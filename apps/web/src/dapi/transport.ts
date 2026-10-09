/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DAPI_WIRE } from "@diffusionstudio/dapi";

import type { DapiCall, DapiCancel, DapiReply } from "@diffusionstudio/dapi";

export type ToolTransportHandlers = {
  call(call: DapiCall): void;
  cancel(cancel: DapiCancel): void;
};

export type ToolTransport = {
  start(handlers: ToolTransportHandlers): () => void;
  reply(reply: DapiReply): void;
};

/**
 * The existing Electron IPC path, expressed as a transport instead of being
 * hard-wired into the tool bridge.
 */
export function createDesktopToolTransport(): ToolTransport | null {
  if (typeof window === "undefined" || !window.desktop) return null;
  const desktop = window.desktop;

  return {
    start(handlers) {
      const stopCall = desktop.on(DAPI_WIRE.CALL, (payload) => handlers.call(payload as DapiCall));
      const stopCancel = desktop.on(DAPI_WIRE.CANCEL, (payload) => handlers.cancel(payload as DapiCancel));
      return () => {
        stopCall();
        stopCancel();
      };
    },
    reply(reply) {
      desktop.send(DAPI_WIRE.REPLY, reply);
    },
  };
}

export type WebSocketToolEnvelope =
  | { type: "call"; call: DapiCall }
  | { type: "cancel"; cancel: DapiCancel }
  | { type: "reply"; reply: DapiReply };

/**
 * Browser transport for an authenticated relay owned by the surrounding app.
 * Authentication and MCP/schema validation stay at the relay boundary; this
 * transport only carries the already-normalized DAPI call/cancel/reply wire.
 */
export function createWebSocketToolTransport(socket: WebSocket): ToolTransport {
  return {
    start(handlers) {
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;

        let envelope: WebSocketToolEnvelope;
        try {
          envelope = JSON.parse(event.data) as WebSocketToolEnvelope;
        } catch {
          return;
        }

        if (envelope.type === "call") {
          handlers.call(envelope.call);
        } else if (envelope.type === "cancel") {
          handlers.cancel(envelope.cancel);
        }
      };

      socket.addEventListener("message", onMessage);
      return () => socket.removeEventListener("message", onMessage);
    },

    reply(reply) {
      if (socket.readyState !== WebSocket.OPEN) return;
      const envelope: WebSocketToolEnvelope = { type: "reply", reply };
      socket.send(JSON.stringify(envelope));
    },
  };
}
