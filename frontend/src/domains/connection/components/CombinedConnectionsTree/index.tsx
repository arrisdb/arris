import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import { SearchInput } from "@shared/ui";
import { ConnectionEditorSheet } from "../ConnectionEditorSheet";
import { ConnectionKindPicker } from "../ConnectionKindPicker";
import { CONNECTIONS_PANE_CONTEXT_MENU_ITEMS } from "./constants";
import { useCombinedConnectionsTree } from "./hooks";
import "./index.css";
import { ConnectionCard } from "./components/ConnectionCard";
import { ConnectionsHeader } from "./components/ConnectionsHeader";
import { DragConnectionChip } from "./components/DragConnectionChip";
import { SortableConnectionCard } from "./components/SortableConnectionCard";

function CombinedConnectionsTree() {
  const pane = useCombinedConnectionsTree();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // A short activation distance lets a plain click on a card header still expand
  // it: the drag only kicks in once the pointer actually moves.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Reordering reshuffles the whole connection list, so it only makes sense on
  // the unfiltered view: disable drag while a filter narrows what's shown.
  const reorderEnabled = pane.filter.trim() === "";
  const ids = pane.visibleConnections.map((connection) => connection.id);
  const draggingConnection = draggingId
    ? pane.visibleConnections.find((connection) => connection.id === draggingId) ?? null
    : null;

  function onConnectionDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  function onConnectionDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    pane.onReorderConnections(arrayMove(ids, from, to));
  }

  const cards = pane.visibleConnections.map((connection) => {
    const Card = reorderEnabled ? SortableConnectionCard : ConnectionCard;
    return (
      <Card
        key={connection.id}
        conn={connection}
        expanded={pane.expanded.has(connection.id)}
        schema={pane.schemaCache[connection.id]}
        selectedNodeId={pane.selectedNodeId}
        refreshing={pane.refreshing.has(connection.id)}
        error={pane.connErrors[connection.id]}
        onExpand={() => pane.onExpandConnection(connection)}
        onEdit={() => pane.onEditConnection(connection.id)}
        onRefresh={() => pane.onRefreshSchema(connection)}
        onDisconnect={() => pane.onDisconnect(connection)}
        onRefreshSchemaNode={(schema) => pane.onRefreshSchemaNode(connection.id, schema)}
        onLoadSchemaNodes={(schemas) => pane.onLoadSchemaNodes(connection.id, schemas)}
        onSelectNode={(path) => pane.onSelectNode(path, connection.id)}
        onOpenTable={(node) => pane.onOpenTable(connection, node)}
        onShowDefinition={(node) => pane.onShowDefinition(connection, node)}
      />
    );
  });

  return (
    <>
      <ConnectionsHeader pane={pane} />
      <SearchInput
        value={pane.filter}
        onChange={pane.onFilterChange}
        placeholder="Filter"
        testId="connections-filter"
      />
      <PaneContextMenuSurface
        className="mdbc-conn-list mdbc-pane-body"
        context={null}
        getItems={CONNECTIONS_PANE_CONTEXT_MENU_ITEMS}
        data-testid="connection-cards"
        onClick={pane.onClickConnectionList}
      >
        {reorderEnabled ? (
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={onConnectionDragStart}
            onDragEnd={onConnectionDragEnd}
            onDragCancel={() => setDraggingId(null)}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {cards}
            </SortableContext>
            {/* Float the dragged card in a portal so it tracks the cursor above
                everything instead of being clipped by the scrolling list. */}
            <DragOverlay dropAnimation={null}>
              {draggingConnection ? <DragConnectionChip conn={draggingConnection} /> : null}
            </DragOverlay>
          </DndContext>
        ) : (
          cards
        )}
        {pane.visibleConnections.length === 0 && (
          <div className="mdbc-empty">No connections</div>
        )}
      </PaneContextMenuSurface>
      <ConnectionKindPicker
        open={pane.pickerOpen}
        onClose={pane.onClosePicker}
        onSelect={pane.onSelectNewKind}
      />
      <ConnectionEditorSheet
        open={pane.editorOpen}
        onClose={pane.onCloseEditor}
        initial={pane.editingConfig}
        kind={pane.editingConfig?.kind ?? pane.newKind}
        onSaved={pane.onConnectionSaved}
      />
    </>
  );
}

export { CombinedConnectionsTree };
