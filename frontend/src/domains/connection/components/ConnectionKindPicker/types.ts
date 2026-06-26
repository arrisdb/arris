import type { DatabaseKind } from "../CombinedConnectionsTree/types";

interface ConnectionKindPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (kind: DatabaseKind) => void;
}

interface PickerKindOption {
  kind: DatabaseKind;
  displayName: string;
}

interface PickerKindGroup {
  title: string;
  options: PickerKindOption[];
}

export type {
  ConnectionKindPickerProps,
  PickerKindGroup,
  PickerKindOption,
};
