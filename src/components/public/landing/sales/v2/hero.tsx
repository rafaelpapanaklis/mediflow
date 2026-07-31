import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { HERO } from "./landing-data";
import { HeroStage } from "./hero-stage";

/**
 * Hero del diseño v4: degradado oscuro con trama de puntos + prisma 3D de 5
 * caras girando (CSS puro, sin WebGL ni librerías).
 *
 * SE QUEDA EN SSR: es el bloque LCP. El único JS que trae es el paralaje del
 * mouse (hero-stage.tsx), que recibe estas tarjetas como children ya
 * renderizadas en el servidor.
 */

/** Una cara del prisma: se coloca a `deg` y se empuja hacia fuera con translateZ. */
function Face({ deg, children }: { deg: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `rotateY(${deg}deg) translateZ(clamp(158px,30vw,205px))`,
        backfaceVisibility: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const cardLight: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
  borderRadius: 14,
  boxShadow: "0 26px 46px -22px rgba(2,6,23,0.9)",
  overflow: "hidden",
};

const cardDark: CSSProperties = {
  ...cardLight,
  background: "#0b1220",
  border: "1px solid rgba(103,232,249,0.45)",
};

const headLight: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 11px",
  background: "linear-gradient(90deg,#f8fafc,#ffffff)",
  borderBottom: "1px solid #eef2f7",
};

const headDark: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 11px",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

function Glyph({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: 22, height: 22, borderRadius: 6, background: bg, color: "#ffffff", fontSize: 9.5, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}
    >
      {children}
    </span>
  );
}

function Titles({ title, sub, dark }: { title: string; sub: string; dark?: boolean }) {
  return (
    <span style={{ minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: dark ? "#ffffff" : "#0f172a" }}>{title}</span>
      <span style={{ display: "block", fontSize: 8, color: dark ? "#94a3b8" : "#475569" }}>{sub}</span>
    </span>
  );
}

const body: CSSProperties = { display: "block", flex: 1, padding: "9px 10px" };
const slot: CSSProperties = { display: "flex", gap: 5, alignItems: "center" };

function AgendaFace() {
  const rows: [string, string, string, string][] = [
    ["10:00", "#dcfce7", "#166534", "Ana Torres · Limpieza ✓"],
    ["11:30", "#dbeafe", "#1e40af", "J. Medina · Endodoncia"],
    ["12:15", "#ede9fe", "#5b21b6", "L. Paredes · Ortodoncia"],
  ];
  return (
    <div style={cardLight}>
      <div style={headLight}>
        <Glyph bg="#7c3aed">▦</Glyph>
        <Titles title="Agenda inteligente" sub="Citas por doctor y sillón" />
      </div>
      <div style={body}>
        {rows.map(([hour, bg, fg, label], i) => (
          <div key={hour} style={{ ...slot, marginTop: i === 0 ? 0 : 5 }}>
            <span style={{ fontSize: 8, color: "#64748b" }}>{hour}</span>
            <span style={{ flex: 1, background: bg, borderRadius: 4, padding: "4px 6px", fontSize: 8, fontWeight: 700, color: fg }}>{label}</span>
          </div>
        ))}
        <div style={{ ...slot, marginTop: 5 }}>
          <span style={{ fontSize: 8, color: "#64748b" }}>13:00</span>
          <span style={{ flex: 1, border: "1px dashed #c4b5fd", borderRadius: 4, padding: "4px 6px", fontSize: 8, fontWeight: 700, color: "#6d28d9" }}>Hueco libre · lista de espera</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, background: "#f0fdf4", border: "1px solid #dcfce7", borderRadius: 6, padding: "5px 7px" }}>
          <span aria-hidden="true" style={{ width: 13, height: 13, borderRadius: "50%", background: "#dcfce7", color: "#15803d", fontSize: 7, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>✓</span>
          <span style={{ fontSize: 7.5, color: "#334155" }}><strong>Recordatorio enviado</strong> · hace 1 min</span>
        </div>
      </div>
    </div>
  );
}

function WhatsappFace() {
  return (
    <div style={cardDark}>
      <div style={headDark}>
        <Glyph bg="#15803d">W</Glyph>
        <Titles dark title="WhatsApp con bot IA" sub="Agenda y confirma 24/7" />
      </div>
      <div style={body}>
        <span style={{ display: "block", background: "rgba(255,255,255,0.1)", borderRadius: "8px 8px 8px 2px", padding: "5px 7px", fontSize: 8, color: "#e2e8f0", width: "92%" }}>Hola, ¿tienen espacio para limpieza esta semana?</span>
        <span style={{ display: "block", background: "#dcfce7", borderRadius: "8px 8px 2px 8px", padding: "5px 7px", fontSize: 8, color: "#14532d", marginTop: 4, width: "86%", marginLeft: "auto" }}>¡Claro! Jueves 12:00 o viernes 10:30 🦷</span>
        <span style={{ display: "block", background: "rgba(255,255,255,0.1)", borderRadius: "8px 8px 8px 2px", padding: "5px 7px", fontSize: 8, color: "#e2e8f0", marginTop: 4, width: "56%" }}>Viernes 10:30 👍</span>
        <span style={{ display: "block", marginTop: 8, fontSize: 7.5, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 999, padding: "4px 7px", textAlign: "center" }}>✓ El bot agendó: viernes 10:30 · Limpieza</span>
      </div>
    </div>
  );
}

function Modelos3dFace() {
  return (
    <div style={{ ...cardDark, boxShadow: "0 26px 46px -22px rgba(2,6,23,0.9),0 0 26px -6px rgba(34,211,238,0.5)" }}>
      <div style={headDark}>
        <Glyph bg="#0e7490">3D</Glyph>
        <Titles dark title="Modelos 3D" sub="CBCT y escáner en tu navegador" />
      </div>
      <div style={body}>
        {/* Cara 3 de 5: arranca girada hacia atrás, así que NO es el LCP y no
            lleva `priority` (compite con el H1). Al estar dentro del viewport,
            el lazy de next/image la pide igual desde el primer frame. */}
        <Image
          src="/landing/rx-3d.webp"
          alt=""
          width={349}
          height={316}
          sizes="240px"
          style={{ width: "100%", aspectRatio: "16 / 10", height: "auto", objectFit: "cover", display: "block", borderRadius: 8 }}
        />
        <span style={{ display: "flex", gap: 3, marginTop: 6, alignItems: "center" }}>
          {["STL", "PLY", "OBJ"].map((f) => (
            <span key={f} style={{ fontSize: 7, fontWeight: 700, color: "#0e7490", background: "#ecfeff", border: "1px solid #a5f3fc", borderRadius: 4, padding: "2px 6px" }}>{f}</span>
          ))}
          <span style={{ fontSize: 7, fontWeight: 700, color: "#15803d", marginLeft: "auto" }}>● Auto-rotar</span>
        </span>
      </div>
    </div>
  );
}

function CobrosFace() {
  return (
    <div style={cardLight}>
      <div style={headLight}>
        <Glyph bg="#1d4ed8">$</Glyph>
        <Titles title="Cobros y facturación" sub="Del presupuesto al pago" />
      </div>
      <div style={body}>
        <span style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#334155", borderBottom: "1px solid #f1f5f9", paddingBottom: 4 }}>
          <span>Corona zirconia ×2</span><strong style={{ color: "#0f172a" }}>$9,600</strong>
        </span>
        <span style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#15803d", borderBottom: "1px solid #f1f5f9", padding: "4px 0" }}>
          <span>Descuento 10%</span><strong>−$1,340</strong>
        </span>
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 5, fontSize: 8, color: "#475569" }}>
          <span>Total · 3 pagos</span><strong style={{ fontSize: 10.5, color: "#0f172a" }}>$12,060 MXN</strong>
        </span>
        <span aria-hidden="true" style={{ display: "block", marginTop: 7, height: 5, borderRadius: 999, background: "linear-gradient(90deg,#15803d 66%,#e2e8f0 66%)" }} />
        <span style={{ display: "block", marginTop: 8, textAlign: "center", fontSize: 8, fontWeight: 700, color: "#ffffff", background: "#7c3aed", borderRadius: 6, padding: "6px 0" }}>Facturar automático</span>
      </div>
    </div>
  );
}

function AsistenteFace() {
  const prompts: [string, string][] = [
    ["⌁ Diagnóstico diferencial", "Síntomas X/Y/Z → dame DDx"],
    ["▤ Redactar nota SOAP", "Estructura la nota de evolución"],
  ];
  return (
    <div style={cardDark}>
      <div style={headDark}>
        <Glyph bg="#6d28d9">✦</Glyph>
        <Titles dark title="Asistente IA" sub="Trabaja mientras atiendes" />
      </div>
      <div style={body}>
        {prompts.map(([title, sub], i) => (
          <span key={title} style={{ display: "block", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "6px 8px", marginTop: i === 0 ? 0 : 5 }}>
            <span style={{ display: "block", fontSize: 8, fontWeight: 700, color: "#fff" }}>{title}</span>
            <span style={{ display: "block", fontSize: 7, color: "#94a3b8" }}>{sub}</span>
          </span>
        ))}
        <span style={{ display: "flex", gap: 3, marginTop: 6 }}>
          <span style={{ fontSize: 7, fontWeight: 700, color: "#6d28d9", background: "#ede9fe", borderRadius: 4, padding: "2px 6px" }}>/soap</span>
          <span style={{ fontSize: 7, fontWeight: 700, color: "#cbd5e1", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, padding: "2px 6px" }}>/receta</span>
        </span>
        <span style={{ display: "block", marginTop: 7, fontSize: 7.5, color: "#94a3b8", background: "rgba(124,58,237,0.16)", borderRadius: 6, padding: "5px 7px" }}>La IA asiste, el doctor decide</span>
      </div>
    </div>
  );
}

const ctaBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 50,
  padding: "0 28px",
  fontWeight: 700,
  fontSize: 16,
  borderRadius: 12,
};

export function Hero({ firstMonthFrom }: { firstMonthFrom: string }) {
  return (
    <section
      id="inicio"
      style={{
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(760px 540px at 82% 4%,rgba(124,58,237,0.4),rgba(124,58,237,0) 64%),radial-gradient(940px 580px at 0% 4%,rgba(37,99,235,0.42),rgba(37,99,235,0) 62%),linear-gradient(160deg,#0b1220 0%,#0e142b 58%,#131a3a 100%)",
      }}
    >
      <div
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.10) 1px,transparent 1px)", backgroundSize: "26px 26px", opacity: 0.55 }}
      />
      <div style={{ position: "relative", maxWidth: 1180, margin: "0 auto", padding: "clamp(34px,4.4vw,60px) 20px clamp(54px,6.5vw,88px)", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "rgba(124,58,237,0.2)", border: "1px solid rgba(167,139,250,0.5)", color: "#c4b5fd", fontSize: 13, fontWeight: 700, borderRadius: 999, padding: "7px 15px" }}>
          <span aria-hidden="true" className="dcv4-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#a78bfa", display: "block" }} />
          {HERO.badge}
        </span>

        <h1 className="dcv4-balance" style={{ marginTop: 20, fontSize: "clamp(34px,4.8vw,60px)", lineHeight: 1.03, letterSpacing: "-0.042em", fontWeight: 800, color: "#ffffff", maxWidth: "17em" }}>
          {HERO.titleLead}{" "}
          <span style={{ background: "linear-gradient(100deg,#60a5fa,#a78bfa)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{HERO.titleAccent}</span>
        </h1>

        <p className="dcv4-pretty" style={{ margin: "18px auto 0", fontSize: "clamp(16px,1.55vw,19px)", lineHeight: 1.6, color: "#cbd5e1", maxWidth: "44ch" }}>{HERO.subtitle}</p>

        <div style={{ marginTop: 26, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <a href="#precios" className="dcv2-btn-primary" style={{ ...ctaBase, boxShadow: "0 16px 34px -12px rgba(37,99,235,0.9)" }}>{HERO.ctaPrimary}</a>
          <a href="#precios" className="dcv4-btn-glass" style={{ ...ctaBase, background: "rgba(255,255,255,0.06)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.4)" }}>{HERO.ctaSecondary}</a>
        </div>

        <ul style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: "8px 20px", justifyContent: "center", fontSize: 14, color: "#cbd5e1" }}>
          {/* El precio del primer mes viene de plan_configs (page.tsx). */}
          <li style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span aria-hidden="true" style={{ color: "#4ade80", fontWeight: 800 }}>✓</span>
            <strong style={{ color: "#e2e8f0", fontWeight: 700 }}>Tu primer mes desde {firstMonthFrom}</strong>
          </li>
          {HERO.bullets.map((b) => (
            <li key={b} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span aria-hidden="true" style={{ color: "#4ade80", fontWeight: 800 }}>✓</span>{b}
            </li>
          ))}
        </ul>

        <HeroStage>
          <Face deg={0}><AgendaFace /></Face>
          <Face deg={72}><WhatsappFace /></Face>
          <Face deg={144}><Modelos3dFace /></Face>
          <Face deg={216}><CobrosFace /></Face>
          <Face deg={288}><AsistenteFace /></Face>
        </HeroStage>

        <p style={{ marginTop: 14, fontSize: 12.5, color: "#94a3b8", maxWidth: "52ch" }}>
          {HERO.caption}
          <span style={{ color: "#cbd5e1" }}>{HERO.captionAccent}</span>
        </p>
      </div>
    </section>
  );
}
