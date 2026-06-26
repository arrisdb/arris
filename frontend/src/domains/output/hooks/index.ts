// Store-only subbarrel: sibling domains import the command-log store from
// `@domains/output/hooks` to avoid pulling the domain's component graph into
// module-init.
export { useCommandLogStore } from "./store";
