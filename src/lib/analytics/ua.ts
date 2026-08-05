// Parser de user-agent minimalista (sin dependencias) para buckets de analítica.
// No pretende exactitud forense: clasifica device/browser/os en categorías útiles.

export type DeviceKind = "mobile" | "tablet" | "desktop" | "bot";

export interface ParsedUA {
  device: DeviceKind;
  browser: string;
  os: string;
}

// Detector ÚNICO de bots del repo. Lo consumen la analítica general
// (/api/track) y el conteo de clics de afiliados (/r, /socio, /api/afiliados/track).
// Ampliarlo aquí beneficia a las dos: no dupliques esta lista en otro archivo.
//
// `bot` genérico ya cubre a TelegramBot, Slackbot, Twitterbot, LinkedInBot,
// Discordbot, Applebot, GPTBot, AhrefsBot… y `preview` a BingPreview y
// SkypeUriPreview. Lo que sigue son los que NO llevan "bot" en el nombre:
// generadores de vista previa de enlaces y clientes HTTP de servidor.
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest\/|vercel|lighthouse|headless|preview|monitor|scan|curl|wget|python-requests|go-http|axios|okhttp|node-fetch|undici|apache-httpclient|java\/|postman|insomnia|libwww|slack-imgproxy|discourse|googleother|google-inspectiontool|mediapartners|feedfetcher|pingdom|datadog|betterstack|checkly|statuscake/;

// WhatsApp aparte y ANCLADO: el generador de vista previa se identifica como
// "WhatsApp/2.23.20.0 A" —el UA entero empieza por WhatsApp/—, mientras que el
// navegador integrado de WhatsApp lleva "WhatsApp/2.x" al FINAL de un UA normal
// con prefijo "Mozilla/5.0 (…)". Ese segundo es una PERSONA, y en México es de
// los caminos más comunes para abrir un link: buscar "whatsapp" suelto tiraría
// clics reales a la basura.
const WHATSAPP_PREVIEW_RE = /^whatsapp\//;

export function parseUserAgent(ua: string | null | undefined): ParsedUA {
  const s = (ua || "").toLowerCase();
  if (!s) return { device: "desktop", browser: "Unknown", os: "Unknown" };

  if (BOT_RE.test(s) || WHATSAPP_PREVIEW_RE.test(s)) {
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
