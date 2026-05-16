# Pin GitHub Actions — VS Code Extension

Pins GitHub Actions in your workflow files to immutable full-length commit SHAs — no extra CLI tools required.

## Features

### 🔒 Pin Actions (Command Palette / Title Bar Button)
- **"Pin Actions to SHA: Current File"** — pins all unpinned actions in the active workflow file.
- **"Pin Actions to SHA: All Workflow Files"** — pins every `*.yml`/`*.yaml` under `.github/workflows/`.

Both commands are accessible via the Command Palette (`Ctrl+Shift+P`) and the lock icon (🔒) in the editor title bar when a workflow file is open.

### ⚠️ Inline Warnings (Diagnostics)
Any `uses:` line that is not pinned to a full SHA shows a yellow warning squiggle. Hover over it to see the message, or open the **Problems** panel.

### 🔍 Hover Info
Hover over any `uses:` value to see:
- Whether it is already pinned.
- The resolved full SHA (fetched live from GitHub API).

## Authentication
The extension uses VS Code's built-in GitHub authentication — no PAT configuration needed. You will be prompted to sign in on first use.

## Settings

| Setting | Default | Description |
|---|---|---|
| `gha-pin-actions.addVersionComment` | `true` | Add `# v4` comment next to the SHA for readability |

## Example

**Before:**
```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
```

**After:**
```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
- uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4
```

## Development

```bash
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```
