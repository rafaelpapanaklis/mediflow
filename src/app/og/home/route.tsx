import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * OG del home (reemplaza al viejo /og-home.png estático que aún decía
 * "MediFlow"). Marca nueva (kit "logo 105"): capas apiladas morado→azul.
 * Mismo layout en espíritu que el estático: claro, badge MX, titular bicolor.
 */
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #ffffff 0%, #f6f2ff 55%, #eef2ff 100%)",
          fontFamily: "system-ui, sans-serif",
          padding: "56px 64px",
          position: "relative",
        }}
      >
        {/* Marca de agua: isotipo grande a la derecha */}
        <svg
          width="380"
          height="380"
          viewBox="0 0 36 36"
          fill="none"
          style={{ position: "absolute", right: "24px", top: "150px", opacity: 0.16 }}
        >
          <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="#efeafe" stroke="#7C3AED" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke="#7C3AED" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke="#2563EB" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".45" />
        </svg>

        {/* Lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              width: "58px",
              height: "58px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #7C3AED, #2563EB)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 36 36" fill="none">
              <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="rgba(255,255,255,.18)" stroke="#ffffff" strokeWidth="2.4" strokeLinejoin="round" />
              <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: "40px", fontWeight: 700, letterSpacing: "-1px" }}>
            <span style={{ color: "#7C3AED" }}>Dale</span>
            <span style={{ color: "#17151F" }}>Control</span>
          </div>
        </div>

        {/* Titular */}
        <div style={{ display: "flex", flexDirection: "column", maxWidth: "820px" }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              background: "#f1e9ff",
              color: "#6d28d9",
              fontSize: "22px",
              fontWeight: 700,
              padding: "8px 22px",
              borderRadius: "999px",
              marginBottom: "26px",
            }}
          >
            Hecho en México · CFDI 4.0 nativo
          </div>
          <div style={{ color: "#17151F", fontSize: "72px", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-2px" }}>
            Toda tu clínica dental
          </div>
          <div style={{ color: "#7C3AED", fontSize: "72px", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-2px" }}>
            en una sola plataforma
          </div>
          <div style={{ color: "#3f3f50", fontSize: "30px", marginTop: "24px" }}>
            Agenda · Odontograma · Radiografías con IA · CFDI 4.0
          </div>
        </div>

        {/* Pie */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#5b5b6e", fontSize: "24px", fontWeight: 600 }}>
          <svg width="30" height="20" viewBox="0 0 30 20">
            <rect width="10" height="20" fill="#006847" />
            <rect x="10" width="10" height="20" fill="#ffffff" />
            <rect x="20" width="10" height="20" fill="#ce1126" />
          </svg>
          Clínicas dentales de todo México · dalecontrol.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
