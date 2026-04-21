import { ImageResponse } from "next/og";
import { getSpecialty, SPECIALTY_SLUGS } from "@/lib/specialty-data";

export const runtime = "edge";

export function generateStaticParams() {
  return SPECIALTY_SLUGS.map((slug) => ({ slug }));
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const specialty = getSpecialty(params.slug);
  const title = specialty?.name ?? "MediFlow";
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
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "linear-gradient(135deg, #7C3AED, #a78bfa)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "32px",
              fontWeight: 800,
            }}
          >
            M
          </div>
          <span style={{ color: "white", fontSize: "36px", fontWeight: 700 }}>MediFlow</span>
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
