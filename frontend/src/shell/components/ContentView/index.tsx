import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RightSidebar } from "@shell/components/RightSidebar";
import { EditorPane } from "@domains/editor";
import { ResultsTableView } from "@domains/results/components/ResultsTableView";
import { ResultsFooterBar } from "@domains/results/components/ResultsTableView/components/ResultsFooterBar";
import { StatusBar } from "@shell/components/StatusBar";
import { LeftSidebar } from "@shell/components/LeftSidebar";
import { SettingsView } from "@domains/settings";
import { TopBar } from "@shell/components/TopBar";
import { useContentViewState } from "./hooks";
import { usePinnedQueryTabSync } from "@domains/pinnedQueries";
import { HANDLE_STYLE } from "./constants";
import { centerPanelDefaultSize } from "./utils";

export function ContentView() {
  const {
    leftVisible,
    rightVisible,
    showChartEditor,
    resultsInPanel,
  } = useContentViewState();
  usePinnedQueryTabSync();

  return (
    <div className="mdbc mdbc-content-root">
      <div className="mdbc-window mdbc-content-window">
        <TopBar />
        <div className="mdbc-content-main">
          <PanelGroup className="mdbc-content-main-panels" id="main-horizontal" direction="horizontal">
            {leftVisible && (
              <>
                <Panel id="left-sidebar" order={1} defaultSize={15} minSize={10}>
                  <LeftSidebar />
                </Panel>
                <PanelResizeHandle style={HANDLE_STYLE} />
              </>
            )}
            <Panel id="center-editor" order={2} defaultSize={centerPanelDefaultSize(leftVisible, rightVisible)} minSize={30}>
              <div className="mdbc-content-center-stack">
                <PanelGroup className="mdbc-content-editor-results" id="editor-results" direction="vertical">
                  <Panel id="editor-panel" order={1} defaultSize={resultsInPanel ? 60 : 100} minSize={10}>
                    <EditorPane />
                  </Panel>
                  {resultsInPanel && (
                    <>
                      <PanelResizeHandle className="mdbc-content-results-resizer" />
                      <Panel id="results-panel" order={2} defaultSize={40} minSize={3}>
                        <div className="mdbc-bottom-results" data-results-pane="bottom">
                          <ResultsTableView global />
                        </div>
                      </Panel>
                    </>
                  )}
                </PanelGroup>
                <ResultsFooterBar global />
              </div>
            </Panel>
            {(rightVisible || showChartEditor) && (
              <>
                <PanelResizeHandle style={HANDLE_STYLE} />
                <Panel id="right-sidebar" order={3} defaultSize={16} minSize={14}>
                  <RightSidebar />
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
        <StatusBar />
      </div>
      <SettingsView />
    </div>
  );
}
