import { IconButton, type IconButtonProps } from "@shared/ui/IconButton";
import { ACTIONS, useSettingsStore } from "@shared/settings";
import { useCommandRegistryStore } from "../../hooks/commandRegistryStore";
import { runCommand, shortcutDisplay } from "@shell/utils";
import type { KeymapAction } from "@shared/settings";

interface CommandButtonProps extends Omit<IconButtonProps, "label" | "onClick"> {
  id: KeymapAction;
  label?: string;
}

// A toolbar icon button bound to a registered command. Click, label, shortcut
// hint, and disabled state all derive from the command registry; the keyboard
// shortcut and this button invoke the exact same handler via runCommand(id).
function CommandButton({ id, label, title, disabled, ...rest }: CommandButtonProps) {
  const registered = useCommandRegistryStore((s) => s.handlers.has(id));
  const enabled = useCommandRegistryStore((s) => s.isEnabled(id));
  const shortcut = useSettingsStore((s) => s.shortcuts[id]);
  const resolvedLabel = label ?? ACTIONS[id].label;
  const hint = shortcutDisplay(shortcut);
  return (
    <IconButton
      {...rest}
      label={resolvedLabel}
      title={title ?? (hint ? `${resolvedLabel} (${hint})` : resolvedLabel)}
      disabled={disabled ?? (registered && !enabled)}
      onClick={() => runCommand(id)}
    />
  );
}

export { CommandButton };
export type { CommandButtonProps };
