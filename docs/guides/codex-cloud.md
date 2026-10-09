# Codex Cloud

Diffusion Studio keeps its MCP server on loopback at
`http://127.0.0.1:3274/mcp`.

The desktop app can connect that private endpoint to Codex Cloud through
OpenAI Secure MCP Tunnel. The local `tunnel-client` process makes the outbound
connection, so the Diffusion MCP server does not need a public listener.

## Requirements

1. Diffusion Studio desktop is running.
2. Install the latest public `openai/tunnel-client` release and make
   `tunnel-client` available on `PATH`.
3. Create a Secure MCP Tunnel in OpenAI Platform and copy its `tunnel_id`.
4. Create a Tunnel runtime API key with permission to use that tunnel.

## Connect from Diffusion Studio

Open **MCP & CLI → Codex Cloud**, then choose **Connect**.

Enter:

- the `tunnel_id`;
- the Tunnel runtime API key.

The tunnel ID is remembered locally for convenience. The runtime API key is
not persisted by Diffusion Studio; it is passed to the local tunnel process for
the active connection only.

While the tunnel is running, the Codex Cloud row shows the active tunnel and
offers **Disconnect**.

## Security model

- Diffusion MCP remains bound to `127.0.0.1`.
- Diffusion Studio does not open an inbound firewall port.
- The runtime API key is not written to project files or local settings.
- The tunnel process receives the key only through its environment.
- Diffusion Studio stops the tunnel when the app quits.
