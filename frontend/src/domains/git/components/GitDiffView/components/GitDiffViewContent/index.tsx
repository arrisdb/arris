import { Fragment, useMemo } from "react";
import { pathRelativeToRoot } from "../../../../utils/path";
import type { DiffFileSectionProps, GitDiffViewViewModel } from "../../types";
import { buildSideBySide } from "../../utils";

function DiffFileSection({
  diff,
  repoRoot,
  onToggleCollapse,
}: DiffFileSectionProps) {
  const fileName = diff.path.split("/").pop() ?? diff.path;
  const relPath = pathRelativeToRoot(diff.path, repoRoot);

  const { pairs, sections } = useMemo(
    () => buildSideBySide(diff.hunks),
    [diff.hunks],
  );

  return (
    <div className="git-diff-file" data-testid={`diff-file-${fileName}`}>
      <div
        className="git-diff-file-header"
        onClick={onToggleCollapse}
      >
        <span className="mdbc-git-diff-icon-cell">
          {diff.collapsed ? "▶" : "▼"}
        </span>
        <span className="mdbc-git-diff-file-name">{fileName}</span>
        <span className="mdbc-git-diff-muted-meta">
          {relPath}
        </span>
      </div>

      {!diff.collapsed && (
        diff.hunks.length === 0 ? (
          <div className="git-diff-no-preview" data-testid={`diff-no-preview-${fileName}`}>
            Cannot preview this file type
          </div>
        ) : (
        <div className="git-diff-table-wrap">
          <table className="git-diff-table">
            {/* table-layout is fixed, but the first row is a colSpan separator,
                so widths must come from a colgroup: narrow line-number columns,
                code columns auto-split the rest equally. */}
            <colgroup>
              <col className="git-diff-col-ln" />
              <col className="git-diff-col-code" />
              <col className="git-diff-col-ln" />
              <col className="git-diff-col-code" />
            </colgroup>
            <tbody>
              {sections.map((section, sectionIndex) => {
                const nextStart = sectionIndex < sections.length - 1
                  ? sections[sectionIndex + 1].startIdx
                  : pairs.length;
                const sectionPairs = pairs.slice(section.startIdx, nextStart);
                return (
                  <Fragment key={sectionIndex}>
                    {section.gapBefore > 0 && (
                      <tr className="git-diff-fold">
                        <td colSpan={4}>
                          <span>⋯ {section.gapBefore} unchanged lines ⋯</span>
                        </td>
                      </tr>
                    )}
                    {sectionPairs.map((pair, pairIndex) => (
                      <tr
                        key={section.startIdx + pairIndex}
                        className={`git-diff-row git-diff-${pair.kind}`}
                      >
                        <td className="git-diff-ln">{pair.oldLine ?? ""}</td>
                        <td className="git-diff-code git-diff-old">
                          {pair.kind === "del" || pair.kind === "mod" || pair.kind === "ctx" ? (
                            <pre>{pair.oldText}</pre>
                          ) : (
                            <pre> </pre>
                          )}
                        </td>
                        <td className="git-diff-ln">{pair.newLine ?? ""}</td>
                        <td className="git-diff-code git-diff-new">
                          {pair.kind === "add" || pair.kind === "mod" || pair.kind === "ctx" ? (
                            <pre>{pair.newText}</pre>
                          ) : (
                            <pre> </pre>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        )
      )}
    </div>
  );
}

function GitDiffViewContent({ pane }: { pane: GitDiffViewViewModel }) {
  return (
    <>
      <div className="git-diff-toolbar">
        <span className="mdbc-git-diff-hunk-title">
          Uncommitted Changes
        </span>
        <span className="mdbc-git-diff-muted-meta">
          {pane.fileStatusesCount} file{pane.fileStatusesCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="git-diff-content">
        {pane.loading ? (
          <div className="mdbc-empty">Loading diffs…</div>
        ) : pane.fileDiffs.length === 0 ? (
          <div className="mdbc-empty">No diffs to show.</div>
        ) : (
          pane.fileDiffs.map((diff, index) => (
            <DiffFileSection
              key={diff.path}
              diff={diff}
              repoRoot={pane.repoPath}
              onToggleCollapse={() => pane.onToggleCollapse(index)}
            />
          ))
        )}
      </div>
    </>
  );
}

export {
  DiffFileSection,
  GitDiffViewContent,
};
