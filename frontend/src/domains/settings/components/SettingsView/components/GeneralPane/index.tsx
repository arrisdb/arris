import { useSettingsStore } from "@shared/settings";
import { EditableTable } from "@shared/ui/EditableTable";
import type { EditableTableRow } from "@shared/ui/EditableTable/types";
import { useFilesStore } from "@domains/files/hooks";
import { SettingsPane } from "../SettingsPane";
import { SettingRow } from "../SettingRow";
import { SettingsCheckbox } from "../SettingsCheckbox";
import { SettingsSection } from "../SettingsSection";
import { SKIP_DIR_COLUMNS } from "./constants";

function GeneralPane() {
  const reopenLastProject = useSettingsStore((state) => state.reopenLastProject);
  const setReopen = useSettingsStore((state) => state.setReopenLastProject);
  const autosave = useSettingsStore((state) => state.autosave);
  const setAutosave = useSettingsStore((state) => state.setAutosave);
  const debugMode = useSettingsStore((state) => state.debugMode);
  const setDebugMode = useSettingsStore((state) => state.setDebugMode);
  const fileTreeSkipDirs = useSettingsStore((state) => state.fileTreeSkipDirs);
  const setFileTreeSkipDirs = useSettingsStore((state) => state.setFileTreeSkipDirs);
  const resetGeneral = useSettingsStore((state) => state.resetGeneral);

  const skipDirRows = fileTreeSkipDirs.map((name) => ({ name }));

  // Collapse the table's rows back to a clean, deduped folder-name list, persist
  // it, then re-read the tree so the change is visible at once.
  const onChangeSkipDirRows = (rows: EditableTableRow[]) => {
    const dirs: string[] = [];
    for (const row of rows) {
      const name = (row.name ?? "").trim();
      if (name && !dirs.includes(name)) dirs.push(name);
    }
    setFileTreeSkipDirs(dirs);
    useFilesStore.getState().refresh().catch(() => {});
  };
  return (
    <SettingsPane onReset={resetGeneral}>
      <SettingRow
        label="Startup"
        description="Reopen last project on launch"
        testId="reopen-last-project-toggle"
      >
        <SettingsCheckbox
          checked={reopenLastProject}
          onChange={setReopen}
          ariaLabel="Reopen last project on launch"
        />
      </SettingRow>
      <SettingRow label="Files" description="Autosave files on change" testId="autosave-toggle">
        <SettingsCheckbox
          checked={autosave}
          onChange={setAutosave}
          ariaLabel="Autosave files on change"
        />
      </SettingRow>
      <SettingRow
        label="Debug mode"
        description="Persist diagnostic logs locally to help troubleshoot issues. Logs record event metadata only, never query results, credentials, or other sensitive data. Open them via Help > Show Debug Logs in Finder."
        testId="debug-mode-toggle"
      >
        <SettingsCheckbox
          checked={debugMode}
          onChange={setDebugMode}
          ariaLabel="Enable debug logging"
        />
      </SettingRow>
      <SettingsSection
        title="File tree hidden folders"
        description="Folder names hidden from the file tree. Edit the list to show folders like node_modules or hide your own (e.g. .arris). Applies to every project."
      >
        <EditableTable
          columns={SKIP_DIR_COLUMNS}
          rows={skipDirRows}
          onChange={onChangeSkipDirRows}
          emptyLabel="No hidden folders"
          testId="file-tree-skip-dirs"
        />
      </SettingsSection>
    </SettingsPane>
  );
}

export { GeneralPane };
