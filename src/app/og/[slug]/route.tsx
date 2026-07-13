import { ImageResponse } from "next/og";
import { getSpecialty, SPECIALTY_SLUGS } from "@/lib/specialty-data";

export const runtime = "edge";

export function generateStaticParams() {
  return SPECIALTY_SLUGS.map((slug) => ({ slug }));
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const specialty = getSpecialty(params.slug);
  const title = specialty?.name ?? "DaleControl";
  const subtitle = specialty
    ? `Software para ${specialty.name.toLowerCase()} en México`
    : "Software para clínicas en México";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #0B0815 0%, #1a0b2e 50%, #0B0815 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "32px" }}>
          {/* Isotipo de marca (kit "logo 105"): capas apiladas blancas sobre degradado morado→azul. */}
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "linear-gradient(135deg, #7C3AED, #2563EB)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="44" height="44" viewBox="0 0 36 36" fill="none">
              <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="rgba(255,255,255,.18)" stroke="#ffffff" strokeWidth="2.4" strokeLinejoin="round" />
              <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
            </svg>
          </div>
          <span style={{ color: "white", fontSize: "36px", fontWeight: 700 }}>DaleControl</span>
        </div>
        <div
          style={{
            color: "white",
            fontSize: "52px",
            fontWeight: 800,
            textAlign: "center",
            maxWidth: "900px",
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: "#a78bfa",
            fontSize: "24px",
            marginTop: "16px",
            textAlign: "center",
          }}
        >
          {subtitle}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
