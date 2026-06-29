# Foundry MCP — Windows-native setup & recovery

Self-contained build living **inside the Foundry instance** on `H:`. No WSL, no
`AppData` binary install. This is the file to read when foundry-mcp "disconnects
again" — it documents every path, the git remotes to re-clone from, and the
exact restart/rebuild steps.

_Last reconciled: 2026-06-23._

---

## Architecture (how it actually runs)

```
Claude Code ──stdio──> frontend (index.bundle.cjs)
                          │  spawns / connects (TCP 127.0.0.1:31414, control)
                          ▼
                       backend (backend.bundle.cjs)   ← holds ALL tool dispatch
                          │  WebSocket server :31415  (namespace /foundry-mcp)
                          ▼
              Foundry module "foundry-mcp-bridge" (connects IN on Foundry load)
```

- **backend** is a singleton: it owns ports **31414** (control), **31415**
  (Foundry WS), **31416** (WebRTC). Frontends come and go; the backend persists.
- **Gotcha 1:** a frontend's stdin-close/SIGTERM runs `backend.cleanup()` which
  **kills the shared backend**. Killing one frontend can take the backend down.
- **Gotcha 2:** the Foundry module connects to the backend **only on page load**
  (no aggressive retry). So the backend must be **up first**, then reload Foundry
  (F5). If you restart the backend, reload Foundry afterward.
- **Gotcha 3:** the WSL/Windows loopback boundary means a backend on Windows
  (`127.0.0.1`) is NOT reachable by a WSL frontend, and vice-versa. Keep it all on
  Windows.

---

## Paths

### Foundry (DO NOT touch / the only thing kept)

- App: `H:\FoundryVTT\App\Foundry Virtual Tabletop.exe`
- Data root: `H:\FoundryVTT\Data` (Foundry `dataPath` = `..`)
- Config: `H:\FoundryVTT\Config\options.json` (web UI on port **30000**)
- User data/modules/worlds also surface under `H:\OneDrive\8) Hobbies & Games\FoundryVTT\` (OneDrive-synced).

### foundry-mcp server (the running MCP) — self-contained

- Home: `H:\FoundryVTT\Integrations\foundry-vtt-mcp` (git clone, v0.8.2)
- Frontend entry: `…\packages\mcp-server\dist\index.bundle.cjs`
- Backend bundle: `…\packages\mcp-server\dist\backend.bundle.cjs`
- Our added tool: `…\packages\mcp-server\src\tools\ddb-importer.ts`
  (+ 4 edits in `…\src\backend.ts`)
- Git remote: `https://github.com/adambdooley/foundry-vtt-mcp.git`

### Foundry-side module (lives in Foundry Data)

- `H:\FoundryVTT\Data\modules\foundry-mcp-bridge\` (dist deployed; v0.7.0 + our
  `importDDBCharacter` handler in `dist/data-access.js` + `dist/queries.js`)

### ddb-bridge (separate project: DnD Beyond proxy + its own MCP)

- Repo: `H:\GitHub\ddb-bridge` (git: `StuartJAtkinson/foundry-vtt-ddb-bridge`)
- Proxy: Docker container, host port **31417** (`proxy/.env` holds `DDB_COBALT`)
- MCP entry: `H:\GitHub\ddb-bridge\mcp\dist\index.js`
- Registered at Claude user scope with `DDB_BRIDGE_URL=http://localhost:31417`.

### Toolchain / runtime

- Node (build + run): `C:\Users\Stuart\AppData\Local\nvm\v20.20.2\node.exe`
  (nvm4w; `nvm use 20.20.2`). v0.8.2 has **no native deps**, so any Win node ≥18 works.
- Claude Code MCP config: `C:\Users\Stuart\.claude.json` (two `foundry-mcp` blocks,
  both point at the path above with env `FOUNDRY_PORT=31415`,
  `FOUNDRY_NAMESPACE=/foundry-mcp`, `FOUNDRY_CONNECTION_TYPE=websocket`).

### Removed (gone on purpose — re-cloneable)

- `C:\Users\Stuart\AppData\Local\FoundryMCPServer\` — binary install + ComfyUI
  (~17 GB). Uninstalled via its `Uninstall.exe /S`. **ComfyUI map-generation no
  longer available** until ComfyUI is reinstalled separately.
- `\\wsl$\Ubuntu\home\stuart\.local\share\foundry-vtt-mcp` — WSL copy (~447 MB).
- hermes agent (`~/.hermes/config.yaml`) had a `foundry-vtt` MCP entry launching
  the WSL copy — now commented out (backup: `config.yaml.bak.predocling_*`).

---

## Restart the backend (most common fix)

PowerShell:

```powershell
$node="C:\Users\Stuart\AppData\Local\nvm\v20.20.2\node.exe"
$be="H:\FoundryVTT\Integrations\foundry-vtt-mcp\packages\mcp-server\dist\backend.bundle.cjs"
# clear any stale singleton lock
Remove-Item (Join-Path $env:TEMP 'foundry-mcp-backend.lock') -Force -ErrorAction SilentlyContinue
$env:FOUNDRY_PORT="31415"; $env:FOUNDRY_NAMESPACE="/foundry-mcp"; $env:FOUNDRY_CONNECTION_TYPE="websocket"
Start-Process $node -ArgumentList "`"$be`"" -WindowStyle Hidden
# then RELOAD Foundry (F5) so the module reconnects
```

Verify it's listening + serving the tool:

```powershell
Get-NetTCPConnection -LocalPort 31414,31415 -State Listen
```

(Normally you don't start it by hand — Claude Code's frontend spawns it on
connect. Manual start is only for when you want it up before a Foundry reload.)

## Rebuild from scratch (after `git pull`, or on a new machine)

```powershell
cd H:\FoundryVTT\Integrations\foundry-vtt-mcp
nvm use 20.20.2
npm install
npm -w @foundry-mcp/shared run build
cd packages\mcp-server
npm run build:bundle      # produces dist\index.bundle.cjs + dist\backend.bundle.cjs
```

Re-apply the DDB tool if starting from a fresh clone: copy `src/tools/ddb-importer.ts`
and add to `src/backend.ts` (a) import, (b) `new DDBImporterTools(...)`,
(c) `...ddbImporterTools.getToolDefinitions()`, (d) a `case 'import-ddb-character'`.

## Import a D&D Beyond character

Tool `import-ddb-character` (arg `characterId`) → calls ddb-importer's
`importCharacterById`. Requires: ddb-importer module active in Foundry AND a valid
**CobaltSession in ddb-importer's own settings** (separate from `proxy/.env`).
