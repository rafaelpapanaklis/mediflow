import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * OG dinámica de los artículos del blog — mismo patrón e identidad que
 * /og/[slug] (fondo oscuro, isotipo de capas apiladas, titular grande).
 *
 * El título viaja por query (`/og/blog?title=…`) en vez de por segmento
 * porque esta ruta corre en el Edge y Prisma NO corre ahí: no hay forma de
 * resolver el slug contra la BD. Quien construye la metadata (la ficha del
 * artículo, que sí es Node) ya tiene el título a la mano.
 *
 * OJO: es un segmento ESTÁTICO bajo /og/, así que /og/blog no colisiona con
 * /og/[slug] (que sólo cubre las 17 especialidades) — Next resuelve estático
 * antes que dinámico.
 */

const MAX_TITLE = 110;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("title") ?? "";
  const clean = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  const title = clean || "Blog DaleControl";
  // Títulos largos con la misma caja se ven apretados: bajamos el cuerpo.
  const fontSize = title.length > 70 ? 42 : title.length > 45 ? 50 : 58;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background: "linear-gradient(135deg, #0B0815 0%, #1a0b2e 50%, #0B0815 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #7C3AED, #2563EB)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="38" height="38" viewBox="0 0 36 36" fill="none">
              <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="rgba(255,255,255,.18)" stroke="#ffffff" strokeWidth="2.4" strokeLinejoin="round" />
              <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
            </svg>
          </div>
          <span style={{ color: "white", fontSize: "30px", fontWeight: 700 }}>DaleControl</span>
        </div>

        <div
          style={{
            display: "flex",
            color: "white",
            fontSize: `${fontSize}px`,
            fontWeight: 800,
            lineHeight: 1.18,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "36px", height: "4px", borderRadius: "999px", background: "#7C3AED" }} />
          <span style={{ color: "#a78bfa", fontSize: "24px", fontWeight: 600 }}>
            Blog DaleControl
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
