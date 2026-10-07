# Web agent transport

The editor's DAPI handlers are transport-independent.

Desktop keeps using the existing Electron IPC wire. Browser and mobile shells
can attach a different transport through `attachToolTransport` without changing
the timeline, media handlers, or editor engine.

## WebSocket relay

`createWebSocketToolTransport(socket)` adapts an already-authenticated
WebSocket to the DAPI wire.

The relay uses three JSON envelopes:

```json
{ "type": "call", "call": { "id": "...", "tool": "...", "args": {} } }
{ "type": "cancel", "cancel": { "id": "..." } }
{ "type": "reply", "reply": { "id": "...", "ok": true, "data": {} } }
```

The browser transport does not perform authentication or MCP schema validation.
Those belong at the hosted relay/MCP boundary before a call reaches the editor.

This keeps the security boundary explicit:

```text
Codex Cloud
    ↓
hosted MCP + authenticated relay
    ↓
WebSocket DAPI transport
    ↓
existing Diffusion Studio handlers
    ↓
editor session / timeline / media engine
```

The editor session is now published in browser builds as well as desktop builds,
so a web shell can attach the relay while reusing the same handler catalog.
