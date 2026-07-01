import { Component, type ReactNode } from "react";

interface NodeBoundaryProps {
  children: ReactNode;
}

interface NodeBoundaryState {
  failed: boolean;
}

/// Error boundary around a single canvas object. A render error in one node (e.g.
/// a chart fed a malformed spec) is caught here and shown as an inline fallback,
/// so one bad object can never tear down the whole board or the app. The board
/// keeps working and the user can delete or re-ask the agent to fix the object.
class NodeBoundary extends Component<NodeBoundaryProps, NodeBoundaryState> {
  state: NodeBoundaryState = { failed: false };

  static getDerivedStateFromError(): NodeBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Canvas object failed to render:", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mdbc-canvas-node mdbc-canvas-node-error">
          <span>This object failed to render.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

export { NodeBoundary };
