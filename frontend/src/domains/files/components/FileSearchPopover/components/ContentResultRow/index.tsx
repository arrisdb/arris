import { Icon } from "@shared/ui/Icon";
import { fileKindForName } from "../../../FileTreeView/utils";
import type { ContentResultRowProps } from "../../types";
import { fileSearchResultStyle, iconForFileKind } from "../../utils";

function ContentResultRow({
  match,
  selected,
  onClick,
}: ContentResultRowProps) {
  const kind = fileKindForName(match.filename);
  const before = match.lineContent.substring(0, match.matchStart);
  const highlighted = match.lineContent.substring(match.matchStart, match.matchEnd);
  const after = match.lineContent.substring(match.matchEnd);

  return (
    <button
      className="mdbc-file-search-content-result mdbc-file-search-content-result-state"
      type="button"
      onClick={onClick}
      style={fileSearchResultStyle(selected, "--mdbc-file-search-content-bg")}
      data-testid="content-search-row"
    >
      <div className="mdbc-file-search-match-row">
        <Icon name={iconForFileKind(kind)} size={14} />
        <span className="mdbc-file-search-match-file">{match.filename}</span>
        <span className="mdbc-file-search-match-location">:{match.lineNum}</span>
      </div>
      <div className="mdbc-file-search-match-line">
        {before}
        <mark className="mdbc-file-search-highlight">
          {highlighted}
        </mark>
        {after}
      </div>
    </button>
  );
}

export { ContentResultRow };
