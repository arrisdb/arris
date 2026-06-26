import type { ReactNode } from "react";
import type { KeymapCategory, KeyShortcut, KeymapAction } from "@shared/settings";
import type { SettingsPane } from "@shared/settings";

interface SettingsNavItem {
  key: SettingsPane;
  label: string;
}

interface SettingsViewModel {
  close: () => void;
  open: boolean;
  pane: SettingsPane;
  setPane: (pane: SettingsPane) => void;
}

interface SettingsPaneProps {
  children: ReactNode;
  onReset?: () => void;
}

interface SettingsSectionProps {
  children: ReactNode;
  title: string;
  description?: string;
}

interface SettingRowProps {
  children: ReactNode;
  description: string;
  label: string;
  testId?: string;
}

interface SettingsCheckboxProps {
  ariaLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface SyntaxColorSwatchProps {
  label: string;
  token: string;
  value?: string;
  onChange: (color: string | null) => void;
}

interface KeymapConflict {
  action: KeymapAction;
  other: KeymapAction;
  shortcut: KeyShortcut;
}

interface KeymapCategoryGroup {
  actions: KeymapAction[];
  category: KeymapCategory;
}

export type {
  KeymapCategoryGroup,
  KeymapConflict,
  SettingRowProps,
  SettingsCheckboxProps,
  SettingsNavItem,
  SettingsPaneProps,
  SettingsSectionProps,
  SettingsViewModel,
  SyntaxColorSwatchProps,
};
