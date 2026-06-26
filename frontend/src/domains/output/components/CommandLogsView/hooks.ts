import { useEffect, useRef, useState } from "react";
import { useCommandLogStore } from "../../hooks/store";
import type { CommandLogsViewModel, StatusFilter } from "./types";

function useCommandLogsView(): CommandLogsViewModel {
  const entries = useCommandLogStore((state) => state.entries);
  const clear = useCommandLogStore((state) => state.clear);
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Newest entry renders at the top, so reveal it by scrolling up.
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
  }, [entries.length]);

  return {
    entries,
    scrollRef,
    filterText,
    setFilterText,
    statusFilter,
    setStatusFilter,
    onClickClear: clear,
  };
}

export {
  useCommandLogsView,
};
