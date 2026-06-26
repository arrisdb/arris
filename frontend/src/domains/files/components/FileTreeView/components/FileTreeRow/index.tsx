import type { CSSProperties } from "react";
import { Icon, iconForFileName } from "@shared/ui/Icon";
import {
  useFileTreeInlineCreateRow,
  useFileTreeInlineRename,
  useFileTreeRow,
} from "../../hooks";
import type {
  FileTreeGlyphProps,
  FileTreeInlineCreateRowProps,
  FileTreeInlineRenameProps,
  FileTreeRowProps,
} from "../../types";
import { fileGlyphKind, gitStatusColor } from "../../utils";

function FileTreeGlyph({ node }: FileTreeGlyphProps) {
  if (node.isDir) {
    return (
      <span className="mdbc-file-icon folder" aria-hidden="true">
        <Icon name="folder" size={14} />
      </span>
    );
  }

  return (
    <span className={`mdbc-file-icon file ${fileGlyphKind(node.name)}`} aria-hidden="true">
      <Icon name={iconForFileName(node.name)} size={14} />
    </span>
  );
}

function FileTreeInlineCreateRow({ dirPath, depth }: FileTreeInlineCreateRowProps) {
  const create = useFileTreeInlineCreateRow(dirPath);

  if (!create.visible) return null;

  return (
    <div
      className="mdbc-file-row mdbc-file-tree-row-indent"
      data-testid="inline-create-row"
    >
      {Array.from({ length: depth }, (_, index) => (
        <span key={index} className="mdbc-indent-guide" aria-hidden="true" />
      ))}
      <span className={`mdbc-file-icon ${create.isFolder ? "folder" : "file default"}`} aria-hidden="true">
        <Icon name={create.isFolder ? "folder" : "fileText"} size={14} />
      </span>
      <input
        ref={create.inputRef}
        className="mdbc-inline-rename"
        data-testid="inline-create-input"
        placeholder={create.placeholder}
        onClick={create.onClickCreateInput}
        onKeyDown={create.onKeyDownCreate}
        onBlur={create.onBlurCreate}
      />
    </div>
  );
}

function FileTreeInlineRename({ path, currentName }: FileTreeInlineRenameProps) {
  const rename = useFileTreeInlineRename(path, currentName);

  return (
    <input
      ref={rename.inputRef}
      className="mdbc-inline-rename"
      defaultValue={currentName}
      data-testid="inline-rename-input"
      onClick={rename.onClickRenameInput}
      onKeyDown={rename.onKeyDownRename}
      onBlur={rename.onBlurRename}
    />
  );
}

function FileTreeRow({
  node,
  depth,
  statusMap,
  onContextMenu,
}: FileTreeRowProps) {
  const row = useFileTreeRow(node, statusMap);

  return (
    <>
      <button
        type="button"
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onClick={row.onClickRow}
        onPointerDown={row.onPointerDownRow}
        onContextMenu={(event) => onContextMenu(event, node)}
        data-testid={`file-tree-row-${node.path}`}
        data-tree-row=""
        data-path={node.path}
        data-isdir={String(node.isDir)}
        className={row.rowClassName}
        style={row.rowStyle}
        title={node.path}
      >
        {Array.from({ length: depth }, (_, index) => (
          <span key={index} className="mdbc-indent-guide" aria-hidden="true" />
        ))}
        <FileTreeGlyph node={node} expanded={row.expanded} />
        {row.isRenaming ? (
          <FileTreeInlineRename path={node.path} currentName={node.name} />
        ) : (
          <span
            className="mdbc-file-name mdbc-file-tree-name-status-color"
            style={{ "--mdbc-file-tree-name-status-color": gitStatusColor(row.gitStatus) } as CSSProperties}
          >
            {node.name}
          </span>
        )}
      </button>
      {node.isDir && row.expanded && (
        <>
          <FileTreeInlineCreateRow dirPath={node.path} depth={depth + 1} />
          {node.children.map((child) => (
            <FileTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              statusMap={statusMap}
              onContextMenu={onContextMenu}
            />
          ))}
        </>
      )}
    </>
  );
}

export { FileTreeRow };
