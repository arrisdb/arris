import { create } from "zustand";
import type { KeymapAction } from "@shared/settings";

interface CommandHandler {
  run: () => void;
  isEnabled: () => boolean;
}

interface CommandRegistryState {
  handlers: Map<KeymapAction, CommandHandler>;
  register: (id: KeymapAction, handler: CommandHandler) => void;
  unregister: (id: KeymapAction, handler: CommandHandler) => void;
  run: (id: KeymapAction) => boolean;
  isEnabled: (id: KeymapAction) => boolean;
}

const useCommandRegistryStore = create<CommandRegistryState>((set, get) => ({
  handlers: new Map(),

  register: (id, handler) => {
    const handlers = new Map(get().handlers);
    handlers.set(id, handler);
    set({ handlers });
  },

  unregister: (id, handler) => {
    // A newer owner may have taken over the id before this one unmounted; only
    // drop the entry if it still points at the handler we registered.
    if (get().handlers.get(id) !== handler) return;
    const handlers = new Map(get().handlers);
    handlers.delete(id);
    set({ handlers });
  },

  run: (id) => {
    const handler = get().handlers.get(id);
    if (!handler || !handler.isEnabled()) return false;
    handler.run();
    return true;
  },

  isEnabled: (id) => {
    const handler = get().handlers.get(id);
    return handler ? handler.isEnabled() : false;
  },
}));

export { useCommandRegistryStore };
