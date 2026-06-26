type UpdatePhase =
  | "idle"
  | "checking"
  | "uptodate"
  | "available"
  | "downloading"
  | "installing"
  | "error";

interface AvailableUpdate {
  version: string;
  currentVersion: string;
}

export type { UpdatePhase, AvailableUpdate };
