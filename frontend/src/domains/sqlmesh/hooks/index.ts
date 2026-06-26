// Store-only subbarrel: sibling domains import the sqlmesh store from
// `@domains/sqlmesh/hooks` to avoid pulling the domain's component graph into
// module-init.
export { useSqlMeshStore } from "./store";
