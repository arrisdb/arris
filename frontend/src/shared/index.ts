// Public surface of the `shared` layer's root modules. Components live under
// `@shared/ui`; this barrel re-exports the DTO vocabulary and the cross-domain
// pane / tab-view contribution registries.
export * from "./backendTypes";
export * from "./paneRegistry";
export * from "./tabViewRegistry";
