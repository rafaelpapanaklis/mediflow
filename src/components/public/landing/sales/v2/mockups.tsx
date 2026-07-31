import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

/**
 * Mockups del panel de las 6 tarjetas de "Funciones" + los 3 mini-mockups del
 * trío oscuro. Transcritos 1:1 del diseño aprobado
 * (disenos-landing/Landing-DaleControl.dc.html).
 *
 * Son SERVER COMPONENTS puros (cero estado, cero JS). Los 6 grandes se montan
 * en diferido con `LazyMockup`; los del trío son pequeños y van en SSR.
 *
 * Decorativos: cada uno se monta dentro de un contenedor `aria-hidden`, así que
 * aquí no se repite el atributo.
 */

/* ── Marco común ─────────────────────────────────────────────────────────── */

/**
 * Sólo el `<figure>`. La caja que lo posiciona (ancho máximo, margen superior y
 * el `translateY` que hace que el mockup "asome" por el borde inferior de la
 * tarjeta) vive en funciones.tsx, porque es la MISMA caja que reserva el hueco
 * mientras el mockup está diferido — así el placeholder sólo tiene que
 * reproducir el alto del figure.
 */
export function MockFrame({ shadow, border = "#e2e8f0", background = "#ffffff", children }: { shadow: string; border?: string; background?: string; children: ReactNode }) {
  return (
    <figure className="dcv4-figure" style={{ margin: 0, border: `1px solid ${border}`, borderRadius: 16, background, boxShadow: shadow, overflow: "hidden" }}>
      {children}
    </figure>
  );
}

const dots = (
  <span aria-hidden="true" style={{ display: "flex", gap: 5 }}>
    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#f87171", display: "block" }} />
    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#fbbf24", display: "block" }} />
    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#34d399", display: "block" }} />
  </span>
);

const urlPill: CSSProperties = { flex: "1 1 auto", fontSize: 11, color: "#64748b", background: "#ffffff", border: "1px solid #e8edf4", borderRadius: 6, padding: "4px 9px" };
const chromeBar: CSSProperties = { padding: "10px 14px", background: "#f8fafc", borderBottom: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 8 };
const cell: CSSProperties = { borderRight: "1px solid #f1f5f9", borderBottom: "1px solid #f1f5f9", padding: 3, minHeight: 40 };

/* ── 1 · Agenda semanal ──────────────────────────────────────────────────── */

function Appt({ bg, fg, subFg, title, who }: { bg: string; fg: string; subFg: string; title: string; who: string }) {
  return (
    <span style={{ display: "block", background: bg, borderRadius: 5, padding: "4px 5px", fontSize: 9, fontWeight: 700, color: fg }}>
      {title}
      <span style={{ display: "block", fontWeight: 400, color: subFg }}>{who}</span>
    </span>
  );
}

export function AgendaMock() {
  return (
    <MockFrame shadow="0 34px 60px -34px rgba(37,99,235,0.55)">
      <div style={chromeBar}>
        {dots}
        <span style={urlPill}>app.dalecontrol.com/agenda</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#b91c1c", background: "#fee2e2", borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>⚠ 2 esperando &gt;20m</span>
      </div>
      <div style={{ padding: "11px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, borderBottom: "1px solid #f1f5f9" }}>
        <span style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 2 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "#475569", padding: "4px 8px" }}>Día</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1d4ed8", padding: "4px 8px", borderRadius: 6, background: "#ffffff", boxShadow: "0 1px 2px rgba(15,23,42,0.08)" }}>Semana</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "#475569", padding: "4px 8px" }}>Mes</span>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: "#ffffff", background: "#7c3aed", borderRadius: 7, padding: "5px 10px" }}>+ Nueva cita</span>
      </div>
      <div style={{ overflowX: "auto", scrollbarWidth: "thin" }}>
        <div style={{ minWidth: 440 }}>
          <div style={{ display: "grid", gridTemplateColumns: "40px repeat(5,1fr)", background: "#f8fafc", borderBottom: "1px solid #eef2f7" }}>
            <span />
            {["LUN 29", "MAR 30", "MIÉ 1"].map((d) => (
              <span key={d} style={{ fontSize: 9.5, fontWeight: 700, color: "#475569", padding: 6, textAlign: "center" }}>{d}</span>
            ))}
            <span style={{ fontSize: 9.5, fontWeight: 800, color: "#6d28d9", padding: 6, textAlign: "center", background: "#f5f3ff" }}>JUE 2</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: "#475569", padding: 6, textAlign: "center" }}>VIE 3</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "40px repeat(5,1fr)" }}>
            <span style={{ fontSize: 9, color: "#475569", padding: "7px 5px", borderRight: "1px solid #f1f5f9", borderBottom: "1px solid #f1f5f9" }}>09:00</span>
            <span style={cell}><Appt bg="#ede9fe" fg="#5b21b6" subFg="#6d28d9" title="Limpieza" who="Ana T. ✓" /></span>
            <span style={cell} />
            <span style={cell}><Appt bg="#dcfce7" fg="#166534" subFg="#15803d" title="Ortodoncia" who="L. Paredes ✓" /></span>
            <span style={{ ...cell, background: "#fdfcff" }} />
            <span style={{ borderBottom: "1px solid #f1f5f9", padding: 3, minHeight: 40 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "40px repeat(5,1fr)" }}>
            <span style={{ fontSize: 9, color: "#475569", padding: "7px 5px", borderRight: "1px solid #f1f5f9", borderBottom: "1px solid #f1f5f9" }}>10:00</span>
            <span style={cell} />
            <span style={cell}><Appt bg="#fef3c7" fg="#92400e" subFg="#b45309" title="Valoración" who="Reserva en línea" /></span>
            <span style={cell} />
            <span style={{ ...cell, background: "#fdfcff" }}><Appt bg="#dbeafe" fg="#1e40af" subFg="#1d4ed8" title="Endodoncia" who="J. Medina" /></span>
            <span style={{ borderBottom: "1px solid #f1f5f9", padding: 3, minHeight: 40 }}><Appt bg="#fce7f3" fg="#9d174d" subFg="#be185d" title="Pediatría" who="S. Ruiz" /></span>
          </div>
        </div>
      </div>
      <figcaption style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "#f0fdf4", borderTop: "1px solid #dcfce7" }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: "#15803d", color: "#ffffff", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>W</span>
        <span style={{ fontSize: 10.5, color: "#334155" }}>
          &ldquo;Hola Ana 👋 te recordamos tu cita mañana 10:00 am&rdquo; · <strong style={{ color: "#15803d", fontWeight: 700 }}>Confirmó ✓</strong>
        </span>
      </figcaption>
    </MockFrame>
  );
}

/* ── 2 · Pacientes ───────────────────────────────────────────────────────── */

const PACIENTES: { ini: string; bg: string; fg: string; name: string; meta: string; debt: string }[] = [
  { ini: "PM", bg: "#ede9fe", fg: "#6d28d9", name: "Patricia Mendoza Lara", meta: "P0118 · Vie 10:30", debt: "$1,800" },
  { ini: "RV", bg: "#dbeafe", fg: "#1e40af", name: "Ricardo Vega Ortiz", meta: "P0119 · Jue 11:00", debt: "$36,000" },
  { ini: "LN", bg: "#f1f5f9", fg: "#475569", name: "Lucía Navarro Pena", meta: "P0120 · sin próxima cita", debt: "$2,500" },
];

export function PacientesMock() {
  return (
    <MockFrame shadow="0 34px 60px -34px rgba(124,58,237,0.55)">
      <div style={chromeBar}>
        {dots}
        <span style={urlPill}>app.dalecontrol.com/pacientes</span>
      </div>
      <div style={{ padding: "11px 14px", display: "flex", flexWrap: "wrap", gap: 6, borderBottom: "1px solid #f1f5f9" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#6d28d9", background: "#ede9fe", borderRadius: 999, padding: "4px 9px" }}>Todos 126</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#475569", border: "1px solid #e8edf4", borderRadius: 999, padding: "4px 9px" }}>Activos 122</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 999, padding: "4px 9px" }}>Con deuda 40</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#475569", border: "1px solid #e8edf4", borderRadius: 999, padding: "4px 9px" }}>VIP</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#475569", border: "1px solid #e8edf4", borderRadius: 999, padding: "4px 9px" }}>Sin contacto 6m</span>
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: "#ffffff", background: "#7c3aed", borderRadius: 7, padding: "5px 9px" }}>+ Nuevo paciente</span>
      </div>
      <ul>
        {PACIENTES.map((p, i) => (
          <li key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i === PACIENTES.length - 1 ? undefined : "1px solid #f1f5f9" }}>
            <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: "50%", background: p.bg, color: p.fg, fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>{p.ini}</span>
            <span style={{ flex: "1 1 auto", minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#0f172a" }}>{p.name}</span>
              <span style={{ display: "block", fontSize: 9.5, color: "#475569" }}>{p.meta}</span>
            </span>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#b91c1c" }}>{p.debt}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 999, padding: "3px 8px" }}>Activo</span>
          </li>
        ))}
      </ul>
      <div style={{ padding: "10px 14px", background: "#f8fafc", borderTop: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: "50%", background: "#ede9fe", color: "#6d28d9", fontSize: 10, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>⇅</span>
        <span style={{ fontSize: 10.5, color: "#475569" }}>Importar mi clínica · desde Excel o tu sistema anterior</span>
      </div>
    </MockFrame>
  );
}

/* ── 3 · Presupuesto ─────────────────────────────────────────────────────── */

function Line({ label, value, color = "#334155", strong = "#0f172a" }: { label: string; value: string; color?: string; strong?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
      <span style={{ fontSize: 11.5, color }}>{label}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: strong }}>{value}</span>
    </div>
  );
}

export function PresupuestoMock() {
  return (
    <MockFrame shadow="0 34px 60px -34px rgba(21,128,61,0.5)">
      <div style={{ padding: "11px 16px", background: "linear-gradient(90deg,#f0fdf4,#ffffff)", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>Presupuesto #1042 · Ana Torres</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#b45309", background: "#fef3c7", borderRadius: 999, padding: "4px 9px", whiteSpace: "nowrap" }}>✍ Firmado ✓</span>
      </div>
      <div style={{ padding: "13px 16px" }}>
        <Line label="Corona zirconia ×2" value="$9,600" />
        <Line label="Endodoncia molar" value="$3,800" />
        <Line label="Descuento 10% (global)" value="−$1,340" color="#15803d" strong="#15803d" />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 0" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Total · 3 pagos parciales</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>$12,060 MXN</span>
        </div>
        <div style={{ border: "1px solid #e8edf4", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700, color: "#475569" }}>
            <span>▤ ESTADO DE CUENTA</span><span style={{ color: "#15803d" }}>66% cubierto</span>
          </div>
          <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#334155" }}>
            <span>Pagado</span><span style={{ fontWeight: 700, color: "#15803d" }}>$8,040</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#334155" }}>
            <span>Saldo pendiente</span><span style={{ fontWeight: 700, color: "#b45309" }}>$4,020</span>
          </div>
          <span aria-hidden="true" style={{ marginTop: 7, display: "block", height: 7, borderRadius: 999, background: "linear-gradient(90deg,#15803d 66%,#e2e8f0 66%)" }} />
        </div>
        <div style={{ marginTop: 11, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#ffffff", background: "#7c3aed", borderRadius: 9, padding: "9px 0", textAlign: "center" }}>Facturar automático</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6d28d9", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 9, padding: "9px 0", textAlign: "center" }}>Cobrar en línea</span>
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, border: "1px solid #e8edf4", borderRadius: 9, padding: "8px 10px" }}>
          <span aria-hidden="true" style={{ color: "#b45309", fontWeight: 800, fontSize: 11 }}>✦</span>
          <span style={{ fontSize: 10, color: "#475569" }}>
            <strong style={{ fontWeight: 700, color: "#334155" }}>Regla automática:</strong> Ana recibirá un recordatorio de pago por WhatsApp 24h antes de su próxima cita.
          </span>
        </div>
      </div>
    </MockFrame>
  );
}

/* ── 4 · Visor CBCT ──────────────────────────────────────────────────────── */

/** Las 4 imágenes reales del estudio, en WebP (342 KB de PNG → 26 KB). */
const CORTES: { src: string; w: number; h: number; label: string; alt: string }[] = [
  { src: "/landing/rx-coronal.webp", w: 398, h: 267, label: "Coronal", alt: "Corte coronal del estudio CBCT" },
  { src: "/landing/rx-sagital.webp", w: 354, h: 267, label: "Sagital", alt: "Corte sagital del estudio CBCT" },
  { src: "/landing/rx-axial.webp", w: 353, h: 316, label: "Axial", alt: "Corte axial del estudio CBCT" },
  { src: "/landing/rx-3d.webp", w: 349, h: 316, label: "3D", alt: "Reconstrucción 3D del estudio CBCT" },
];

export function CbctMock() {
  return (
    <MockFrame shadow="0 34px 60px -30px rgba(8,145,178,0.65)" border="#cbd5e1" background="#0b1220">
      <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#ffffff" }}>DICOM · estudio de ejemplo</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, color: "#67e8f9", background: "rgba(34,211,238,0.16)", borderRadius: 999, padding: "3px 8px" }}>✦ IA activa</span>
      </div>
      <div style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: "#03060d" }}>
        {CORTES.map((c) => (
          <span key={c.label} style={{ position: "relative", display: "block", borderRadius: 10, overflow: "hidden", background: "#000000" }}>
            {/* aspect-ratio + object-fit fijan la caja: el alto NO depende del
                tamaño intrínseco, así que la imagen no puede mover nada. */}
            <Image
              src={c.src}
              alt={c.alt}
              width={c.w}
              height={c.h}
              sizes="(max-width: 640px) 45vw, 250px"
              style={{ width: "100%", aspectRatio: "16 / 9", height: "auto", objectFit: "cover", objectPosition: "50% 42%", display: "block" }}
            />
            <span style={{ position: "absolute", left: 9, top: 7, fontSize: 10, fontWeight: 700, color: "#e2e8f0", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{c.label}</span>
          </span>
        ))}
      </div>
      <div style={{ padding: "9px 14px", background: "rgba(255,255,255,0.04)", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center" }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#4ade80" }}>● Auto-rotar</span>
        <span style={{ fontSize: 9.5, color: "#94a3b8" }}>modelo_arcada.stl</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "#94a3b8" }}>ⓘ Solo apoyo visual — no sustituye una estación diagnóstica certificada</span>
      </div>
    </MockFrame>
  );
}

/* ── 5 · Importar mi clínica ─────────────────────────────────────────────── */

const ORIGENES: { ini: string; bg: string; name: string; note: string; ready: boolean }[] = [
  { ini: "D", bg: "#3b82f6", name: "Dentalink", note: "Perfil listo", ready: true },
  { ini: "M", bg: "#14b8a6", name: "Medilink", note: "Perfil listo", ready: true },
  { ini: "i", bg: "#f97316", name: "iDentalSoft", note: "Perfil listo", ready: true },
  { ini: "O", bg: "#16a34a", name: "Open Dental", note: "Perfil listo", ready: true },
  { ini: "D", bg: "#2563eb", name: "Dentrix", note: "Perfil listo", ready: true },
  { ini: "G", bg: "#dc2626", name: "Gesden", note: "Perfil listo", ready: true },
  { ini: "XLS", bg: "#047857", name: "Mi Excel", note: "Mapeo manual", ready: false },
  { ini: "?", bg: "#64748b", name: "Otro", note: "Mapeo manual", ready: false },
];

const PASOS = ["Origen", "Exportar", "Subir", "Mapear", "Revisar"];

export function ImportarMock() {
  return (
    <MockFrame shadow="0 34px 60px -34px rgba(124,58,237,0.55)">
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Importar mi clínica</span>
          <span style={{ display: "block", fontSize: 10.5, color: "#64748b" }}>Paso 1 de 6</span>
        </span>
        <span aria-hidden="true" style={{ width: 26, height: 26, border: "1px solid #e8edf4", borderRadius: 8, display: "grid", placeItems: "center", color: "#475569", fontSize: 12, flex: "0 0 auto" }}>✕</span>
      </div>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
        {PASOS.map((paso, i) => (
          <span key={paso} style={{ display: "contents" }}>
            {i > 0 && <span aria-hidden="true" style={{ flex: "1 1 auto", borderTop: "1px solid #e8edf4" }} />}
            <span style={{ display: "flex", alignItems: "center", gap: 5, flex: "0 0 auto" }}>
              <span aria-hidden="true" style={i === 0
                ? { width: 18, height: 18, borderRadius: "50%", background: "#7c3aed", color: "#ffffff", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center" }
                : { width: 18, height: 18, borderRadius: "50%", border: "1px solid #cbd5e1", color: "#64748b", fontSize: 9, fontWeight: 700, display: "grid", placeItems: "center" }}>{i + 1}</span>
              <span style={{ fontSize: 10, fontWeight: i === 0 ? 800 : 400, color: i === 0 ? "#0f172a" : "#64748b" }}>{paso}</span>
            </span>
          </span>
        ))}
      </div>
      <div style={{ padding: "14px 16px" }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>¿De dónde vienen tus datos?</span>
        <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "#64748b" }}>Elige tu sistema actual; adaptamos las instrucciones y el mapeo a tu elección.</span>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))", gap: 7 }}>
          {ORIGENES.map((o) => (
            <span key={o.name} style={{ border: "1px solid #e8edf4", borderRadius: 10, padding: "9px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, background: o.bg, color: "#ffffff", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center" }}>{o.ini}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#0f172a" }}>{o.name}</span>
              <span style={{ fontSize: 8.5, color: o.ready ? "#15803d" : "#64748b" }}>{o.note}</span>
            </span>
          ))}
        </div>
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 11, padding: "11px 13px" }}>
          <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 8, background: "#ede9fe", color: "#6d28d9", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>✦</span>
          <span style={{ flex: "1 1 180px", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "#0f172a" }}>¿Prefieres que lo hagamos por ti?</span>
            <span style={{ display: "block", fontSize: 10, color: "#475569" }}>Migración asistida gratis: súbenos tu respaldo y nuestro equipo lo deja listo.</span>
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#6d28d9", background: "#ffffff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "7px 11px", flex: "0 0 auto" }}>Migración asistida</span>
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          <span style={{ fontSize: 10.5, color: "#64748b" }}>Elige tu sistema para continuar</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#ffffff", background: "#7c3aed", borderRadius: 9, padding: "8px 15px", whiteSpace: "nowrap" }}>Continuar →</span>
        </div>
      </div>
    </MockFrame>
  );
}

/* ── 6 · Inbox WhatsApp + Asistente IA ───────────────────────────────────── */

export function InboxIaMock() {
  return (
    <MockFrame shadow="0 34px 60px -34px rgba(21,128,61,0.5)">
      <div style={chromeBar}>
        <span style={urlPill}>app.dalecontrol.com/inbox</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>● Bot activo</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0, borderRight: "1px solid #f1f5f9", padding: "11px 12px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: "#0f172a" }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: "#15803d", color: "#ffffff", fontSize: 8, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>W</span>
            Inbox WhatsApp
          </span>
          <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ background: "#f1f5f9", borderRadius: "9px 9px 9px 2px", padding: "7px 9px", fontSize: 9.5, color: "#0f172a", maxWidth: "92%" }}>Hola, ¿tienen espacio para limpieza esta semana?</span>
            <span style={{ alignSelf: "flex-end", background: "#dcfce7", borderRadius: "9px 9px 2px 9px", padding: "7px 9px", fontSize: 9.5, color: "#14532d", maxWidth: "92%" }}>¡Claro! Tengo jueves 12:00 o viernes 10:30. ¿Cuál prefieres? 🦷</span>
            <span style={{ background: "#f1f5f9", borderRadius: "9px 9px 9px 2px", padding: "7px 9px", fontSize: 9.5, color: "#0f172a", maxWidth: "60%" }}>Viernes 10:30 👍</span>
            <span style={{ alignSelf: "center", fontSize: 9, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 999, padding: "3px 9px", textAlign: "center" }}>✓ El bot agendó: viernes 10:30 · Limpieza</span>
            <span style={{ fontSize: 8.5, color: "#6d28d9" }}><strong style={{ fontWeight: 800 }}>✦ Recall:</strong> Elena Castro · 6 meses sin venir → mensaje enviado</span>
          </div>
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 0, padding: "11px 12px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: "#0f172a" }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 6, background: "#7c3aed", color: "#ffffff", fontSize: 8, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>✦</span>
            Asistente IA Clínico
          </span>
          <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ border: "1px solid #e8edf4", borderRadius: 9, padding: "7px 9px" }}>
              <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, color: "#0f172a" }}>⌁ Diagnóstico diferencial</span>
              <span style={{ display: "block", fontSize: 8.5, color: "#475569" }}>Paciente con síntomas X/Y/Z, dame DDx</span>
            </span>
            <span style={{ border: "1px solid #e8edf4", borderRadius: 9, padding: "7px 9px" }}>
              <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, color: "#0f172a" }}>▤ Redactar nota SOAP</span>
              <span style={{ display: "block", fontSize: 8.5, color: "#475569" }}>Estructura una nota de evolución</span>
            </span>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: "#6d28d9", background: "#ede9fe", borderRadius: 5, padding: "3px 7px" }}>/soap</span>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: "#475569", border: "1px solid #e8edf4", borderRadius: 5, padding: "3px 7px" }}>/receta</span>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: "#475569", border: "1px solid #e8edf4", borderRadius: 5, padding: "3px 7px" }}>Resumir historia</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #e8edf4", borderRadius: 999, padding: "6px 10px" }}>
              <span style={{ flex: "1 1 auto", fontSize: 9, color: "#94a3b8" }}>Pregúntame o escribe / ...</span>
              <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: "#7c3aed", color: "#ffffff", fontSize: 8, display: "grid", placeItems: "center", flex: "0 0 auto" }}>▶</span>
            </span>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

/* ── Mini-mockups del trío oscuro (van en SSR: pesan poco) ───────────────── */

const trioBox: CSSProperties = { border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, background: "#0b1220", padding: 14 };

export function AnalyticsMini() {
  return (
    <div style={{ ...trioBox, display: "flex", alignItems: "center", gap: 13 }}>
      <span aria-hidden="true" style={{ width: 64, height: 64, borderRadius: "50%", background: "conic-gradient(#a78bfa 0 87%,rgba(255,255,255,0.12) 87% 100%)", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
        <span style={{ width: 46, height: 46, borderRadius: "50%", background: "#0b1220", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800, color: "#ffffff" }}>87</span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#94a3b8" }}>EFICIENCIA OPERATIVA</span>
        <span style={{ display: "block", marginTop: 3, fontSize: 11.5, fontWeight: 700, color: "#4ade80" }}>● Capacidad bien utilizada</span>
        <span style={{ display: "block", fontSize: 10, color: "#94a3b8" }}>Citas 212 · Completadas 94% · No-shows 2.1%</span>
      </span>
    </div>
  );
}

export function EquipoMini() {
  const team: { ini: string; bg: string; roleFg: string; name: string; role: string }[] = [
    { ini: "RM", bg: "#a78bfa", roleFg: "#c4b5fd", name: "Rafael M.", role: "● SUPER ADMIN" },
    { ini: "JG", bg: "#34d399", roleFg: "#6ee7b7", name: "Jorge G.", role: "● DOCTOR/A" },
  ];
  return (
    <div style={trioBox}>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#ffffff" }}>Equipo médico</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#ffffff", background: "#7c3aed", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>+ Invitar miembro</span>
      </span>
      <div style={{ marginTop: 10, display: "flex", gap: 7 }}>
        {team.map((m) => (
          <span key={m.ini} style={{ flex: "1 1 auto", display: "flex", alignItems: "center", gap: 7, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, padding: "7px 9px", minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", background: m.bg, color: "#0b1220", fontSize: 8, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>{m.ini}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, color: "#ffffff" }}>{m.name}</span>
              <span style={{ display: "block", fontSize: 8, color: m.roleFg }}>{m.role}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PaginaWebMini() {
  return (
    <div style={trioBox}>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#ffffff" }}>Página pública de tu clínica</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#4ade80", background: "rgba(74,222,128,0.14)", borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>● Publicada</span>
      </span>
      <span style={{ marginTop: 9, display: "block", fontSize: 9.5, color: "#94a3b8", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, padding: "6px 9px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>dalecontrol.com/rafael-clinica ⧉</span>
      <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 }} aria-hidden="true">
        <span style={{ height: 24, borderRadius: 6, background: "#3b82f6", display: "block" }} />
        <span style={{ height: 24, borderRadius: 6, background: "#4c1d95", display: "block" }} />
        <span style={{ height: 24, borderRadius: 6, background: "#34d399", display: "block", outline: "2px solid #4ade80" }} />
        <span style={{ height: 24, borderRadius: 6, background: "#f59e0b", display: "block" }} />
      </div>
    </div>
  );
}
