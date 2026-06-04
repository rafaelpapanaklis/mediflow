import { ImageResponse } from "next/og";

// OG/social preview de la HOME (1200×630). Marca clara: blanco + violeta.
// Convención de archivo de Next → sirve como imagen OG por defecto del sitio.
// Las páginas /[slug] siguen usando su OG dinámico propio (/og/[slug]), que
// sobreescribe esta por su openGraph.images explícito. No rompe su SEO.
export const runtime = "edge";
export const alt = "MediFlow — El software todo-en-uno para clínicas en México";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "#ffffff",
          backgroundImage:
            "radial-gradient(900px 500px at 85% -10%, rgba(124,58,237,0.12), transparent 60%), radial-gradient(700px 500px at 0% 110%, rgba(167,139,250,0.10), transparent 60%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "30px",
              fontWeight: 700,
            }}
          >
            M
          </div>
          <span style={{ color: "#15131d", fontSize: "34px", fontWeight: 600, letterSpacing: "-0.02em" }}>
            MediFlow
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: "#15131d",
              fontSize: "62px",
              fontWeight: 600,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
              maxWidth: "960px",
            }}
          >
            El sistema todo-en-uno para clínicas mexicanas.
          </div>
          <div style={{ color: "#57546a", fontSize: "28px", marginTop: "22px", maxWidth: "900px", lineHeight: 1.4 }}>
            Agenda, WhatsApp, expediente, CFDI 4.0 e IA — en una sola plataforma.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {["800+ clínicas", "CFDI 4.0 · NOM-024", "Soporte en español"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                fontSize: "20px",
                color: "#6d28d9",
                background: "rgba(124,58,237,0.08)",
                border: "1px solid rgba(124,58,237,0.18)",
                borderRadius: "100px",
                padding: "10px 18px",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
