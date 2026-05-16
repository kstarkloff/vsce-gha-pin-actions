# Pin GitHub Actions — VS Code Extension

Pins GitHub Actions in your workflow files to immutable full-length commit SHAs — no extra CLI tools required.

## Features

### ⚠️ Inline Warnings

Any `uses:` line that is not pinned to a full SHA shows a yellow warning squiggle. The **Problems** panel lists all unpinned actions in the workspace.

### 🔧 Quick Fix

Click the lightbulb or press `⌘.` (`Ctrl+.`) on a warning squiggle to get two options:

- **Pin to commit SHA** — resolves the current tag (e.g. `v4`) to its full SHA and replaces it in place.
- **Pin to version…** — opens a list of all available tags for the action. Pick any version and the corresponding SHA is inserted.

### 🔒 Pin All Actions in File

Pins every unpinned action in the current workflow file at once. Available via:

- The **lock icon** in the editor title bar (visible when a workflow file is open)
- Right-click context menu → **Pin Actions to SHA: Current File**
- Command Palette (`⌘+Shift+P`) → **Pin Actions to SHA: Current File**

### 🔍 Hover Info

Hover over any `uses:` value to see the resolved full SHA fetched live from the GitHub API.

## Authentication

The extension uses VS Code's built-in GitHub authentication — no PAT configuration needed. You will be prompted to sign in on first use.

## Settings

| Setting | Default | Description |
|---|---|---|
| `gha-pin-actions.addVersionComment` | `true` | Adds a `# v4` comment next to the SHA for readability |

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

## VSIX Installation

1. Build the extension package:
   ```bash
   npm run compile
   npx vsce package
   ```
2. In Visual Studio Code, open the Command Palette (`⌘+Shift+P` / `Ctrl+Shift+P`).
3. Run `Extensions: Install from VSIX...`.
4. Select the generated `.vsix` file from your project folder.
5. Reload VS Code if prompted.
