import {
  ContextMenu,
} from "@shared/ui/ContextMenu";
import { useFileTreeView } from "./hooks";
import { FileTreeRow } from "./components/FileTreeRow";
import "./index.css";

function FileTreeView() {
  const fileTree = useFileTreeView();

  if (fileTree.isLoading) {
    return <div className="mdbc-empty">Loading folder…</div>;
  }

  if (fileTree.loadError) {
    return (
      <div className="mdbc-empty mdbc-file-tree-error-empty">
        Failed to load folder: {fileTree.loadError}
      </div>
    );
  }

  if (!fileTree.tree) {
    return (
      <div
        className="mdbc-empty mdbc-file-tree-empty-actions"
        data-testid="file-tree-empty"
        onContextMenu={fileTree.onContextMenuEmpty}
      >
        <div>Open a file</div>
        <div className="mdbc-file-tree-empty-button-row">
          <button
            type="button"
            className="mdbc-chip mdbc-file-tree-empty-action-chip"
            onClick={fileTree.onClickOpenFile}
            data-testid="file-tree-open-file"
          >
            File
          </button>
          <button
            type="button"
            className="mdbc-chip mdbc-file-tree-empty-action-chip"
            onClick={fileTree.onClickOpenFolder}
            data-testid="file-tree-open-folder"
          >
            Folder
          </button>
        </div>
        {fileTree.ctxMenu.state && (
          <ContextMenu
            x={fileTree.ctxMenu.state.x}
            y={fileTree.ctxMenu.state.y}
            items={fileTree.contextMenuItems}
            onClose={fileTree.ctxMenu.close}
            data-testid="file-tree-ctx-menu"
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="mdbc-file-tree"
      tabIndex={0}
      onKeyDown={fileTree.onKeyDownTree}
      onContextMenu={fileTree.onContextMenuTree}
      data-testid="file-tree-container"
    >
      <FileTreeRow
        key={fileTree.tree.path}
        node={fileTree.tree}
        depth={0}
        statusMap={fileTree.statusMap}
        onContextMenu={fileTree.onContextMenuRow}
      />
      {fileTree.ctxMenu.state && (
        <ContextMenu
          x={fileTree.ctxMenu.state.x}
          y={fileTree.ctxMenu.state.y}
          items={fileTree.contextMenuItems}
          onClose={fileTree.ctxMenu.close}
          data-testid="file-tree-ctx-menu"
        />
      )}
    </div>
  );
}

export { FileTreeView };
