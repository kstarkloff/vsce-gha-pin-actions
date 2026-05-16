import * as vscode from "vscode";
import { parseWorkflow, UsesMatch } from "./parser";
import { resolveShaCached, isSha, getToken, clearCache, clearToken } from "./github";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isWorkflowFile(uri: vscode.Uri): boolean {
  return /\.github[\\/]workflows[\\/][^/\\]+\.ya?ml$/i.test(uri.fsPath);
}

function shouldAddComment(): boolean {
  return vscode.workspace
    .getConfiguration("gha-pin-actions")
    .get<boolean>("addVersionComment", true);
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

const diagnosticCollection =
  vscode.languages.createDiagnosticCollection("gha-pin-actions");

async function refreshDiagnostics(doc: vscode.TextDocument): Promise<void> {
  if (!isWorkflowFile(doc.uri)) {
    diagnosticCollection.delete(doc.uri);
    return;
  }

  const matches = parseWorkflow(doc.getText());
  const unpinned = matches.filter((m) => !isSha(m.ref) || m.ref.length < 40);

  const diagnostics: vscode.Diagnostic[] = unpinned.map((m) => {
    const range = new vscode.Range(
      m.line, m.valueStart,
      m.line, m.valueEnd
    );
    const diag = new vscode.Diagnostic(
      range,
      `Action "${m.nameWithOwner}@${m.ref}" is not pinned to a full commit SHA. ` +
        `Run "Pin Actions to SHA" to fix.`,
      vscode.DiagnosticSeverity.Warning
    );
    diag.code = "unpinned-action";
    diag.source = "Pin GitHub Actions";
    return diag;
  });

  diagnosticCollection.set(doc.uri, diagnostics);
}

// ── Hover provider ────────────────────────────────────────────────────────────

async function provideHover(
  doc: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Hover | undefined> {
  if (!isWorkflowFile(doc.uri)) return;

  const matches = parseWorkflow(doc.getText());
  const match = matches.find(
    (m) =>
      m.line === position.line &&
      position.character >= m.valueStart &&
      position.character <= m.valueEnd
  );
  if (!match) return;

  const range = new vscode.Range(
    match.line, match.valueStart,
    match.line, match.valueEnd
  );

  if (isSha(match.ref) && match.ref.length === 40) {
    const md = new vscode.MarkdownString(
      `$(lock) **Already pinned**\n\n` +
        `\`${match.nameWithOwner}@${match.ref}\``
    );
    md.supportThemeIcons = true;
    return new vscode.Hover(md, range);
  }

  // Show a loading hover, then resolve async
  try {
    await ensureToken();
    const resolved = await resolveShaCached({
      owner: match.owner,
      repo: match.repo,
      ref: match.ref,
    });

    const pinnedLine =
      `${match.nameWithOwner}@${resolved.sha}` +
      (shouldAddComment() && resolved.tagName ? ` # ${resolved.tagName}` : "");

    const md = new vscode.MarkdownString(
      `$(pin) **Pin GitHub Action**\n\n` +
        `Current ref: \`${match.ref}\`\n\n` +
        `Resolved SHA:\n\`\`\`\n${pinnedLine}\n\`\`\``
    );
    md.supportThemeIcons = true;
    return new vscode.Hover(md, range);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new vscode.Hover(
      new vscode.MarkdownString(`$(warning) Could not resolve SHA: ${msg}`),
      range
    );
  }
}

// ── Pin logic ─────────────────────────────────────────────────────────────────

async function pinDocument(doc: vscode.TextDocument): Promise<void> {
  const matches = parseWorkflow(doc.getText());
  const unpinned = matches.filter((m) => !isSha(m.ref) || m.ref.length < 40);

  if (unpinned.length === 0) {
    vscode.window.showInformationMessage("All actions are already pinned!");
    return;
  }

  await ensureToken();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Pinning GitHub Actions…",
      cancellable: false,
    },
    async (progress) => {
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === doc.uri.toString()
      );

      // Resolve all SHAs in parallel
      const resolved = await Promise.allSettled(
        unpinned.map((m) =>
          resolveShaCached({ owner: m.owner, repo: m.repo, ref: m.ref }).then(
            (r) => ({ match: m, result: r })
          )
        )
      );

      progress.report({ message: "Applying edits…" });

      // Apply edits from bottom to top so line numbers stay valid
      const edits: Array<{ match: UsesMatch; sha: string; tagName: string | null }> = [];
      for (const r of resolved) {
        if (r.status === "fulfilled") {
          edits.push({
            match: r.value.match,
            sha: r.value.result.sha,
            tagName: r.value.result.tagName,
          });
        } else {
          const anyR = r as PromiseRejectedResult;
          vscode.window.showWarningMessage(`Could not resolve: ${anyR.reason}`);
        }
      }

      if (editor) {
        await editor.edit((eb) => {
          for (const { match, sha, tagName } of edits) {
            const newRef =
              `${match.nameWithOwner}@${sha}` +
              (shouldAddComment() && tagName ? ` # ${tagName}` : "");

            // Replace from valueStart to end of line (drops old comment too)
            const lineText = doc.lineAt(match.line).text;
            const endOfValue = lineText.length;
            eb.replace(
              new vscode.Range(match.line, match.valueStart, match.line, endOfValue),
              newRef
            );
          }
        });
      } else {
        // File not open in editor — write via WorkspaceEdit
        const we = new vscode.WorkspaceEdit();
        const text = doc.getText();
        const lines = text.split(/\r?\n/);
        for (const { match, sha, tagName } of edits) {
          const newRef =
            `${match.nameWithOwner}@${sha}` +
            (shouldAddComment() && tagName ? ` # ${tagName}` : "");
          const endOfValue = lines[match.line].length;
          we.replace(
            doc.uri,
            new vscode.Range(match.line, match.valueStart, match.line, endOfValue),
            newRef
          );
        }
        await vscode.workspace.applyEdit(we);
      }

      vscode.window.showInformationMessage(
        `Pinned ${edits.length} action(s) in ${doc.fileName.split(/[\\/]/).pop()}.`
      );
      await refreshDiagnostics(doc);
    }
  );
}

// ── Token guard ───────────────────────────────────────────────────────────────

async function ensureToken(): Promise<void> {
  const token = await getToken();
  if (!token) {
    const choice = await vscode.window.showWarningMessage(
      "Pin GitHub Actions needs a GitHub account to call the API.",
      "Sign in with GitHub"
    );
    if (choice === "Sign in with GitHub") {
      await vscode.authentication.getSession("github", ["repo", "read:org"], {
        createIfNone: true,
      });
    }
  }
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Diagnostics on open / change
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) =>
      refreshDiagnostics(e.document)
    ),
    vscode.workspace.onDidCloseTextDocument((doc) =>
      diagnosticCollection.delete(doc.uri)
    )
  );

  // Run on already-open editors
  vscode.workspace.textDocuments.forEach(refreshDiagnostics);

  // Clear cache when auth changes
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === "github") {
        clearToken();
        clearCache();
      }
    })
  );

  // Hover provider (only for YAML)
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: "yaml", scheme: "file" },
      { provideHover }
    )
  );

  // Command: pin current file
  context.subscriptions.push(
    vscode.commands.registerCommand("gha-pin-actions.pinFile", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || !isWorkflowFile(doc.uri)) {
        vscode.window.showWarningMessage(
          "Open a GitHub Actions workflow file (.github/workflows/*.yml) first."
        );
        return;
      }
      clearCache();
      await pinDocument(doc);
    })
  );

  // Command: pin all workflow files in workspace
  context.subscriptions.push(
    vscode.commands.registerCommand("gha-pin-actions.pinAll", async () => {
      const files = await vscode.workspace.findFiles(
        "**/.github/workflows/*.{yml,yaml}"
      );
      if (files.length === 0) {
        vscode.window.showInformationMessage("No workflow files found.");
        return;
      }
      clearCache();
      for (const uri of files) {
        const doc = await vscode.workspace.openTextDocument(uri);
        await pinDocument(doc);
        await doc.save();
      }
    })
  );

  context.subscriptions.push(diagnosticCollection);
}

export function deactivate(): void {
  diagnosticCollection.clear();
}
