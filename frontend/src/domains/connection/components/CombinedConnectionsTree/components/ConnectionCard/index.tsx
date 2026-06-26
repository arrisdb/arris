import { useSchemaUiStore } from "../../../../hooks";
import { useMemo, useRef, useState } from "react";
import { DatabaseKindIcon } from "@domains/connection/utils/databaseKindIcon";
import { ContextMenu, useContextMenu } from "@shared/ui/ContextMenu";
import { MultiSelect, SearchInput } from "@shared/ui";
import { Icon, iconForSchemaKind } from "@shared/ui/Icon";
import { Tooltip } from "@shared/ui/Tooltip";
import {
  beginSchemaNodePointerDrag,
  cancelPointerDrag,
  endSchemaNodePointerDrag,
  isQueryDraggableSchemaNode,
  moveSchemaNodePointerDrag,
} from "@domains/editor";
import { driverForKind } from "../../../utils/drivers/registry";
import type { ConnectionCardProps, SchemaNodeRowProps } from "../../types";
import { filterSchemaTree, isDefinitionSupportedKind, isSchemaNodeLoaded } from "../../utils";

function SchemaNodeRow({
  node,
  depth,
  selectedNodeId,
  onSelect,
  onOpenTable,
  onShowDefinition,
  onRefreshSchema,
  forceOpen,
  tableOpenableKinds,
  hideDetailKinds,
}: SchemaNodeRowProps) {
  const [open, setOpen] = useState(depth < 1 || node.path.endsWith("__group__Tables"));
  const isOpen = forceOpen || open;
  const hasChildren = node.children.length > 0;
  const showDetail = !hideDetailKinds.has(node.kind) && Boolean(node.detail);
  const selected = selectedNodeId === node.path;
  const draggable = isQueryDraggableSchemaNode(node);
  const suppressClickRef = useRef(false);
  const menu = useContextMenu<null>();
  const isSchemaLevel = node.kind === "schema" || node.kind === "database";
  const isDefinitionObject = isDefinitionSupportedKind(node.kind);

  return (
    <>
      <div
        className={`mdbc-row mdbc-schema-row ${selected ? "selected" : ""}`}
        onContextMenu={
          isSchemaLevel || isDefinitionObject
            ? (event) => menu.open(event, null)
            : undefined
        }
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onSelect(node.path);
        }}
        onPointerDown={(event) => {
          if (!draggable || event.button !== 0) return;
          beginSchemaNodePointerDrag(node, event.pointerId, event.clientX, event.clientY);
          if (typeof event.currentTarget.setPointerCapture === "function") {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          if (!draggable) return;
          moveSchemaNodePointerDrag(event.pointerId, event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (!draggable) return;
          if (endSchemaNodePointerDrag(event.pointerId, event.clientX, event.clientY)) {
            suppressClickRef.current = true;
          }
          if (typeof event.currentTarget.releasePointerCapture === "function") {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          if (!draggable) return;
          cancelPointerDrag();
          if (typeof event.currentTarget.releasePointerCapture === "function") {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onDoubleClick={(event) => {
          if (tableOpenableKinds.has(node.kind)) {
            event.stopPropagation();
            onOpenTable(node);
          }
        }}
        data-testid={`schema-row-${node.path}`}
      >
        {Array.from({ length: depth }, (_, i) => (
          <span key={i} className="mdbc-tree-guide" />
        ))}
        <span
          className="chev"
          onClick={(event) => {
            if (hasChildren) {
              event.stopPropagation();
              setOpen((value) => !value);
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          data-testid={`chev-${node.path}`}
        >
          {hasChildren && (
            <Icon
              name={isOpen ? "chevronDown" : "chevronRight"}
              size={11}
            />
          )}
        </span>
        <span className="ico">
          <Icon name={iconForSchemaKind(node.kind)} size={12} />
        </span>
        <span className="name">{node.name}</span>
        {showDetail && <span className="meta">{node.detail}</span>}
      </div>
      {menu.state && (isSchemaLevel || isDefinitionObject) && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          onClose={menu.close}
          items={
            isSchemaLevel
              ? [
                  {
                    id: "refreshSchema",
                    label: "Refresh Schema",
                    testId: `refresh-schema-menu-${node.path}`,
                    action: () => onRefreshSchema(node),
                  },
                ]
              : [
                  {
                    id: "showDefinition",
                    label: "Show Definition",
                    testId: `show-definition-menu-${node.path}`,
                    action: () => onShowDefinition(node),
                  },
                ]
          }
        />
      )}
      {isOpen &&
        hasChildren &&
        node.children.map((child) => (
          <SchemaNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            onOpenTable={onOpenTable}
            onShowDefinition={onShowDefinition}
            onRefreshSchema={onRefreshSchema}
            forceOpen={forceOpen}
            tableOpenableKinds={tableOpenableKinds}
            hideDetailKinds={hideDetailKinds}
          />
        ))}
    </>
  );
}

function ConnectionCard({
  conn,
  expanded,
  schema,
  selectedNodeId,
  refreshing,
  error,
  onExpand,
  onEdit,
  onRefresh,
  onDisconnect,
  onRefreshSchemaNode,
  onLoadSchemaNodes,
  onSelectNode,
  onOpenTable,
  onShowDefinition,
  setDragNodeRef,
  dragStyle,
  dragHandleProps,
  dragging,
}: ConnectionCardProps) {
  const driver = driverForKind(conn.kind);
  const [tableFilter, setTableFilter] = useState("");
  const persistedSchemas = useSchemaUiStore(
    (state) => state.selectedSchemasByConnection[conn.id],
  );
  const setSelectedSchemas = useSchemaUiStore(
    (state) => state.setSelectedSchemas,
  );
  // Lazy sources start with NOTHING selected; the user must pick a schema to
  // load its tables, so a brand-new connection shows an empty tree (no implicit
  // default). Eager sources fall back to the driver's default schemas, which
  // gate what the already-loaded tree displays.
  const selectedSchemas =
    persistedSchemas ?? (driver.lazySchemaTables ? [] : driver.defaultSchemas);

  const allSchemaNames = useMemo(() => {
    if (!schema) return [];
    return driver.extractSchemaNames(schema);
  }, [schema, driver]);

  const schemaOptions = useMemo(
    () => allSchemaNames.map((name) => ({ value: name, label: name })),
    [allSchemaNames],
  );

  const hasSchemas = allSchemaNames.length > 0;

  const filteredSchema = useMemo(() => {
    if (!schema) return undefined;
    // Lazy sources show nothing until a schema is picked; an empty selection
    // means "no tables fetched yet", not "show everything".
    if (driver.lazySchemaTables && selectedSchemas.length === 0) return [];
    const selected = hasSchemas && selectedSchemas.length > 0 ? selectedSchemas : [];
    let nodes = driver.groupSchemaTree(schema, selected);
    const query = tableFilter.trim().toLowerCase();
    if (query) nodes = filterSchemaTree(nodes, query);
    return nodes;
  }, [driver, hasSchemas, schema, selectedSchemas, tableFilter]);

  return (
    <div
      ref={setDragNodeRef}
      style={dragStyle}
      className={`mdbc-conn-card${dragging ? " dragging" : ""}`}
      data-testid={`conn-card-${conn.id}`}
    >
      <div
        className="mdbc-conn-card-head"
        onClick={onExpand}
        data-testid={`expand-toggle-${conn.id}`}
        {...dragHandleProps}
      >
        <span className="mdbc-conn-card-badge">
          <DatabaseKindIcon kind={conn.kind} size={16} />
        </span>
        <span className="mdbc-conn-card-meta">
          <span className="mdbc-conn-card-name">{conn.name}</span>
          <span className="mdbc-conn-card-sub">
            {conn.kind}
            {conn.isConnected && (
              <span className="mdbc-status-dot live mdbc-connections-live-dot" />
            )}
          </span>
        </span>
        <span
          className="mdbc-conn-card-tools"
          onClick={(event) => event.stopPropagation()}
        >
          <Tooltip label="Refresh schema">
            <span
              className={`mdbc-conn-card-btn${refreshing ? " spinning" : ""}`}
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onRefresh();
              }}
              data-testid={`refresh-schema-${conn.id}`}
            >
              <Icon name="refreshCw" size={14} />
            </span>
          </Tooltip>
          {conn.isConnected && (
            <Tooltip label="Disconnect">
              <span
                className="mdbc-conn-card-btn"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onDisconnect();
                }}
                data-testid={`disconnect-${conn.id}`}
              >
                <Icon name="unplug" size={14} />
              </span>
            </Tooltip>
          )}
          <Tooltip label="Edit connection">
            <span
              className="mdbc-conn-card-btn"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              <Icon name="cog" size={14} />
            </span>
          </Tooltip>
        </span>
      </div>
      {expanded && (
        <div className="mdbc-conn-card-body">
          {hasSchemas && (
            <div className="mdbc-pane-form">
              <MultiSelect
                values={selectedSchemas}
                options={schemaOptions}
                onChange={(values) => {
                  setSelectedSchemas(conn.id, values);
                  // Lazy-schema sources (BigQuery) load datasets only up front;
                  // fetch the tables for any newly selected dataset that isn't
                  // populated yet. Already-loaded datasets are skipped.
                  if (driver.lazySchemaTables && schema) {
                    const toLoad = values.filter(
                      (name) => !isSchemaNodeLoaded(schema, name),
                    );
                    if (toLoad.length > 0) onLoadSchemaNodes(toLoad);
                  }
                }}
                prefix={driver.schemaTermLabel}
                selectAllWhenEmpty={!driver.lazySchemaTables}
                showSelectAll
                emptyLabel={
                  driver.lazySchemaTables
                    ? `Select ${driver.schemaTermLabel.toLowerCase()}`
                    : undefined
                }
                data-testid={`schema-select-${conn.id}`}
              />
            </div>
          )}
          <SearchInput
            value={tableFilter}
            onChange={setTableFilter}
            placeholder="Find object…"
            size="sm"
            testId={`schema-filter-${conn.id}`}
          />
          {!filteredSchema && !error && (
            <div className="mdbc-empty">
              {refreshing ? (
                "Connecting…"
              ) : conn.isConnected ? (
                "Loading…"
              ) : (
                <>
                  Click{" "}
                  <Icon
                    name="refreshCw"
                    size={12}
                    className="mdbc-connect-hint-icon"
                  />{" "}
                  to connect
                </>
              )}
            </div>
          )}
          {error && (
            <div className="mdbc-empty mdbc-connections-error-text">
              {error}
            </div>
          )}
          {filteredSchema &&
            filteredSchema.length === 0 &&
            !(driver.lazySchemaTables && selectedSchemas.length === 0) && (
              <div className="mdbc-empty">No matches</div>
            )}
          {filteredSchema?.map((node) => (
            <SchemaNodeRow
              key={node.path}
              node={node}
              depth={0}
              selectedNodeId={selectedNodeId}
              onSelect={onSelectNode}
              onOpenTable={onOpenTable}
              onShowDefinition={onShowDefinition}
              onRefreshSchema={(target) =>
                onRefreshSchemaNode(
                  driver.lazyLoadKeyFromNode?.(target) ?? target.name,
                )
              }
              forceOpen={tableFilter.length > 0}
              tableOpenableKinds={driver.tableOpenableKinds}
              hideDetailKinds={driver.hideDetailKinds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { ConnectionCard };
