import { SearchInput } from "@shared/ui";
import { useFileSearchPopover } from "./hooks";
import { ContentResultRow } from "./components/ContentResultRow";
import { FileResultRow } from "./components/FileResultRow";
import { fileSearchTabStyle } from "./utils";

function FileSearchPopover() {
  const popover = useFileSearchPopover();

  if (!popover.open) return null;

  return (
    <div
      className="mdbc-file-search-overlay"
      onClick={popover.onClickBackdrop}
      data-testid="file-search-backdrop"
    >
      <div
        className="mdbc-file-search-dialog"
        onKeyDown={popover.onKeyDownDialog}
        data-testid="file-search-dialog"
      >
        <div className="mdbc-file-search-tabs">
          <button
            className="mdbc-file-search-tab mdbc-file-search-tab-state"
            type="button"
            onClick={popover.onClickFileMode}
            style={fileSearchTabStyle(popover.mode === "file")}
          >
            Files
          </button>
          <button
            className="mdbc-file-search-tab mdbc-file-search-tab-state"
            type="button"
            onClick={popover.onClickContentMode}
            style={fileSearchTabStyle(popover.mode === "content")}
          >
            Content
          </button>
        </div>

        <SearchInput
          inputRef={popover.inputRef}
          placeholder={popover.mode === "file" ? "Search files by name..." : "Search file contents..."}
          value={popover.query}
          onChange={popover.onChange}
          testId="file-search-input"
        />

        <div
          className="mdbc-file-search-results"
          ref={popover.listRef}
          data-testid="file-search-results"
        >
          {popover.loading && popover.results.length === 0 && (
            <div className="mdbc-file-search-empty">
              Searching...
            </div>
          )}
          {!popover.loading && popover.query && popover.results.length === 0 && (
            <div className="mdbc-file-search-empty">
              No results
            </div>
          )}
          {popover.mode === "file"
            ? popover.fileResults.map((match, index) => (
                <FileResultRow
                  key={match.path}
                  match={match}
                  selected={index === popover.selectedIndex}
                  onClick={() => popover.onClickFileResult(index)}
                />
              ))
            : popover.contentResults.map((match, index) => (
                <ContentResultRow
                  key={`${match.path}:${match.lineNum}:${index}`}
                  match={match}
                  selected={index === popover.selectedIndex}
                  onClick={() => popover.onClickContentResult(index)}
                />
              ))}
        </div>

        <div className="mdbc-file-search-footer">
          <span>Tab to switch mode</span>
          <span>Open &#x23CE;</span>
        </div>
      </div>
    </div>
  );
}

export { FileSearchPopover };
