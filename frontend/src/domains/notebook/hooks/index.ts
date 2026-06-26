// Store-only subbarrel: sibling domains import the notebook store from
// `@domains/notebook/hooks` to avoid pulling the domain's component graph into
// module-init.
export { useNotebookStore } from "./store";
