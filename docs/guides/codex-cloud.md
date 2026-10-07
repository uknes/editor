# Codex Cloud

Diffusion Studio's MCP server intentionally listens only on loopback at
`http://127.0.0.1:3274/mcp`. Keep it that way.

OpenAI Secure MCP Tunnel can make that private server reachable from supported
OpenAI products, including Codex, without opening an inbound port. The local
`tunnel-client` process connects outbound to OpenAI and forwards MCP requests to
Diffusion Studio.

## Requirements

1. Diffusion Studio desktop is running.
2. Install the latest public `openai/tunnel-client` release.
3. Create a Secure MCP Tunnel in OpenAI Platform and copy its `tunnel_id`.
4. Create a Tunnel runtime API key with the required tunnel permissions.

Do not commit the runtime key. The helper reads it only from the process
environment and passes an `env:` reference to `tunnel-client`, so the key does
not appear in the command line.

## Check the machine

```bash
npm run codex:cloud -- status
```

A healthy local setup reports both `tunnel-client: available` and
`Diffusion MCP: reachable`.

## Diagnose the tunnel

```bash
export CONTROL_PLANE_API_KEY="sk-..."
export CONTROL_PLANE_TUNNEL_ID="tunnel_0123456789abcdef0123456789abcdef"

npm run codex:cloud -- doctor
```

## Connect

```bash
npm run codex:cloud -- run --open-ui
```

The helper keeps the MCP target on loopback by default and refuses remote MCP
URLs unless `--allow-remote-mcp` is explicitly supplied.

Once the tunnel is associated with the Platform organization/workspace used by
Codex, select the tunnel-backed MCP target in the supported Codex surface.

## Security model

- Diffusion Studio remains bound to `127.0.0.1`.
- No inbound firewall port is opened.
- The Tunnel runtime key is not put in argv and is not written by this helper.
- The helper rejects non-loopback MCP targets by default.
- `tunnel-client` makes the outbound HTTPS connection to the OpenAI tunnel
  control plane and forwards requests to the local MCP endpoint.
