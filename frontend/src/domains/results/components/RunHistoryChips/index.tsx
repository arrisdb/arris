import { useRunHistoryStore } from "../../hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "@shared/ui";
import {
  ContextMenu,
  type ContextMenuItem,
  useContextMenu,
} from "@shared/ui/ContextMenu";
import {
  flattenRuns,
  orderRunsForDisplay,
  runChipLabel,
  visibleQueryRuns,
} from "./utils";

interface ChipMenuContext {
  runId: string;
  label: string;
  pinned: boolean;
}

function RunHistoryChips() {
  // Subscribe to the stable map ref (not a flattened array) so zustand's
  // equality check holds; flatten + filter in a memo keyed on that ref.
  const runsByTab = useRunHistoryStore((s) => s.runsByTab);
  const selectedId = useRunHistoryStore((s) => s.selectedRunId);
  const select = useRunHistoryStore((s) => s.selectRun);
  const remove = useRunHistoryStore((s) => s.removeRun);
  const renameRun = useRunHistoryStore((s) => s.renameRun);
  const togglePin = useRunHistoryStore((s) => s.togglePin);
  const runs = useMemo(
    () => orderRunsForDisplay(visibleQueryRuns(flattenRuns(runsByTab))),
    [runsByTab],
  );
  const stripRef = useRef<HTMLDivElement>(null);
  const menu = useContextMenu<ChipMenuContext>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // The latest run is the rightmost chip; keep it in view by pinning the
  // overflow strip to its end whenever the run count changes.
  useEffect(() => {
    const strip = stripRef.current;
    if (strip) strip.scrollLeft = strip.scrollWidth;
  }, [runs.length]);

  // When a chip is selected, reveal it: if its edge is clipped (scrolled off /
  // hidden), scroll so the chip is visible, otherwise the selected tab's name
  // is blocked. A PEEK margin leaves the neighbouring chip slightly visible so
  // the selection has context instead of sitting flush against the edge.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>(".mdbc-chip.active");
    if (!active) return;
    const PEEK = 60;
    const trackRect = strip.getBoundingClientRect();
    const chipRect = active.getBoundingClientRect();
    if (chipRect.left < trackRect.left) {
      strip.scrollLeft = Math.max(0, strip.scrollLeft - (trackRect.left - chipRect.left) - PEEK);
    } else if (chipRect.right > trackRect.right) {
      strip.scrollLeft += chipRect.right - trackRect.right + PEEK;
    }
  }, [selectedId]);

  function onDoubleClickChip(runId: string, label: string) {
    setEditingId(runId);
    setDraft(label);
  }

  function commitRename() {
    if (editingId) renameRun(editingId, draft);
    setEditingId(null);
  }

  // The pin affordance lives in the chip's right-click menu (no inline button):
  // "Rename" reuses the inline-edit path, "Pinned Tab" toggles the run's pin.
  const menuItems: ContextMenuItem[] = menu.state
    ? [
        {
          id: "rename",
          label: "Rename",
          testId: "run-chip-rename",
          action: () =>
            onDoubleClickChip(menu.state!.context.runId, menu.state!.context.label),
        },
        {
          id: "pin",
          label: menu.state.context.pinned ? "Unpin Tab" : "Pinned Tab",
          testId: "run-chip-pin",
          action: () => togglePin(menu.state!.context.runId),
        },
      ]
    : [];

  if (runs.length === 0) return null;

  return (
    <div className="mdbc-runs-strip">
      <span className="mdbc-runs-label">Runs</span>
      <div className="mdbc-runs-track" ref={stripRef}>
        {runs.map((r, i) => {
          const label = runChipLabel(r);
          const editing = editingId === r.id;
          return (
            <Chip
              key={r.id}
              active={selectedId === r.id || (!selectedId && i === runs.length - 1)}
              pinned={r.pinned}
              onClick={editing ? undefined : () => select(r.id)}
              onClose={editing ? undefined : () => remove(r.tabId, r.id)}
              onContextMenu={
                editing
                  ? undefined
                  : (e) => menu.open(e, { runId: r.id, label, pinned: !!r.pinned })
              }
              onDoubleClick={() => onDoubleClickChip(r.id, label)}
              title={r.sqlSnapshot.slice(0, 200)}
            >
              {editing ? (
                <input
                  className="mdbc-chip-rename"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                  aria-label="Rename run"
                />
              ) : (
                label
              )}
            </Chip>
          );
        })}
      </div>
      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={menuItems}
          onClose={menu.close}
          data-testid="run-chip-ctx-menu"
        />
      )}
    </div>
  );
}

export { RunHistoryChips };
