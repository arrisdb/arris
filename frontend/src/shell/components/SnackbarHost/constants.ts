import type { IconName } from "@shared/ui/Icon";
import type { SnackbarKind } from "../../types";

const SNACKBAR_KIND_ICONS: Record<SnackbarKind, IconName> = {
  success: "check",
  error: "info",
};

const SNACKBAR_ICON_SIZE = 12;

export {
  SNACKBAR_ICON_SIZE,
  SNACKBAR_KIND_ICONS,
};
