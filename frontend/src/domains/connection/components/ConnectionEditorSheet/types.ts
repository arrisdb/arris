import type { ComponentType, Dispatch, SetStateAction } from "react";
import type {
  ConnectionConfig,
  DatabaseKind,
  ScopedConnection,
} from "../CombinedConnectionsTree/types";
import type { FieldsProps } from "./fields/types";

type TestResult = { ok: true } | { ok: false; message: string } | null;

interface ConnectionEditorSheetProps {
  open: boolean;
  onClose: () => void;
  initial: ConnectionConfig | null;
  kind: DatabaseKind;
  onSaved?: (saved: ScopedConnection) => void;
}

interface ConnectionEditorSheetViewModel {
  busy: boolean;
  config: ConnectionConfig;
  error: string | null;
  fieldsComponent: ComponentType<FieldsProps>;
  initial: ConnectionConfig | null;
  onChangeUri: (value: string) => void;
  onClickDelete: () => Promise<void>;
  onClickSave: () => Promise<void>;
  onClickTest: () => Promise<void>;
  onClose: () => void;
  patch: <K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) => void;
  setConfig: Dispatch<SetStateAction<ConnectionConfig>>;
  setShowSsh: (next: boolean) => void;
  showSsh: boolean;
  testResult: TestResult;
  testing: boolean;
  title: string;
  uri: string;
}

export type {
  ConnectionEditorSheetProps,
  ConnectionEditorSheetViewModel,
  TestResult,
};
