// Clinical-shared — generación de tarjeta de cumpleaños como SVG.
//
// Decidimos SVG en vez de canvas por:
//   1. No requiere que el navegador esté presente (puede generarse
//      server-side y servirse como image/svg+xml o convertirse a PNG).
//   2. Texto crisp en cualquier resolución (tablet, móvil, impresión).
//   3. Sin dependencias externas — solo string concatenation.
//
// El builder devuelve un string SVG válido para embeber con
// data:image/svg+xml;base64,... o servir desde un endpoint.

export interface BirthdayCardData {
  childName: string;
  ageTurning: number;
  clinicName: string;
  /** ISO date string del cumpleaños — se formatea es-MX. */
  birthdayDate: string;
  /** Color principal (default morado MediFlow). */
  primaryColor?: string;
  /** Color secundario (default rosa pastel). */
  accentColor?: string;
  /** URL del logo de la clínica (opcional). */
  clinicLogoUrl?: string | null;
}

const PRIMARY_DEFAULT = "#7c3aed";
const ACCENT_DEFAULT = "#f9a8d4";

/**
 * Devuelve el SVG (string) listo para embeber. Tamaño 800×500.
 */
export function buildBirthdayCardSvg(data: BirthdayCardData): string {
  const primary = sanitizeColor(data.primaryColor ?? PRIMARY_DEFAULT);
  const accent = sanitizeColor(data.accentColor ?? ACCENT_DEFAULT);
  const safeName = escapeXml(data.childName);
  const safeClinic = escapeXml(data.clinicName);
  const dateStr = formatDate(data.birthdayDate);

  // Globos decorativos (4 en esquinas opuestas).
  const balloons = [
    { cx: 80, cy: 90, r: 28, fill: accent, hue: -10 },
    { cx: 720, cy: 110, r: 24, fill: primary, hue: 8 },
    { cx: 110, cy: 410, r: 22, fill: primary, hue: 14 },
    { cx: 700, cy: 410, r: 30, fill: accent, hue: -6 },
  ];

  const balloonElements = balloons
    .map(
      (b, i) => `
    <g opacity="0.85">
      <circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="${b.fill}" />
      <line x1="${b.cx}" y1="${b.cy + b.r}" x2="${b.cx + (i % 2 ? 6 : -6)}" y2="${b.cy + b.r + 30}" stroke="${b.fill}" stroke-width="1.5" />
    </g>`,
    )
    .join("\n");

  const logo = data.clinicLogoUrl
    ? `<image href="${escapeXml(data.clinicLogoUrl)}" x="40" y="430" width="48" height="48" preserveAspectRatio="xMidYMid meet" />`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${primary}" stop-opacity="0.10"/>
    </linearGradient>
    <linearGradient id="cake" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="${primary}"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="800" height="500" rx="24" fill="white"/>
  <rect x="0" y="0" width="800" height="500" rx="24" fill="url(#bg)"/>

  ${balloonElements}

  <g transform="translate(400 90)" text-anchor="middle">
    <text font-family="Helvetica, Arial, sans-serif" font-size="22" fill="${primary}" font-weight="700" letter-spacing="3">
      ¡FELIZ CUMPLEAÑOS!
    </text>
  </g>

  <g transform="translate(400 175)" text-anchor="middle">
    <text font-family="Helvetica, Arial, sans-serif" font-size="56" fill="#1f1235" font-weight="800">
      ${safeName}
    </text>
  </g>

  <g transform="translate(400 235)" text-anchor="middle">
    <text font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#4b3a6f">
      ${ageBlurb(data.ageTurning)}
    </text>
  </g>

  <!-- Pastel ilustrativo -->
  <g transform="translate(360 280)">
    <rect x="0" y="40" width="80" height="50" rx="6" fill="url(#cake)"/>
    <rect x="-10" y="32" width="100" height="14" rx="4" fill="${accent}"/>
    <line x1="40" y1="20" x2="40" y2="32" stroke="${primary}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="40" cy="14" r="6" fill="${accent}"/>
  </g>

  <g transform="translate(400 420)" text-anchor="middle">
    <text font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#4b3a6f">
      ${dateStr}
    </text>
    <text y="22" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${primary}" font-weight="600">
      ${safeClinic}
    </text>
  </g>

  ${logo}
</svg>`.trim();
}

/**
 * Devuelve un data: URL listo para descargar/incrustar.
 */
export function buildBirthdayCardDataUrl(data: BirthdayCardData): string {
  const svg = buildBirthdayCardSvg(data);
  // base64 estable (Node + browser).
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}

function ageBlurb(years: number): string {
  if (years <= 0) return "tu primer cumpleaños";
  if (years === 1) return "cumples 1 año";
  return `cumples ${years} años`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
function sanitizeColor(c: string): string {
  if (HEX_RE.test(c)) return c;
  // Fallback al color por defecto si no es hex válido (evita XSS por
  // inyección en atributos SVG).
  return PRIMARY_DEFAULT;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
