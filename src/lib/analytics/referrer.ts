// Clasificación de referrer / canal de adquisición (servidor).

export type ReferrerType =
  | "direct"
  | "search"
  | "social"
  | "ads"
  | "referral"
  | "internal";

export function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function classifyReferrer(opts: {
  referrer?: string | null;
  selfHost?: string | null;
  utmMedium?: string | null;
  utmSource?: string | null;
  gclid?: string | null;
}): { host: string | null; type: ReferrerType } {
  const host = hostOf(opts.referrer);
  const medium = (opts.utmMedium || "").toLowerCase();
  const self = (opts.selfHost || "").replace(/^www\./, "").toLowerCase();

  // Pago primero: gclid o medium tipo cpc/paid gana sobre el host.
  if (opts.gclid || /\b(cpc|ppc|paid|paidsearch|display|cpm|retargeting)\b/.test(medium)) {
    return { host, type: "ads" };
  }
  if (!host) return { host: null, type: "direct" };
  if (self && host === self) return { host, type: "internal" };

  if (/(^|\.)(google|bing|yahoo|duckduckgo|yandex|ecosia|baidu|ask|aol|brave)\./.test(host)) {
    return { host, type: "search" };
  }
  if (
    /(^|\.)(facebook|fb|instagram|twitter|x\.com|linkedin|tiktok|youtube|pinterest|reddit|whatsapp|telegram|threads)\b/.test(
      host,
    ) ||
    host === "t.co" ||
    host === "lnkd.in" ||
    host === "l.facebook.com"
  ) {
    return { host, type: "social" };
  }
  return { host, type: "referral" };
}
