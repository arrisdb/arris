// Store-only subbarrel: sibling domains import the agent store from
// `@domains/agent/hooks` to avoid pulling the domain's component graph into
// module-init.
export { useAgentStore } from "./store";
