import { DeepLinkHost } from "@shell/components/DeepLinkHost";
import { NoProjectScreen } from "@shell/components/ProjectSwitcher";
import { ContentView } from "@shell/components/ContentView";
import { FileSearchPopover } from "@domains/files/components/FileSearchPopover";
import { isWebShell } from "@shared/api";
import { ProjectLoadingScreen } from "@shell/components/ProjectLoadingScreen";
import { QueryHandoffHost } from "@shell/components/QueryHandoffHost";
import { ServerEventsHost } from "@shell/components/ServerEventsHost";
import { SnackbarHost } from "@shell/components/SnackbarHost";
import { WelcomeScreen } from "@shell/components/WelcomeScreen";
import { useAppState } from "@shell/hooks";

function App() {
  const app = useAppState();

  if (app.bootstrapError) {
    return (
      <div className="mdbc-app-error-state">
        <h2>Failed to load connections</h2>
        <pre>{app.bootstrapError}</pre>
      </div>
    );
  }

  if (app.bootstrapping) {
    return null;
  }

  // While a project is loading (Cmd+O after bootstrap), show a neutral screen so
  // the previously open project's workspace is replaced immediately rather than
  // lingering until the new project finishes loading.
  if (app.loading) {
    return <ProjectLoadingScreen />;
  }

  if (!app.activeProject) {
    return isWebShell() ? <NoProjectScreen /> : <WelcomeScreen />;
  }

  return (
    <>
      <ContentView />
      <FileSearchPopover />
      <SnackbarHost />
      <QueryHandoffHost />
      <ServerEventsHost />
      {isWebShell() && <DeepLinkHost />}
    </>
  );
}

export default App;
