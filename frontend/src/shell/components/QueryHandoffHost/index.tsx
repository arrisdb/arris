import { useQueryHandoffs } from "./hooks";

// Opens queries sent by `arris query --open` as console tabs.
function QueryHandoffHost() {
  useQueryHandoffs();
  return null;
}

export { QueryHandoffHost };
