// Store-only subbarrel: sibling domains import the git store from
// `@domains/git/hooks` to avoid pulling the domain's component graph into
// module-init.
export { useGitStore } from "./store";
