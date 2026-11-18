import { useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SearchInput } from "@shared/ui";
import {
  EMPTY_MESSAGE,
  LOADING_MESSAGE,
  MODELS_TEST_ID,
  MODEL_ROW_HEIGHT,
  MODEL_ROW_OVERSCAN,
  SEARCH_PLACEHOLDER,
} from "./constants";
import { useModels } from "./hooks";
import type { ModelsViewProps } from "./types";
import { modelBadge } from "./utils";
import "./index.css";

/// Searchable model list, virtualized so projects with thousands of models stay responsive.
function ModelsView({ tool, onOpenModel }: ModelsViewProps) {
  const { loading, error, query, setQuery, visible } = useModels(tool);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: useCallback(() => scrollRef.current, []),
    estimateSize: useCallback(() => MODEL_ROW_HEIGHT, []),
    overscan: MODEL_ROW_OVERSCAN,
  });

  return (
    <div className="mdbc-analytics-models" data-testid={MODELS_TEST_ID}>
      <div className="mdbc-analytics-models-search">
        <SearchInput value={query} onChange={setQuery} placeholder={SEARCH_PLACEHOLDER} />
      </div>
      {error && <p className="mdbc-analytics-message">{error}</p>}
      {loading && <p className="mdbc-analytics-message">{LOADING_MESSAGE}</p>}
      {!loading && !error && visible.length === 0 && (
        <p className="mdbc-analytics-message">{EMPTY_MESSAGE}</p>
      )}
      <div ref={scrollRef} className="mdbc-analytics-models-scroll">
        <div
          className="mdbc-analytics-models-track"
          style={{ "--mdbc-models-height": `${virtualizer.getTotalSize()}px` } as CSSProperties}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const model = visible[item.index];
            return (
              <button
                key={model.uniqueId ?? model.name}
                type="button"
                className="mdbc-analytics-model-row"
                style={{ "--mdbc-model-row-y": `${item.start}px` } as CSSProperties}
                onClick={() => onOpenModel(model.name)}
              >
                <span className="mdbc-analytics-model-name">{model.name}</span>
                <span className="mdbc-analytics-model-badge">{modelBadge(model)}</span>
                <span className="mdbc-analytics-model-path">{model.path}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { ModelsView };
