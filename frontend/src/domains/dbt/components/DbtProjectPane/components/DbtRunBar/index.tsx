import { useEffect, useRef, useState } from "react";
import { Icon } from "@shared/ui/Icon";
import { SplitButton } from "@shared/ui";
import type { SplitButtonItem } from "@shared/ui";
import { RUN_COMMANDS, SELECTOR_SYNTAX } from "../../constants";
import type { DbtRunBarProps } from "../../types";

function DbtSelectorInfo() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="mdbc-selector-info" ref={wrapRef}>
      <button
        type="button"
        className="mdbc-icon-btn xs"
        onClick={() => setOpen((value) => !value)}
        title="Selector syntax"
        data-testid="dbt-selector-info-btn"
      >
        <Icon name="info" size={13} />
      </button>
      {open && (
        <div
          className="mdbc-selector-info-popover mdbc-popover"
          data-testid="dbt-selector-info-popover"
        >
          <div className="mdbc-selector-info-title">Selector Syntax</div>
          {SELECTOR_SYNTAX.map(({ syntax, meaning }) => (
            <div className="mdbc-selector-info-row" key={syntax}>
              <code className="mdbc-selector-info-code">{syntax}</code>
              <span className="mdbc-selector-info-meaning">{meaning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DbtRunBar({ initialSelect, runningType, onRun }: DbtRunBarProps) {
  const [selector, setSelector] = useState(initialSelect);
  const running = runningType !== null;
  const items: SplitButtonItem[] = RUN_COMMANDS.map(({ kind, label }) => {
    // `dbt debug` validates profile/connection config: project-wide, no selector.
    if (kind === "debug") {
      return {
        id: kind,
        label,
        icon: <Icon name="terminal" size={11} />,
        title: "dbt debug (validate profile & connection)",
        disabled: running,
        loading: runningType === kind,
        onClick: () => onRun(kind, ""),
      };
    }
    return {
      id: kind,
      label,
      icon: <Icon name="play" size={11} />,
      title: `dbt ${kind}${selector ? ` --select ${selector}` : " (whole project)"}`,
      scope: selector,
      scopeEditable: true,
      scopePlaceholder: "whole project",
      onScopeChange: setSelector,
      disabled: running,
      loading: runningType === kind,
      onClick: () => onRun(kind, selector),
    };
  });
  return (
    <div className="mdbc-dbt-run-bar" data-testid="dbt-run-bar">
      <SplitButton items={items} fullWidth data-testid="dbt-run" />
      <DbtSelectorInfo />
    </div>
  );
}

export { DbtRunBar };
