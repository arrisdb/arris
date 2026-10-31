import App from "../App";
import { ConnectionRequestPage } from "../ConnectionRequestPage";
import { useRoute } from "../../utils";

// The browser serves the desktop shell; only the connection form stands alone.
function WebRoot() {
  return useRoute().kind === "connectionRequest" ? <ConnectionRequestPage /> : <App />;
}

export { WebRoot };
