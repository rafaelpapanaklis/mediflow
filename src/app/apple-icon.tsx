import { ImageResponse } from "next/og";

// Edge: evita el bug de @vercel/og en Node (fileURLToPath "Invalid URL" al cargar
// la fuente por defecto durante el prerender estático en Windows) y genera el
// icono on-demand cacheado. Es la vía recomendada para next/og.
export const runtime = "edge";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Apple touch icon DaleControl (iOS): mismo isotipo que icon.tsx, a 180x180.
// Fondo EXACTO de .mfh-logo__mark (sales.css): linear-gradient(150deg, #7c3aed, #6d28d9).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#6d28d9",
          backgroundImage: "linear-gradient(150deg, #7c3aed 0%, #6d28d9 100%)",
          borderRadius: 42,
        }}
      >
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 3.2c-2 0-3-1-5-1C4.7 2.2 3 4 3 7c0 2.3.8 3.7 1.4 6 .5 1.9.7 4.3 1.5 6.4.4 1 .9 1.6 1.6 1.6.9 0 1.2-.9 1.4-2 .3-1.4.5-3 1.6-3s1.3 1.6 1.6 3c.2 1.1.5 2 1.4 2 .7 0 1.2-.6 1.6-1.6.8-2.1 1-4.5 1.5-6.4C20.2 10.7 21 9.3 21 7c0-3-1.7-4.8-4-4.8-2 0-3 1-5 1Z"
            fill="#ffffff"
          />
        </svg>
      </div>
    ),
    { ...size }
  );
}
