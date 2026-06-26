import { Icon } from "@shared/ui/Icon";
import { fileKindForName } from "../../../FileTreeView/utils";
import type { FileResultRowProps } from "../../types";
import { dirOfPath, fileSearchResultStyle, iconForFileKind } from "../../utils";

function FileResultRow({
  match,
  selected,
  onClick,
}: FileResultRowProps) {
  const kind = fileKindForName(match.filename);
  const dir = dirOfPath(match.path);

  return (
    <button
      className="mdbc-file-search-file-result mdbc-file-search-file-result-state"
      type="button"
      onClick={onClick}
      style={fileSearchResultStyle(selected, "--mdbc-file-search-file-bg")}
      data-testid="file-search-row"
    >
      <Icon name={iconForFileKind(kind)} size={14} />
      <span className="mdbc-file-search-result-title">{match.filename}</span>
      {dir && (
        <span className="mdbc-file-search-result-path">
          {dir}
        </span>
      )}
    </button>
  );
}

export { FileResultRow };
