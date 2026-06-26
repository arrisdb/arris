import { Sheet } from "@shared/ui";
import {
  PANES,
  SETTINGS_SHEET,
} from "./constants";
import { useSettingsView } from "./hooks";
import { AppearancePane } from "./components/AppearancePane";
import { ConnectionsPane } from "./components/ConnectionsPane";
import { FontsPane } from "./components/FontsPane";
import { FormatterPane } from "./components/FormatterPane";
import { GeneralPane } from "./components/GeneralPane";
import { KeymapPane } from "./components/KeymapPane";
import { TerminalPane } from "./components/TerminalPane";
import "./index.css";

function SettingsView() {
  const {
    close,
    open,
    pane,
    setPane,
  } = useSettingsView();

  return (
    <Sheet
      open={open}
      onClose={close}
      title={SETTINGS_SHEET.title}
      width={SETTINGS_SHEET.width}
      height={SETTINGS_SHEET.height}
      minWidth={SETTINGS_SHEET.minWidth}
      minHeight={SETTINGS_SHEET.minHeight}
      closeOnBackdropClick={false}
      resizable
      storageKey={SETTINGS_SHEET.storageKey}
    >
      <div className="mdbc-settings-layout">
        <div className="mdbc-settings-nav">
          {PANES.map((item) => (
            <button
              key={item.key}
              onClick={() => setPane(item.key)}
              className={[`mdbc-row ${pane === item.key ? "selected" : ""}`, "mdbc-settings-nav-item"].filter(Boolean).join(" ")}
            >
              <span className="name">{item.label}</span>
            </button>
          ))}
        </div>
        <div className="mdbc-settings-content">
          {pane === "general" && <GeneralPane />}
          {pane === "connections" && <ConnectionsPane />}
          {pane === "appearance" && <AppearancePane />}
          {pane === "fonts" && <FontsPane />}
          {pane === "formatter" && <FormatterPane />}
          {pane === "terminal" && <TerminalPane />}
          {pane === "keymap" && <KeymapPane />}
        </div>
      </div>
    </Sheet>
  );
}

export { SettingsView };
