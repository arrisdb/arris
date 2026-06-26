import { useCallback } from "react";
import { useDbtStore } from "../../hooks";
import type {
  DbtSchemaPaneProps,
  DbtSchemaPaneViewModel,
} from "./types";

function useDbtSchemaPane({
  onShowLineage,
}: DbtSchemaPaneProps): DbtSchemaPaneViewModel {
  const project = useDbtStore((state) => state.project);
  const selectedId = useDbtStore((state) => state.selectedNodeId);
  const node = project?.nodes.find((item) => item.uniqueId === selectedId) ?? null;

  const onClickLineage = useCallback(() => {
    if (node) onShowLineage?.(node.uniqueId);
  }, [node, onShowLineage]);

  return {
    node,
    onClickLineage,
    showLineageAction: Boolean(onShowLineage),
  };
}

export { useDbtSchemaPane };
