import type { AgentQuestionCardProps } from "../../types";
import "./index.css";

/// Renders the agent's question as an inline card with answer controls, one
/// branch per question `type`. To add a question type, add a `type` case here
/// (plus its parser, follow-up builder, and union variant). `answered` freezes
/// the card once the user has responded.
function AgentQuestionCard({ question, answered, describeQuery, onAnswer }: AgentQuestionCardProps) {
  if (question.type === "share_results") {
    const infos = question.queryIds.map((id) => ({ id, ...describeQuery(id) }));
    const anyShareable = infos.some((i) => i.hasResult);
    return (
      <div className="mdbc-canvas-question" data-testid="agent-question-share-results">
        <div className="mdbc-canvas-question-title">Share results with the agent?</div>
        {question.reason ? (
          <div className="mdbc-canvas-question-reason">{question.reason}</div>
        ) : null}
        <ul className="mdbc-canvas-question-list">
          {infos.map((i) => (
            <li key={i.id} className="mdbc-canvas-question-item">
              <span className="mdbc-canvas-question-item-name">{i.title}</span>
              <span className="mdbc-canvas-question-item-meta">
                {i.hasResult ? `${i.rowCount}×${i.colCount}` : "not run yet"}
              </span>
            </li>
          ))}
        </ul>
        {answered ? (
          <div className="mdbc-canvas-question-done">Answered.</div>
        ) : (
          <div className="mdbc-canvas-question-actions">
            <button
              type="button"
              className="mdbc-btn primary"
              disabled={!anyShareable}
              onClick={() => onAnswer({ type: "share_results", shared: true })}
              data-testid="agent-question-share"
            >
              Share results
            </button>
            <button
              type="button"
              className="mdbc-btn"
              onClick={() => onAnswer({ type: "share_results", shared: false })}
              data-testid="agent-question-decline"
            >
              Decline
            </button>
          </div>
        )}
      </div>
    );
  }
  return null;
}

export { AgentQuestionCard };
