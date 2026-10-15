"use client";

import { useEffect } from "react";
import Script from "next/script";
import { clarityScript, trackAnalyticsEvent } from "@/lib/analytics";

export function ClarityAnalytics({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    let lastActiveMinute = -1;
    const active = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      if (!(event.target instanceof Element) || !(event.target.closest(".studio-shell") || event.target === document.body)) return;
      // Не чаще одного события в календарную минуту. После полуночи новое
      // взаимодействие учитывается и у тех, кто оставил вкладку открытой.
      const minute = Math.floor(Date.now() / 60000);
      if (minute !== lastActiveMinute && trackAnalyticsEvent("editor_active")) lastActiveMinute = minute;
    };
    const events = ["pointerdown", "keydown", "wheel", "paste", "drop"] as const;
    for (const name of events) document.addEventListener(name, active, { capture: true, passive: true });
    return () => { for (const name of events) document.removeEventListener(name, active, { capture: true }); };
  }, []);

  return enabled ? <Script id="microsoft-clarity" strategy="afterInteractive">{clarityScript}</Script> : null;
}
