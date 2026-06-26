import mixpanel from 'mixpanel-browser';

enum MixpanelEvent {
  PageView = 'Page Viewed',
  DownloadClick = 'Download Clicked',
  PageFeedback = 'Page Feedback Submitted',
  CtaClick = 'CTA Clicked',
  SectionViewed = 'Section Viewed',
}

type EventProps = Record<string, unknown>;

interface AnalyticsClient {
  track(event: string, props?: EventProps): void;
}

interface AttrElement {
  getAttribute(name: string): string | null;
}

let client: AnalyticsClient | null = null;

function ctaPropsFromEl(el: AttrElement): EventProps {
  return {
    label: el.getAttribute('data-mp-cta') ?? undefined,
    href: el.getAttribute('href') ?? undefined,
  };
}

function initAnalytics(opts: { token?: string; client?: AnalyticsClient } = {}): boolean {
  if (client) return true;

  if (opts.client) {
    client = opts.client;
    return true;
  }

  const token = opts.token ?? import.meta.env.PUBLIC_MIXPANEL_TOKEN;
  if (!token) return false;

  mixpanel.init(token, { track_pageview: false, persistence: 'localStorage' });
  client = mixpanel as AnalyticsClient;
  return true;
}

function track(event: MixpanelEvent, props?: EventProps): void {
  if (!client) return;
  client.track(event, props);
}

function resetAnalytics(): void {
  client = null;
}

export { MixpanelEvent, initAnalytics, track, ctaPropsFromEl, resetAnalytics };
export type { AnalyticsClient, EventProps, AttrElement };
