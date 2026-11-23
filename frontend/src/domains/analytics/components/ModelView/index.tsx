import { HAS_COMPILED_SQL } from "../../constants";
import { LineagePanel } from "../LineagePanel";
import {
  COLUMNS_TITLE,
  COLUMN_HINT,
  DOWNSTREAM_TITLE,
  LINEAGE_TITLE,
  LOADING_MESSAGE,
  MODEL_TEST_ID,
  NONE_LABEL,
  NO_COMPILED_MESSAGE,
  SQL_TABS,
  UPSTREAM_TITLE,
} from "./constants";
import { useModelView } from "./hooks";
import type { ModelViewProps } from "./types";
import "./index.css";

function ModelLinks({ title, ids, onOpen }: { title: string; ids: string[]; onOpen: (id: string) => void }) {
  return (
    <section className="mdbc-analytics-model-section">
      <h3>{title}</h3>
      {ids.length === 0 && <span className="mdbc-analytics-muted">{NONE_LABEL}</span>}
      {ids.map((id) => (
        <button key={id} type="button" className="mdbc-analytics-link" onClick={() => onOpen(id)}>
          {id}
        </button>
      ))}
    </section>
  );
}

/// One model: SQL (raw and, for dbt, compiled), documented columns, neighbors and lineage.
function ModelView({ tool, name, onOpenModel }: ModelViewProps) {
  const { model, error, tab, setTab, selected, selectColumn } = useModelView(tool, name);

  if (error) return <p className="mdbc-analytics-message">{error}</p>;
  if (!model) return <p className="mdbc-analytics-message">{LOADING_MESSAGE}</p>;

  const modelId = model.uniqueId ?? model.name;
  const tabs = HAS_COMPILED_SQL[tool] ? SQL_TABS : SQL_TABS.slice(0, 1);
  const sql = tab === "compiled" ? model.compiledSql : model.rawSql;

  return (
    <div className="mdbc-analytics-model" data-testid={MODEL_TEST_ID}>
      <header className="mdbc-analytics-model-head">
        <h2>{model.name}</h2>
        <span className="mdbc-analytics-muted">{model.path}</span>
        {model.description && <p>{model.description}</p>}
      </header>

      <div className="mdbc-analytics-sql-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="mdbc-analytics-nav-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sql ? (
        <pre className="mdbc-analytics-code">{sql}</pre>
      ) : (
        <p className="mdbc-analytics-message">{NO_COMPILED_MESSAGE}</p>
      )}

      <section className="mdbc-analytics-model-section">
        <h3>{COLUMNS_TITLE}</h3>
        {model.columns.length > 0 && <span className="mdbc-analytics-muted">{COLUMN_HINT}</span>}
        <table className="mdbc-analytics-columns">
          <tbody>
            {model.columns.map((c) => (
              <tr
                key={c.name}
                aria-selected={selected?.column === c.name}
                onClick={() => selectColumn(modelId, c.name)}
              >
                <td>{c.name}</td>
                <td className="mdbc-analytics-muted">{c.type ?? ""}</td>
                <td>{c.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ModelLinks title={UPSTREAM_TITLE} ids={model.upstream} onOpen={onOpenModel} />
      <ModelLinks title={DOWNSTREAM_TITLE} ids={model.downstream} onOpen={onOpenModel} />

      <section className="mdbc-analytics-model-section">
        <h3>{LINEAGE_TITLE}</h3>
        <LineagePanel
          tool={tool}
          name={name}
          selected={selected}
          onSelectColumn={selectColumn}
          onOpenModel={onOpenModel}
        />
      </section>
    </div>
  );
}

export { ModelView };
