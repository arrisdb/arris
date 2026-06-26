import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MixpanelEvent,
  initAnalytics,
  track,
  ctaPropsFromEl,
  resetAnalytics,
  type AnalyticsClient,
  type AttrElement,
} from "../lib/analytics";

function fakeClient(): { client: AnalyticsClient; track: ReturnType<typeof vi.fn> } {
  const track = vi.fn();
  return { client: { track }, track };
}

function attrEl(attrs: Record<string, string>): AttrElement {
  return { getAttribute: (name: string) => attrs[name] ?? null };
}

describe("analytics", () => {
  beforeEach(() => {
    resetAnalytics();
  });

  describe("MixpanelEvent enum", () => {
    it("uses stable human-readable names", () => {
      expect(MixpanelEvent.PageView).toBe("Page Viewed");
      expect(MixpanelEvent.DownloadClick).toBe("Download Clicked");
      expect(MixpanelEvent.PageFeedback).toBe("Page Feedback Submitted");
      expect(MixpanelEvent.CtaClick).toBe("CTA Clicked");
      expect(MixpanelEvent.SectionViewed).toBe("Section Viewed");
    });
  });

  describe("initAnalytics", () => {
    it("no-ops without a token", () => {
      expect(initAnalytics({ token: "" })).toBe(false);
    });

    it("activates with an injected client", () => {
      expect(initAnalytics({ client: fakeClient().client })).toBe(true);
    });

    it("guards against double-init, keeping the first client", () => {
      const first = fakeClient();
      const second = fakeClient();
      expect(initAnalytics({ client: first.client })).toBe(true);
      expect(initAnalytics({ client: second.client })).toBe(true);

      track(MixpanelEvent.PageView);
      expect(first.track).toHaveBeenCalledTimes(1);
      expect(second.track).not.toHaveBeenCalled();
    });
  });

  describe("track", () => {
    it("is a no-op before init", () => {
      const { track: spy } = fakeClient();
      // No init: track must not reach any client and must not throw.
      expect(() => track(MixpanelEvent.PageView, { path: "/" })).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("forwards the event and props once initialised", () => {
      const { client, track: spy } = fakeClient();
      initAnalytics({ client });
      track(MixpanelEvent.DownloadClick, { arch: "intel" });
      expect(spy).toHaveBeenCalledWith("Download Clicked", { arch: "intel" });
    });
  });

  describe("ctaPropsFromEl", () => {
    it("reads label and href from data attributes", () => {
      const el = attrEl({ "data-mp-cta": "hero-download", href: "/download" });
      expect(ctaPropsFromEl(el)).toEqual({ label: "hero-download", href: "/download" });
    });

    it("returns undefined for missing attributes", () => {
      const el = attrEl({ "data-mp-cta": "nav-brand" });
      expect(ctaPropsFromEl(el)).toEqual({ label: "nav-brand", href: undefined });
    });
  });
});
