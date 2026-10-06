# minecraft-rcon-mcp

*[Українською](README.uk.md)*

An MCP server that lets an AI assistant (Claude, Cursor, etc.) control a
live Minecraft server over [RCON](https://minecraft.wiki/w/RCON) — list
players, broadcast chat, teleport, give items, change weather/time, kick,
or run any raw vanilla/plugin command — instead of you typing it into the
server console yourself.

## Why this exists

Most MCP servers give an AI assistant access to *code* — a filesystem, a
language, a build system. This one gives it access to a running *game
world*: a genuinely different, much less common category of MCP tool, and
a fun one to build on top of a protocol (Source RCON) that's small enough
to implement from scratch in a couple hundred lines with zero dependencies
beyond the MCP SDK itself.

## Installation

```bash
git clone https://github.com/Faneraiy14/minecraft-rcon-mcp
cd minecraft-rcon-mcp
npm install
```

Requires a Minecraft server (vanilla or Paper/Spigot — anything that
speaks the Source RCON protocol) with RCON enabled. In its
`server.properties`:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=<a real password — do not leave this blank>
```

## Connecting (Claude Desktop / Claude Code)

```bash
claude mcp add minecraft-rcon-mcp -- node /absolute/path/to/minecraft-rcon-mcp/src/server.js \
  -e MC_RCON_HOST=127.0.0.1 \
  -e MC_RCON_PORT=25575 \
  -e MC_RCON_PASSWORD=<the same password from server.properties>
```

`MC_RCON_HOST` defaults to `127.0.0.1`, `MC_RCON_PORT` to `25575` if
omitted — only `MC_RCON_PASSWORD` is required. The password is read from
the environment only, never accepted as a tool argument — an MCP tool
argument comes from (or at least passes through) the AI's own context, and
a long-lived secret has no business living there when the environment can
hold it instead.

## Tools

| Tool | What it does |
|---|---|
| `mc_command` | Runs any raw vanilla/plugin command (no leading `/` needed) — the escape hatch for everything the tools below don't cover |
| `mc_list_players` | Who's online right now (`/list`) |
| `mc_say` | Broadcasts a chat message from the server (`/say`) |
| `mc_teleport` | Teleports a player/selector to coordinates or another entity (`/tp`) |
| `mc_give` | Gives a player an item (`/give`) |
| `mc_set_weather` | Sets weather to clear/rain/thunder, optionally for a duration (`/weather`) |
| `mc_set_time` | Sets the game time by tick count or keyword like `day`/`night` (`/time set`) |
| `mc_kick` | Disconnects a player, optionally with a reason shown to them (`/kick`) |

Every tool returns `{ success, command, output }` on a successful RCON
round-trip — `success: true` means the *request reached the server and it
replied*, not that the command necessarily did what you intended
semantically. `output` is the server's own response text (e.g. `"No
player was found"` for a `/give` targeting someone offline) — the AI reads
that to know what actually happened, the same way a human reading the
server console would.

## How the RCON client works

[Source RCON](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
is a small binary TCP protocol — `src/rcon.js` implements it directly, no
dependency:

- **Packet framing**: `[int32 length][int32 requestId][int32 type][payload][0x00][0x00]`,
  all little-endian. `length` doesn't include itself.
- **Auth** (`SERVERDATA_AUTH`, type 3): send the password; the server
  replies with `SERVERDATA_AUTH_RESPONSE` (type 2) carrying the SAME
  request ID on success, or `requestId: -1` on a wrong password — that's
  the *only* signal that auth failed, there's no error message field.
- **Fragmented responses**: nothing in the protocol marks "this is the
  last packet of the response" — a long `/list` or `/help` output can
  legitimately arrive as several `SERVERDATA_RESPONSE_VALUE` packets. The
  standard trick, used here: right after the real command, send a
  *second*, empty `SERVERDATA_EXECCOMMAND` packet with the next request
  ID. Minecraft doesn't recognize an empty command, but still echoes an
  empty `SERVERDATA_RESPONSE_VALUE` back with that packet's own request
  ID — and because responses come back in order, seeing *that* ID is a
  reliable "everything before this belonged to the real command" marker.
- A real, live bug this caught: the first version matched incoming
  packets against pending requests using only `requestId`, and never
  checked the *terminator's* ID — the terminator packet's `_handlePacket`
  call fell into a dead branch, so every command call silently hung until
  its own timeout, even though the real server response had already
  arrived correctly. Found by running the client against an actual live
  Paper server (not a mock) rather than assuming the protocol
  implementation was right because it looked right, and fixed by checking
  `p.terminatorId` first.
- Each MCP tool call opens a fresh connection, authenticates, runs one
  command, and closes — Minecraft's RCON is meant for short admin
  connections, not a persistent session (there's no equivalent to
  NyxilumMcp's REPL tools here for that reason).

## Tests

```bash
MC_RCON_HOST=127.0.0.1 MC_RCON_PORT=25575 MC_RCON_PASSWORD=<password> npm test
```

21 checks across `config.mjs` (env-var validation — no server needed),
`rcon.mjs` (the protocol client against a REAL running server: `list`
returns real output, an unknown command returns the server's own error
text rather than throwing, a wrong password gives `RconAuthError` rather
than hanging, an unreachable port fails cleanly, three sequential
commands on one connection don't cross-talk — the exact scenario that
would have caught the terminator-ID bug above), `tools.mjs` (the same
through the tool handlers, including that a wrong password comes back as
`{ success: false, isAuthError: true }` rather than throwing — this one
caught a second real bug: custom `Error` subclasses in JS don't set
`.name` to the subclass name automatically, so the original
`err.name === 'RconAuthError'` check silently never matched; fixed by
setting `this.name = this.constructor.name` in the base error class and
switching the check to `instanceof`), and `transport.mjs` — the same
things again through the real MCP protocol (`StdioClientTransport` +
`Client`), not just direct function calls.

Every test that needs a live server is skipped (not failed) when
`MC_RCON_HOST`/`MC_RCON_PORT`/`MC_RCON_PASSWORD` aren't set — CI doesn't
have a Minecraft server sitting around, and this shouldn't block on one.

## Security

- The RCON password lives in the environment only (see Connecting above)
  — never accepted as a tool input, never logged.
- `mc_command` runs whatever string it's given, with no allowlist —
  that's the deliberate design of this tool specifically (an admin
  console for a game world you own), not an oversight. If you want an AI
  assistant to have LESS power over your server than a full admin
  console, don't connect this tool to it, or wrap `mc_command` behind
  your own MCP proxy that filters commands before they reach here.
- Every RCON call has a timeout (default 10s, configurable per call via
  `timeout_ms`, capped at 30s) so a server that stops responding mid-command
  doesn't hang the calling tool forever.

## Docker

```bash
docker build -t minecraft-rcon-mcp .
docker run -i --rm -e MC_RCON_HOST=<host> -e MC_RCON_PORT=25575 -e MC_RCON_PASSWORD=<password> minecraft-rcon-mcp
```

The server speaks MCP over stdio, so keep `-i`. Needs: the `MC_RCON_*` variables of your server.
In an MCP client config use `"command": "docker"` with the same arguments.

## Startup timeout

The server itself starts in about a second, but a client launching several MCP servers at once on a cold machine (right after boot) can hit Claude Code's default 30-second startup limit and mark it "failed". That limit belongs to the client, not to the server, so raise it there - in `~/.claude/settings.json`:

```json
{ "env": { "MCP_TIMEOUT": "120000" } }
```

(or start Claude Code as `MCP_TIMEOUT=120000 claude`). Takes effect in the next session.

## License

MIT
