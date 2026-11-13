/// The active tab as `arris context` reports it.
interface UiTabContext {
  id: string;
  title: string;
  tabType: string;
  connectionId?: string;
  text?: string;
  selection?: { from: number; to: number; text: string };
}

interface UiContext {
  tab: UiTabContext | null;
}

export type { UiContext, UiTabContext };
