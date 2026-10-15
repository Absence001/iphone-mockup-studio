export const CLARITY_PROJECT_ID = "yy55bnhv3e";

export type AnalyticsEvent = "editor_active" | "mockup_export_png" | "mockup_export_video";

declare global {
  interface Window {
    clarity?: (command: "event", event: AnalyticsEvent) => void;
  }
}

export const clarityScript = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${CLARITY_PROJECT_ID}");`;

/** Блокировщик аналитики или ошибка стороннего скрипта не мешают редактору. */
export function trackAnalyticsEvent(event: AnalyticsEvent): boolean {
  if (typeof window === "undefined" || !window.clarity) return false;
  try { window.clarity("event", event); return true; } catch { return false; }
}
