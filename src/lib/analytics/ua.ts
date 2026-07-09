// Parser de user-agent minimalista (sin dependencias) para buckets de analítica.
// No pretende exactitud forense: clasifica device/browser/os en categorías útiles.

export type DeviceKind = "mobile" | "tablet" | "desktop" | "bot";

export interface ParsedUA {
  device: DeviceKind;
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string | null | undefined): ParsedUA {
  const s = (ua || "").toLowerCase();
  if (!s) return { device: "desktop", browser: "Unknown", os: "Unknown" };

  if (
    /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest\/|vercel|lighthouse|headless|preview|monitor|scan|curl|wget|python-requests|go-http|axios/.test(
      s,
    )
  ) {
    return { device: "bot", browser: "Bot", os: "Bot" };
  }

  const isTablet = /ipad|tablet|playbook|silk|kindle|(android(?!.*mobile))/.test(s);
  const isMobile = /iphone|ipod|android.*mobile|windows phone|iemobile|blackberry|bb10|opera mini|mobile/.test(s);
  const device: DeviceKind = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let os = "Unknown";
  if (/windows nt/.test(s)) os = "Windows";
  else if (/android/.test(s)) os = "Android";
  else if (/iphone|ipad|ipod|ios /.test(s)) os = "iOS";
  else if (/mac os x|macintosh/.test(s)) os = "macOS";
  else if (/cros/.test(s)) os = "ChromeOS";
  else if (/linux/.test(s)) os = "Linux";

  let browser = "Unknown";
  if (/edg\//.test(s)) browser = "Edge";
  else if (/opr\/|opera/.test(s)) browser = "Opera";
  else if (/samsungbrowser/.test(s)) browser = "Samsung";
  else if (/(chrome|crios)\//.test(s)) browser = "Chrome";
  else if (/(firefox|fxios)\//.test(s)) browser = "Firefox";
  else if (/safari/.test(s)) browser = "Safari";

  return { device, browser, os };
}
