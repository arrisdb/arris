// Store-only subbarrel: sibling domains import the dbt store from
// `@domains/dbt/hooks` to avoid pulling the domain's component graph into
// module-init.
export { useDbtStore } from "./store";
