/**
 * Represents a single `uses:` reference found in a workflow file.
 */
export interface UsesMatch {
  /** 0-based line index */
  line: number;
  /** Character offset where `uses:` value starts */
  valueStart: number;
  /** Character offset where `uses:` value ends (exclusive) */
  valueEnd: number;
  /** Full value, e.g. "actions/checkout@v4" or "actions/checkout@abc1234 # v4" */
  rawValue: string;
  /** "actions/checkout" */
  nameWithOwner: string;
  /** owner part */
  owner: string;
  /** repo part */
  repo: string;
  /** ref part: "v4", "abc1234", etc. */
  ref: string;
  /** Inline comment, e.g. "# v4" — undefined if absent */
  existingComment: string | undefined;
}

/**
 * Regex that matches a `uses:` line in a GitHub Actions workflow.
 *
 * Captures:
 *   1. leading whitespace + "uses:" + optional space
 *   2. owner/repo
 *   3. ref (everything after @, before optional comment)
 *   4. optional inline comment (e.g. "# v4")
 *
 * Intentionally does NOT match `uses: ./.github/actions/local` (local actions).
 * Also skips `uses: docker://` references.
 */
const USES_RE =
  /^(?<indent>\s+uses:\s+)(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)@(?<ref>[^\s#]+)(?<comment>\s+#[^\r\n]*)?/;

export function parseWorkflow(text: string): UsesMatch[] {
  const lines = text.split(/\r?\n/);
  const results: UsesMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = USES_RE.exec(line);
    if (!m || !m.groups) continue;

    const { indent, owner, repo, ref, comment } = m.groups;

    // valueStart = length of the indent prefix ("    uses: ")
    const valueStart = indent.length;
    // valueEnd covers owner/repo@ref (NOT the comment)
    const valueEnd = valueStart + owner.length + 1 + repo.length + 1 + ref.length;

    results.push({
      line: i,
      valueStart,
      valueEnd,
      rawValue: line.slice(valueStart),
      nameWithOwner: `${owner}/${repo}`,
      owner,
      repo,
      ref,
      existingComment: comment?.trim(),
    });
  }

  return results;
}
