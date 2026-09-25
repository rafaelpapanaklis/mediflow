import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { HERO } from "./landing-data";
import { HeroStage } from "./hero-stage";
import { IconoPanel } from "./icono-panel";
import { instrumentSans, materialSymbols } from "@/fonts/menu";
import "./hero-3d-v2.css";

/**
 * Hero del diseño v4: degradado oscuro con trama de puntos + prisma 3D de 5
 * caras girando (CSS puro, sin WebGL ni librerías).
 *
 * v2 de las caras (25-sep-2026): estética del panel real (tokens, Instrument
 * Sans, íconos Material Symbols). Las dos fuentes van SIN precarga en
 * `src/fonts/menu.ts`, así que no pesan en el LCP: el navegador las pide al
 * pintar el prisma.
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

/*
 * Las cinco caras, v2 (25-sep-2026): cada una es una ventanita del panel
 * real —cabecera con ícono Material Symbols, título y línea gris, cuerpo
 * #f4f3f8 con tarjetas blancas— en Instrument Sans. Los estilos viven en
 * hero-3d-v2.css (prefijo `dch3-`). Son decorativas: el escenario entero va
 * `aria-hidden` (hero-stage.tsx).
 */

function Top({ icono, tono, title, sub }: { icono: string; tono?: "cyan" | "violet"; title: string; sub: string }) {
  return (
    <div className="dch3-top">
      <span className={`dch3-ico${tono ? ` dch3-ico--${tono}` : ""}`}><IconoPanel nombre={icono} size={15} /></span>
      <span className="dch3-ttl">
        <span className="dch3-t">{title}</span>
        <span className="dch3-s">{sub}</span>
      </span>
    </div>
  );
}

function AgendaFace() {
  return (
    <div className="dch3-face">
      <Top icono="calendar_month" title="Agenda" sub="Jueves 26 · Dra. Ruiz · Sillón 1" />
      <div className="dch3-body">
        <div className="dch3-row"><span className="dch3-hora">10:00</span><span className="dch3-cita dch3-cita--ok">Ana Torres<b>Limpieza · confirmada</b></span></div>
        <div className="dch3-row"><span className="dch3-hora">11:30</span><span className="dch3-cita dch3-cita--blue">J. Medina<b>Endodoncia</b></span></div>
        <div className="dch3-row"><span className="dch3-hora">12:15</span><span className="dch3-cita dch3-cita--pink">L. Paredes<b>Ortodoncia</b></span></div>
        <div className="dch3-row"><span className="dch3-hora">13:00</span><span className="dch3-cita dch3-cita--free">Hueco libre · lista de espera</span></div>
        <div className="dch3-row"><span className="dch3-hora">14:00</span><span className="dch3-cita dch3-cita--amber">S. Ruiz<b>Pediatría · reserva en línea</b></span></div>
        <div className="dch3-toast">
          <span className="dch3-toast__wa">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.2-.2-.2-.4-.3Z" /></svg>
          </span>
          <span className="dch3-toast__tx"><b>Recordatorio enviado</b> · hace 1 min</span>
          <span className="dch3-toast__ok"><IconoPanel nombre="check" size={12} /></span>
        </div>
      </div>
    </div>
  );
}

function WhatsappFace() {
  return (
    <div className="dch3-face dch3-wa">
      <div className="dch3-top">
        <span className="dch3-wa__avatar">CA</span>
        <span className="dch3-ttl">
          <span className="dch3-t">Clínica Altabrisa</span>
          <span className="dch3-s">Cuenta de empresa · el bot contesta 24/7</span>
        </span>
      </div>
      <div className="dch3-body">
        <span className="dch3-wa__b is-in">Hola, ¿tienen espacio para limpieza esta semana?<span className="dch3-wa__meta">22:41</span></span>
        <span className="dch3-wa__b is-out">¡Claro! Jueves 12:00 o viernes 10:30. ¿Cuál prefieres?<span className="dch3-wa__meta">22:41 <i className="dch3-wa__ticks">✓✓</i></span></span>
        <span className="dch3-wa__b is-in">Viernes 10:30<span className="dch3-wa__meta">22:42</span></span>
        <span className="dch3-wa__b is-out">Listo, quedó agendada. Te recuerdo un día antes.<span className="dch3-wa__meta">22:42 <i className="dch3-wa__ticks">✓✓</i></span></span>
        <span className="dch3-chip dch3-chip--ok dch3-wa__sys"><IconoPanel nombre="check" size={11} /> El bot agendó · vie 10:30 · Limpieza</span>
        <div className="dch3-wa__input">
          <span className="dch3-wa__field">Escribe un mensaje</span>
          <span className="dch3-wa__send"><IconoPanel nombre="arrow_upward" size={12} /></span>
        </div>
      </div>
    </div>
  );
}

function Modelos3dFace() {
  return (
    <div className="dch3-face dch3-face--dark dch3-face--glow dch3-3d">
      <Top icono="dentistry" tono="cyan" title="Modelos 3D" sub="CBCT y escáner en tu navegador" />
      <div className="dch3-body">
        {/* ⛔ La imagen del CBCT es LA MISMA de siempre (src, medidas, sizes);
            sólo cambia el marco. Cara 3 de 5: arranca girada hacia atrás, así
            que NO es el LCP y no lleva `priority`. */}
        <span className="dch3-3d__view">
          <Image
            src="/landing/rx-3d.webp"
            alt=""
            width={349}
            height={316}
            sizes="240px"
            style={{ width: "100%", aspectRatio: "16 / 10", height: "auto", objectFit: "cover", display: "block" }}
          />
        </span>
        <span className="dch3-3d__views">
          {["Axial", "Coronal", "Sagital", "3D"].map((v) => (
            <span key={v} className={`dch3-3d__view${v === "3D" ? " is-on" : ""}`}>{v}</span>
          ))}
        </span>
        <span className="dch3-3d__foot">
          {["STL", "PLY", "OBJ"].map((f) => (
            <span key={f} className="dch3-fmt">{f}</span>
          ))}
          <span className="dch3-live">Auto-rotar</span>
        </span>
      </div>
    </div>
  );
}

function CobrosFace() {
  return (
    <div className="dch3-face">
      <Top icono="point_of_sale" title="Caja" sub="Presupuesto #1042 · Ana Torres" />
      <div className="dch3-body">
        <span className="dch3-card">
          <span className="dch3-line"><span>Corona zirconia ×2</span><b>$9,600</b></span>
          <span className="dch3-line dch3-line--disc"><span>Descuento 10 %</span><b>−$1,340</b></span>
          <span className="dch3-total"><span>Total · 3 pagos</span><b>$12,060 MXN</b></span>
          <span className="dch3-bar"><i /></span>
        </span>
        <span className="dch3-card dch3-estado">
          <span className="dch3-estado__r"><span>Pagado</span><b>$8,040</b></span>
          <span className="dch3-estado__r is-dim"><span>Saldo pendiente</span><b>$4,020</b></span>
        </span>
        <span className="dch3-chip dch3-chip--ok"><IconoPanel nombre="check" size={11} /> Firmado por el paciente</span>
        <span className="dch3-btn"><IconoPanel nombre="summarize" size={12} /> Facturar automático</span>
      </div>
    </div>
  );
}

function AsistenteFace() {
  const prompts: [string, string, string][] = [
    ["monitor_heart", "Diagnóstico diferencial", "Síntomas X/Y/Z, dame DDx"],
    ["assignment", "Redactar nota SOAP", "Estructura la nota de evolución"],
    ["history", "Resumir historia", "Lo relevante del expediente, en 5 líneas"],
  ];
  return (
    <div className="dch3-face dch3-face--dark dch3-face--violet">
      <Top icono="auto_awesome" tono="violet" title="Asistente IA" sub="Trabaja mientras atiendes" />
      <div className="dch3-body">
        {prompts.map(([icono, title, sub]) => (
          <span key={title} className="dch3-card">
            <span className="dch3-ia__t"><IconoPanel nombre={icono} size={12} /> {title}</span>
            <span className="dch3-ia__s">{sub}</span>
          </span>
        ))}
        <span className="dch3-ia__chips">
          <span className="dch3-chip dch3-chip--ia">/soap</span>
          <span className="dch3-chip dch3-chip--ia">/receta</span>
        </span>
        <span className="dch3-ia__input"><span>Pregúntame o escribe /</span><i><IconoPanel nombre="arrow_upward" size={11} /></i></span>
        <span className="dch3-ia__note">La IA asiste, el doctor decide</span>
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
      className={`${instrumentSans.variable} ${materialSymbols.variable}`}
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

        <h1 className="dcv4-balance" style={{ marginTop: 20, fontSize: "clamp(34px,4.8vw,60px)", lineHeight: 1.03, letterSpacing: "-0.042em", fontWeight: 700, color: "#ffffff", maxWidth: "17em" }}>
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

        {/* Pie del prisma. Va en flujo y SIN alto reservado: el alto del hero lo
            fija el prisma (min-height de HeroStage), no esta línea, así que el
            copy puede acortarse sin dejar hueco. La medida se ajustó a 40ch
            cuando el pie pasó de 3 líneas a una. */}
        <p style={{ marginTop: 14, fontSize: 12.5, color: "#94a3b8", maxWidth: "40ch" }}>
          {HERO.caption}
          <span style={{ color: "#cbd5e1" }}>{HERO.captionAccent}</span>
        </p>
      </div>
    </section>
  );
}
