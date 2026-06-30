import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AgentQuestionCard } from "./index";

const describeQuery = (id: string) =>
  id === "q1"
    ? { title: "Monthly sales", hasResult: true, rowCount: 28, colCount: 4 }
    : { title: "Other", hasResult: false, rowCount: 0, colCount: 0 };

describe("AgentQuestionCard", () => {
  it("renders a share_results request and answers shared=true on Share", () => {
    const onAnswer = vi.fn();
    render(
      <AgentQuestionCard
        question={{ type: "share_results", queryIds: ["q1"], reason: "need rows" }}
        answered={false}
        describeQuery={describeQuery}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText("Monthly sales")).toBeTruthy();
    expect(screen.getByText("28×4")).toBeTruthy();
    expect(screen.getByText("need rows")).toBeTruthy();
    fireEvent.click(screen.getByTestId("agent-question-share"));
    expect(onAnswer).toHaveBeenCalledWith({ type: "share_results", shared: true });
  });

  it("answers shared=false on Decline", () => {
    const onAnswer = vi.fn();
    render(
      <AgentQuestionCard
        question={{ type: "share_results", queryIds: ["q1"] }}
        answered={false}
        describeQuery={describeQuery}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-question-decline"));
    expect(onAnswer).toHaveBeenCalledWith({ type: "share_results", shared: false });
  });

  it("disables Share when no requested query has run", () => {
    render(
      <AgentQuestionCard
        question={{ type: "share_results", queryIds: ["q2"] }}
        answered={false}
        describeQuery={describeQuery}
        onAnswer={vi.fn()}
      />,
    );
    expect((screen.getByTestId("agent-question-share") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("not run yet")).toBeTruthy();
  });

  it("hides the actions once answered", () => {
    render(
      <AgentQuestionCard
        question={{ type: "share_results", queryIds: ["q1"] }}
        answered
        describeQuery={describeQuery}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("agent-question-share")).toBeNull();
    expect(screen.getByText("Answered.")).toBeTruthy();
  });
});
