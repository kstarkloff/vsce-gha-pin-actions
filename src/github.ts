import * as vscode from "vscode";

const log = vscode.window.createOutputChannel("Pin GitHub Actions");

export interface ActionRef {
  owner: string;
  repo: string;
  ref: string; // e.g. "v4", "v4.1.0", a SHA
}

export interface ResolvedAction {
  sha: string;
  tagName: string | null; // the human-readable tag, e.g. "v4.1.0"
}

// ── Token ────────────────────────────────────────────────────────────────────

let _token: string | undefined;

export async function getToken(): Promise<string | undefined> {
  if (_token) return _token;
  try {
    const session = await vscode.authentication.getSession(
      "github",
      ["repo", "read:org"],
      { createIfNone: false }
    );
    _token = session?.accessToken;
    return _token;
  } catch {
    return undefined;
  }
}

export function clearToken() {
  _token = undefined;
}

// ── GitHub REST helper ────────────────────────────────────────────────────────

async function ghFetch(path: string): Promise<unknown> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vscode-gha-pin-actions",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  log.appendLine(`→ GET https://api.github.com${path}`);
  const resp = await fetch(`https://api.github.com${path}`, { headers });
  log.appendLine(`← ${resp.status} ${resp.statusText}`);

  if (resp.status === 401 || resp.status === 403) {
    clearToken();
    throw new Error(`GitHub API auth error (${resp.status}). Check your token.`);
  }
  if (!resp.ok) {
    throw new Error(`GitHub API error ${resp.status} for ${path}`);
  }
  const body = await resp.json();
  log.appendLine(`   ${JSON.stringify(body)}`);
  return body;
}

// ── Tag listing ──────────────────────────────────────────────────────────────

export interface TagInfo {
  name: string;
  sha: string;
}

export async function fetchTags(owner: string, repo: string): Promise<TagInfo[]> {
  const data = await ghFetch(
    `/repos/${owner}/${repo}/tags?per_page=50`
  ) as Array<{ name: string; commit: { sha: string } }>;
  return data.map((t) => ({ name: t.name, sha: t.commit.sha }));
}

// ── SHA resolution ────────────────────────────────────────────────────────────

/**
 * Returns true when str looks like a full 40-char SHA (already pinned)
 * or a 7-char short SHA.
 */
export function isSha(str: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(str);
}

/**
 * Resolve owner/repo@ref → { sha, tagName }
 *
 * Strategy:
 *   1. Try GET /repos/{owner}/{repo}/git/ref/tags/{ref}  (exact tag)
 *   2. Try GET /repos/{owner}/{repo}/commits/{ref}       (branch, semver, SHA)
 *   3. For annotated tags, follow the peeled object to the commit SHA.
 */
export async function resolveSha(action: ActionRef): Promise<ResolvedAction> {
  const { owner, repo, ref } = action;

  // Already a full SHA → nothing to do
  if (isSha(ref) && ref.length === 40) {
    log.appendLine(`${owner}/${repo}@${ref} — already pinned, skipping`);
    return { sha: ref, tagName: null };
  }

  log.show(true);
  log.appendLine(`resolving ${owner}/${repo}@${ref}`);

  // 1. Try tag ref first (most common case: uses: actions/checkout@v4)
  try {
    const tagData = await ghFetch(
      `/repos/${owner}/${repo}/git/ref/tags/${ref}`
    ) as { object: { type: string; sha: string; url: string } };

    let sha = tagData.object.sha;

    // Annotated tags point to a tag object, not a commit → peel it
    if (tagData.object.type === "tag") {
      const tagObj = await ghFetch(tagData.object.url.replace("https://api.github.com", "")) as { object: { sha: string } };
      sha = tagObj.object.sha;
    }

    log.appendLine(`✓ ${owner}/${repo}@${ref} → ${sha} (tag)`);
    return { sha, tagName: ref };
  } catch {
    // not a tag — fall through
  }

  // 2. Try commit (works for branches and SHAs too)
  const commitData = await ghFetch(
    `/repos/${owner}/${repo}/commits/${ref}`
  ) as { sha: string };

  log.appendLine(`✓ ${owner}/${repo}@${ref} → ${commitData.sha} (commit)`);
  return { sha: commitData.sha, tagName: ref };
}

// ── Batch helper with cache ───────────────────────────────────────────────────

const cache = new Map<string, Promise<ResolvedAction>>();

export function resolveShaCached(action: ActionRef): Promise<ResolvedAction> {
  const key = `${action.owner}/${action.repo}@${action.ref}`;
  if (!cache.has(key)) {
    cache.set(key, resolveSha(action));
  }
  return cache.get(key)!;
}

export function clearCache() {
  cache.clear();
}
