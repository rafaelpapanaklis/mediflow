import type { CSSProperties } from "react";
import { BrowserFrame } from "./browser-frame";
import { BrandGlyph } from "../../primitives/logo";

/**
 * Mockups del panel — JSX estático portado 1:1 del reference. Son
 * ilustraciones (aria-hidden en el wrapper de cada sección), no funcionalidad.
 * OJO: los acentos VIOLETA #7c3aed son a propósito (así es el producto);
 * el chrome de la landing es azul. No "corregir".
 */

const kpi: CSSProperties = { background: "#fff", border: "1px solid #eeeaf8", borderRadius: 10, padding: 8, minWidth: 0, overflow: "hidden" };
const kpiLabel: CSSProperties = { fontSize: 7.5, color: "#94a3b8", fontWeight: 700, letterSpacing: ".05em" };
const kpiValue: CSSProperties = { fontSize: 14, fontWeight: 800 };

/* ── 1. Dashboard del hero ─────────────────────────────────────────────── */
export function HeroDashboardMock() {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, boxShadow: "0 30px 70px rgba(15,23,42,.14)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", borderBottom: "1px solid #eef2f7", background: "#f8fafc" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fca5a5" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fcd34d" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#86efac" }} />
        <span style={{ marginLeft: 10, fontSize: 12, color: "#94a3b8", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 7, padding: "3px 12px" }}>app.dalecontrol.com</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "#94a3b8", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>⌕ Buscar o ejecutar… <b style={{ color: "#64748b" }}>Ctrl K</b></span>
      </div>
      <div style={{ display: "flex" }}>
        <div className="dcv2-hero-side" style={{ width: 116, background: "#fbfaff", borderRight: "1px solid #eeeaf8", padding: "10px 8px", display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ display: "flex", width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#7c3aed,#a78bfa)", color: "#fff", fontSize: 9, fontWeight: 800, alignItems: "center", justifyContent: "center" }}>RC</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#0f172a", lineHeight: 1.25 }}>Rafael Clinica<br /><span style={{ color: "#94a3b8", fontWeight: 600, letterSpacing: ".05em" }}>PROFESIONAL</span></span>
          </div>
          <div style={{ background: "#7c3aed", color: "#fff", fontSize: 9.5, fontWeight: 700, textAlign: "center", borderRadius: 8, padding: "7px 4px", boxShadow: "0 3px 8px rgba(124,58,237,.3)" }}>+ Nueva cita</div>
          <div style={{ background: "#f1ebfe", color: "#6d28d9", fontSize: 10, fontWeight: 700, borderRadius: 7, padding: "5px 8px" }}>⌂ Hoy</div>
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 600, padding: "4px 8px" }}>▦ Agenda</div>
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 600, padding: "4px 8px" }}>⚉ Pacientes</div>
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 600, padding: "4px 8px" }}>✦ IA asistente</div>
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 600, padding: "4px 8px" }}>▤ Facturación</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: 16, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.25 }}>Buenos días, Rafael.<br /><span style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 500 }}>jueves, 2 de julio · Resumen operativo</span></span>
            <span style={{ fontSize: 9.5, color: "#fff", background: "#7c3aed", borderRadius: 7, padding: "5px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>+ Nueva cita</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 7, marginBottom: 10 }}>
            <div style={kpi}><div style={kpiLabel}>INGRESOS DEL MES</div><div style={kpiValue}>$148,320</div><div style={{ fontSize: 8, color: "#16a34a", fontWeight: 700 }}>▲ +18% vs mes anterior</div></div>
            <div style={kpi}><div style={kpiLabel}>CITAS</div><div style={kpiValue}>212</div><div style={{ fontSize: 8, color: "#16a34a", fontWeight: 700 }}>▲ +12% vs mes anterior</div></div>
            <div style={kpi}><div style={kpiLabel}>OCUPACIÓN</div><div style={kpiValue}>87%</div><div style={{ fontSize: 8, color: "#94a3b8", fontWeight: 600 }}>de tus sillones</div></div>
            <div style={kpi}><div style={kpiLabel}>NO-SHOWS</div><div style={kpiValue}>2</div><div style={{ fontSize: 8, color: "#16a34a", fontWeight: 700 }}>▼ −60% con WhatsApp</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 7 }}>
            <div style={{ background: "#fff", border: "1px solid #eeeaf8", borderRadius: 10, padding: 9, minWidth: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><b style={{ fontSize: 10 }}>Tendencia de ingresos</b><span style={{ fontSize: 8, color: "#6d28d9", fontWeight: 700, background: "#f1ebfe", borderRadius: 99, padding: "2px 7px" }}>Mes</span></div>
              <svg viewBox="0 0 200 58" style={{ width: "100%", height: "auto", display: "block" }} aria-hidden="true">
                <defs><linearGradient id="dcv2IngGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7c3aed" stopOpacity=".28" /><stop offset="1" stopColor="#7c3aed" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 50 L30 46 L60 40 L90 34 L120 30 L150 20 L180 14 L200 8 L200 58 L0 58 Z" fill="url(#dcv2IngGrad)" />
                <path d="M0 50 L30 46 L60 40 L90 34 L120 30 L150 20 L180 14 L200 8" fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ background: "#fff", border: "1px solid #eeeaf8", borderRadius: 10, padding: 9, minWidth: 0, overflow: "hidden" }}>
              <b style={{ fontSize: 10, display: "block", marginBottom: 6 }}>Próximas citas</b>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 8.5, color: "#334155" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}><span style={{ color: "#6d28d9", fontWeight: 800 }}>10:00</span> Ana Torres · Limpieza <span style={{ color: "#16a34a", fontWeight: 800 }}>✓</span></div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}><span style={{ color: "#6d28d9", fontWeight: 800 }}>11:30</span> J. Medina · Endodoncia</div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}><span style={{ color: "#6d28d9", fontWeight: 800 }}>12:15</span> L. Paredes · Ortodoncia <span style={{ color: "#16a34a", fontWeight: 800 }}>✓</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 2. Agenda semanal ─────────────────────────────────────────────────── */
const agCell: CSSProperties = { borderLeft: "1px solid #f4f2fb", borderBottom: "1px solid #f4f2fb" };
const agHour: CSSProperties = { padding: "4px 4px 0", color: "#cbd5e1", borderBottom: "1px solid #f4f2fb" };
function AgEvent({ bg, border, title, sub, check }: { bg: string; border: string; title: string; sub: string; check?: boolean }) {
  return (
    <span style={{ display: "block", background: bg, borderLeft: `2px solid ${border}`, borderRadius: 4, padding: "3px 5px", lineHeight: 1.35 }}>
      <b>{title}</b><br />{sub} {check && <span style={{ color: "#16a34a", fontWeight: 800 }}>✓</span>}
    </span>
  );
}
export function AgendaMock() {
  const filterPill: CSSProperties = { border: "1px solid #e8e3f6", borderRadius: 999, padding: "2px 8px" };
  return (
    <BrowserFrame
      url="app.dalecontrol.com/agenda"
      right={<span style={{ marginLeft: "auto", fontSize: 8.5, color: "#dc2626", background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 999, padding: "2px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{"⚠ 2 esperando >20m"}</span>}
    >
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <BrandGlyph size={18} />
            <b style={{ fontSize: 11 }}>DaleControl</b>
            <span style={{ display: "inline-flex", background: "#f4f1fb", borderRadius: 8, padding: 2, fontSize: 9.5, fontWeight: 700 }}>
              <span style={{ padding: "3px 8px", color: "#64748b" }}>Día</span>
              <span style={{ padding: "3px 8px", background: "#fff", borderRadius: 6, color: "#6d28d9", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>Semana</span>
              <span style={{ padding: "3px 8px", color: "#64748b" }}>Mes</span>
              <span style={{ padding: "3px 8px", color: "#64748b" }}>Lista</span>
            </span>
            <span style={{ fontSize: 9, color: "#64748b", border: "1px solid #eeeaf8", borderRadius: 6, padding: "3px 7px" }}>‹ Hoy › 02/07/2026</span>
          </div>
          <span style={{ fontSize: 9.5, color: "#fff", fontWeight: 700, background: "#7c3aed", borderRadius: 7, padding: "4px 10px" }}>+ Nueva cita</span>
        </div>
        <div style={{ display: "flex", gap: 5, marginBottom: 9, fontSize: 9, fontWeight: 600, color: "#475569", flexWrap: "wrap" }}>
          <span style={filterPill}>Doctores <b style={{ color: "#6d28d9" }}>2</b> ▾</span>
          <span style={filterPill}>Sillones <b style={{ color: "#6d28d9" }}>8</b> ▾</span>
          <span style={filterPill}>Estado <b style={{ color: "#6d28d9" }}>9</b> ▾</span>
          <span style={{ ...filterPill, color: "#94a3b8" }}>⌕ Buscar paciente…</span>
          <span style={{ marginLeft: "auto", fontSize: 8, color: "#94a3b8", fontWeight: 800, letterSpacing: ".04em", alignSelf: "center" }}>18 CITAS ESTA SEMANA</span>
        </div>
        <div style={{ border: "1px solid #eeeaf8", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "32px repeat(5,1fr)", background: "#fbfaff", borderBottom: "1px solid #eeeaf8", fontSize: 7.5, fontWeight: 800, color: "#94a3b8", textAlign: "center" }}>
            <div style={{ padding: "5px 0" }} />
            <div style={{ padding: "5px 0" }}>LUN 29</div><div style={{ padding: "5px 0" }}>MAR 30</div><div style={{ padding: "5px 0" }}>MIÉ 1</div><div style={{ padding: "5px 0", background: "#f1ebfe", color: "#6d28d9" }}>JUE 2</div><div style={{ padding: "5px 0" }}>VIE 3</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "32px repeat(5,1fr)", fontSize: 7.5 }}>
            <div style={agHour}>09:00</div>
            <div style={{ ...agCell, padding: 2 }}><AgEvent bg="#ede9fe" border="#7c3aed" title="Limpieza" sub="Ana T." check /></div>
            <div style={agCell} />
            <div style={{ ...agCell, padding: 2 }}><AgEvent bg="#dcfce7" border="#16a34a" title="Ortodoncia" sub="L. Paredes" check /></div>
            <div style={{ ...agCell, background: "#fdfcff" }} />
            <div style={agCell} />
            <div style={agHour}>10:00</div>
            <div style={agCell} />
            <div style={{ ...agCell, padding: 2 }}><AgEvent bg="#fef3c7" border="#d97706" title="Valoración" sub="Reserva en línea" /></div>
            <div style={agCell} />
            <div style={{ ...agCell, background: "#fdfcff", padding: 2 }}><AgEvent bg="#ede9fe" border="#7c3aed" title="Endodoncia" sub="J. Medina" /></div>
            <div style={agCell} />
            <div style={{ padding: "4px 4px 0", color: "#cbd5e1" }}>11:00</div>
            <div style={{ borderLeft: "1px solid #f4f2fb" }} />
            <div style={{ borderLeft: "1px solid #f4f2fb" }} />
            <div style={{ borderLeft: "1px solid #f4f2fb", padding: 2 }}><AgEvent bg="#dbeafe" border="#2563eb" title="Implante" sub="R. Vega" check /></div>
            <div style={{ borderLeft: "1px solid #f4f2fb", background: "#fdfcff" }} />
            <div style={{ borderLeft: "1px solid #f4f2fb", padding: 2 }}><AgEvent bg="#fce7f3" border="#db2777" title="Pediatría" sub="S. Ruiz" /></div>
          </div>
        </div>
        <div style={{ marginTop: 9, background: "#f0fdf4", border: "1px solid #dcfce7", borderRadius: 10, padding: "8px 11px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ display: "flex", width: 22, height: 22, borderRadius: "50%", background: "#16a34a", color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flex: "0 0 auto" }}>W</span>
          <span style={{ fontSize: 10, color: "#334155" }}>&ldquo;Hola Ana 👋 te recordamos tu cita mañana 10:00 am&rdquo; · <b style={{ color: "#16a34a" }}>Confirmó ✓</b></span>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── 3. Tabla de pacientes ─────────────────────────────────────────────── */
const pRow: CSSProperties = { display: "grid", gridTemplateColumns: "1.6fr 1.2fr .9fr .7fr .6fr", alignItems: "center", padding: "6px 9px", fontSize: 8.5 };
function PatientRow({ initials, name, meta, phone, email, next, saldo, last }: { initials: string; name: string; meta: string; phone: string; email: string; next: string; saldo: string | null; last?: boolean }) {
  return (
    <div style={{ ...pRow, borderBottom: last ? undefined : "1px solid #f4f2fb" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ display: "flex", width: 16, height: 16, borderRadius: "50%", background: "#ede9fe", color: "#6d28d9", fontSize: 6.5, fontWeight: 800, alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{initials}</span>
        <span><b>{name}</b><br /><span style={{ color: "#94a3b8", fontSize: 7 }}>{meta}</span></span>
      </span>
      <span style={{ color: "#475569" }}>{phone}<br /><span style={{ color: "#94a3b8", fontSize: 7 }}>{email}</span></span>
      <span style={{ color: "#475569" }}>{next}</span>
      {saldo ? <span style={{ color: "#dc2626", fontWeight: 800 }}>{saldo}</span> : <span style={{ color: "#94a3b8" }}>—</span>}
      <span><span style={{ background: "#dcfce7", color: "#15803d", fontWeight: 700, borderRadius: 999, padding: "2px 7px", fontSize: 7.5 }}>Activo</span></span>
    </div>
  );
}
export function PacientesMock() {
  const chip: CSSProperties = { color: "#475569", border: "1px solid #eeeaf8", borderRadius: 999, padding: "3px 9px" };
  return (
    <BrowserFrame url="app.dalecontrol.com/pacientes">
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 8, fontSize: 9, fontWeight: 700, flexWrap: "wrap" }}>
          <span style={{ background: "#f1ebfe", color: "#6d28d9", border: "1px solid #e2d8fb", borderRadius: 999, padding: "3px 9px" }}>Todos <b>126</b></span>
          <span style={chip}>Activos 122</span>
          <span style={chip}>Con deuda <b style={{ color: "#dc2626" }}>40</b></span>
          <span style={chip}>VIP</span>
          <span style={chip}>Cumple esta semana</span>
          <span style={chip}>Sin contacto 6m</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 9, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ flex: 1, minWidth: 120, fontSize: 9, color: "#94a3b8", border: "1px solid #eeeaf8", borderRadius: 7, padding: "4px 9px" }}>⌕ Buscar paciente, teléfono, email…</span>
          <span style={{ fontSize: 9, color: "#475569", fontWeight: 700, border: "1px solid #eeeaf8", borderRadius: 7, padding: "4px 9px" }}>⇪ Importar mi clínica</span>
          <span style={{ fontSize: 9, color: "#fff", fontWeight: 700, background: "#7c3aed", borderRadius: 7, padding: "4px 10px" }}>+ Nuevo paciente</span>
        </div>
        <div style={{ border: "1px solid #eeeaf8", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr .9fr .7fr .6fr", background: "#fbfaff", borderBottom: "1px solid #eeeaf8", fontSize: 7, fontWeight: 800, color: "#94a3b8", letterSpacing: ".05em", padding: "5px 9px" }}>
            <span>PACIENTE</span><span>CONTACTO</span><span>PRÓXIMA CITA</span><span>SALDO</span><span>ESTADO</span>
          </div>
          <PatientRow initials="PM" name="Patricia Mendoza Lara" meta="P0118 · 39 años" phone="55 3001 0001" email="patricia.m@gmail.com" next="Vie 10:30" saldo="$1,800" />
          <PatientRow initials="RV" name="Ricardo Vega Ortiz" meta="P0119 · 33 años" phone="55 3001 0002" email="ricardo.v@gmail.com" next="Jue 11:00" saldo="$36,000" />
          <PatientRow initials="LN" name="Lucia Navarro Pena" meta="P0120 · 35 años" phone="55 3001 0003" email="lucia.n@hotmail.com" next="—" saldo="$2,500" />
          <PatientRow initials="AG" name="Andres Gomez Fuentes" meta="P0121 · 41 años" phone="55 3001 0004" email="andres.g@gmail.com" next="Lun 9:00" saldo={null} last />
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── 4. Presupuesto / estado de cuenta ─────────────────────────────────── */
export function PresupuestoMock() {
  return (
    <BrowserFrame url="app.dalecontrol.com/presupuestos">
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <b style={{ fontSize: 12.5 }}>Presupuesto #1042 · Ana Torres</b>
          <span style={{ fontSize: 9.5, fontWeight: 800, color: "#16a34a", background: "#dcfce7", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>✍ Firmado ✓</span>
        </div>
        <div style={{ fontSize: 10.5, color: "#334155", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px dashed #e2e8f0", paddingBottom: 9, marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Corona zirconia ×2</span><b>$9,600</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Endodoncia molar</span><b>$3,800</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#16a34a" }}><span>Descuento 10% (global)</span><b>−$1,340</b></div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 10.5, color: "#64748b" }}>Total · 3 pagos parciales</span><b style={{ fontSize: 15 }}>$12,060 MXN</b>
        </div>
        <div style={{ background: "#fbfaff", border: "1px solid #eeeaf8", borderRadius: 10, padding: "9px 11px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontWeight: 700, color: "#94a3b8", letterSpacing: ".04em", marginBottom: 5 }}><span>▤ ESTADO DE CUENTA</span><span style={{ color: "#16a34a" }}>66% cubierto</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}><span style={{ color: "#64748b" }}>Pagado</span><b style={{ color: "#16a34a" }}>$8,040</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 6 }}><span style={{ color: "#64748b" }}>Saldo pendiente</span><b style={{ color: "#dc2626" }}>$4,020</b></div>
          <div style={{ height: 5, background: "#e9e3f8", borderRadius: 99, overflow: "hidden" }}><span style={{ display: "block", width: "66%", height: "100%", background: "#16a34a", borderRadius: 99 }} /></div>
        </div>
        <div style={{ display: "flex", gap: 7, marginBottom: 9 }}>
          <span style={{ flex: 1, textAlign: "center", background: "#7c3aed", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 8, padding: 8 }}>Facturar automático</span>
          <span style={{ flex: 1, textAlign: "center", background: "#f1ebfe", color: "#6d28d9", fontSize: 10, fontWeight: 700, borderRadius: 8, padding: 8 }}>Cobrar en línea</span>
        </div>
        <div style={{ fontSize: 9, color: "#64748b", background: "#fbfaff", border: "1px solid #eeeaf8", borderRadius: 8, padding: "7px 9px" }}>✦ <b>Regla automática:</b> Ana recibirá un recordatorio de pago por WhatsApp 24h antes de su próxima cita.</div>
      </div>
    </BrowserFrame>
  );
}

/* ── 5. Radiografías + Modelos 3D FUSIONADO (CAMBIOS §1): 4 cuadrantes DICOM
      con imágenes reales (142px, object-fit CONTAIN sobre negro — cover
      recortaba la anatomía, CAMBIOS §5) + tira inferior con el STL animado. ── */
const dicomTile: CSSProperties = { background: "#000", borderRadius: 10, height: 142, position: "relative", overflow: "hidden" };
const dicomImg: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" };
const dicomLabel: CSSProperties = { position: "absolute", left: 8, top: 6, fontSize: 8.5, color: "#e2e8f0", fontWeight: 700, textShadow: "0 1px 3px #000" };
export function DicomStlMock() {
  return (
    <BrowserFrame
      url="app.dalecontrol.com/imagenes-3d"
      shadow="0 18px 44px rgba(15,23,42,.12)"
      right={<span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: "#6d28d9", background: "#f1ebfe", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>✦ IA activa</span>}
    >
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
          <span><b style={{ fontSize: 12.5 }}>DICOM Angela Bastounis.zip</b><br /><span style={{ fontSize: 9.5, color: "#94a3b8" }}>Arrastra para rotar · scroll para zoom</span></span>
          <span style={{ display: "inline-flex", background: "#f4f1fb", borderRadius: 8, padding: 2, fontSize: 9.5, fontWeight: 700 }}>
            <span style={{ padding: "3px 9px", background: "#fff", borderRadius: 6, color: "#6d28d9", boxShadow: "0 1px 3px rgba(0,0,0,.08)", whiteSpace: "nowrap" }}>CBCT · DICOM</span>
            <span style={{ padding: "3px 9px", color: "#64748b", whiteSpace: "nowrap" }}>Modelo STL</span>
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={dicomTile}>
            <img src="/landing/cbct/cbct-axial.png" alt="" loading="lazy" className="dcv2-ken-9" style={dicomImg} />
            <span className="dcv2-scan-9" style={{ position: "absolute", left: 0, right: 0, top: "40%", height: 1.5, background: "rgba(34,211,238,.5)" }} />
            <span style={dicomLabel}>Axial</span>
            <span style={{ position: "absolute", left: 9, bottom: 6, fontSize: 7.5, color: "#fbbf24", fontWeight: 800 }}>Z</span>
            <span style={{ position: "absolute", left: 22, right: 10, bottom: 9, height: 3, background: "rgba(51,65,85,.9)", borderRadius: 99 }}>
              <span className="dcv2-slide-9" style={{ position: "absolute", left: "44%", top: -3, width: 9, height: 9, borderRadius: "50%", background: "#3b82f6" }} />
            </span>
          </div>
          <div style={dicomTile}>
            <img src="/landing/cbct/cbct-coronal.png" alt="" loading="lazy" className="dcv2-ken-12" style={dicomImg} />
            <span style={dicomLabel}>Coronal</span>
            <span style={{ position: "absolute", left: 9, bottom: 6, fontSize: 7.5, color: "#fbbf24", fontWeight: 800 }}>Y</span>
            <span style={{ position: "absolute", left: 22, right: 10, bottom: 9, height: 3, background: "rgba(51,65,85,.9)", borderRadius: 99 }}>
              <span className="dcv2-slideb-12" style={{ position: "absolute", left: "68%", top: -3, width: 9, height: 9, borderRadius: "50%", background: "#3b82f6" }} />
            </span>
          </div>
          <div style={dicomTile}>
            <img src="/landing/cbct/cbct-sagital.png" alt="" loading="lazy" className="dcv2-ken-14" style={dicomImg} />
            <span className="dcv2-scan-14" style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1.5, background: "rgba(251,191,36,.45)" }} />
            <span style={dicomLabel}>● Sagital · 335/668</span>
          </div>
          <div style={dicomTile}>
            <img src="/landing/cbct/cbct-volumen.png" alt="" loading="lazy" className="dcv2-orbit-9" style={dicomImg} />
            <span style={dicomLabel}>⬡ Volumen 3D</span>
            <span style={{ position: "absolute", left: 8, bottom: 6, fontSize: 7.5, color: "#4ade80", fontWeight: 800, textShadow: "0 1px 3px #000" }}>● Rotando</span>
          </div>
        </div>
        {/* Tira STL (arcada del reference, ids propios para no chocar) */}
        <div style={{ marginTop: 8, background: "#04060a", borderRadius: 10, height: 96, position: "relative", overflow: "hidden" }}>
          <svg viewBox="0 0 260 130" className="dcv2-stl" style={{ position: "absolute", left: "50%", top: "54%", width: 196, margin: "-49px 0 0 -98px" }} aria-hidden="true">
            <defs>
              <linearGradient id="dcv2mCrown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f0f3f7" /><stop offset="1" stopColor="#aab3bf" /></linearGradient>
              <linearGradient id="dcv2mBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c3cad4" /><stop offset="1" stopColor="#79828f" /></linearGradient>
              <linearGradient id="dcv2mRoot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#98a1ad" /><stop offset="1" stopColor="#d3d9e0" /></linearGradient>
            </defs>
            <g fill="url(#dcv2mRoot)">
              <path d="M 25 76 L 31 76 L 28 92 Z" /><path d="M 33 76 L 39 76 L 36 94 Z" />
              <path d="M 41 73 L 47 73 L 44 91 Z" /><path d="M 49 73 L 55 73 L 52 90 Z" />
              <path d="M 61 71 L 67 71 L 64 92 Z" />
              <path d="M 78 68 L 84 68 L 81 90 Z" />
              <path d="M 94 67 L 100 67 L 97 89 Z" />
              <path d="M 111 66 L 117 66 L 114 88 Z" />
              <path d="M 127 66 L 133 66 L 130 88 Z" />
              <path d="M 143 66 L 149 66 L 146 88 Z" />
              <path d="M 160 67 L 166 67 L 163 89 Z" />
              <path d="M 176 68 L 182 68 L 179 90 Z" />
              <path d="M 193 71 L 199 71 L 196 92 Z" />
              <path d="M 205 73 L 211 73 L 208 90 Z" /><path d="M 213 73 L 219 73 L 216 91 Z" />
              <path d="M 221 76 L 227 76 L 224 92 Z" /><path d="M 229 76 L 235 76 L 232 94 Z" />
            </g>
            <path d="M 16 64 Q 130 36 244 64 L 244 80 Q 130 52 16 80 Z" fill="url(#dcv2mBand)" stroke="#6d7683" strokeWidth="0.8" />
            <g fill="url(#dcv2mCrown)" stroke="#8e97a4" strokeWidth="0.7">
              <g transform="translate(32 60.3) rotate(-12)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(48 57.2) rotate(-10)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(64 54.7) rotate(-8)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(81 52.6) rotate(-6)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(97 51.2) rotate(-4)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(114 50.3) rotate(-2)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(130 50) rotate(0)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(146 50.3) rotate(2)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(163 51.2) rotate(4)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(179 52.6) rotate(6)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(196 54.7) rotate(8)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(212 57.2) rotate(10)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
              <g transform="translate(228 60.3) rotate(12)"><rect x="-7.5" y="-17" width="15" height="17" rx="4.5" /></g>
            </g>
            <ellipse cx="105" cy="50" rx="55" ry="9" fill="#fff" opacity=".13" />
          </svg>
          <span style={{ position: "absolute", left: 10, top: 7, fontSize: 8.5, color: "#93c5fd", fontWeight: 700 }}>modelo_dental_arcada.stl · STL · PLY · OBJ</span>
          <span style={{ position: "absolute", left: 10, bottom: 7, fontSize: 8, color: "#4ade80", fontWeight: 800 }}>● Auto-rotar</span>
          <span style={{ position: "absolute", right: 10, bottom: 7, fontSize: 8.5, color: "#cbd5e1" }}>↻ Arrastra para girar</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 8.5, color: "#94a3b8" }}>ⓘ Solo apoyo visual — no sustituye una estación diagnóstica certificada</div>
      </div>
    </BrowserFrame>
  );
}

/* ── 6. Tu clínica en 3D — escena SVG isométrica NUEVA (CAMBIOS §1): piso con
      cuadrícula, paredes con ventanas, 3 sillones azules con lámpara,
      recepción, banca de espera, plantas + chips de estado y clinicFloat.
      SVG copiado íntegro del reference. ── */
export function ClinicaIsometricaMock() {
  return (
    <BrowserFrame url="app.dalecontrol.com/mi-clinica-3d">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontSize: 9, fontWeight: 700, flexWrap: "wrap" }}>
        <span style={{ color: "#6d28d9", whiteSpace: "nowrap" }}>⬡ Mi Clínica 3D</span>
        <span style={{ display: "inline-flex", background: "#f4f1fb", borderRadius: 7, padding: 2 }}>
          <span style={{ padding: "3px 8px", color: "#94a3b8", whiteSpace: "nowrap" }}>Edición</span>
          <span style={{ padding: "3px 8px", background: "#fff", borderRadius: 5, color: "#15803d", boxShadow: "0 1px 3px rgba(0,0,0,.08)", whiteSpace: "nowrap" }}>● En Vivo</span>
        </span>
        <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>⤴ Compartir</span>
        <span style={{ marginLeft: "auto", color: "#64748b", whiteSpace: "nowrap" }}>☀ Día · 11:00</span>
      </div>
      <div style={{ position: "relative", background: "linear-gradient(180deg,#eff5fe 0%,#dce9fb 100%)", overflow: "hidden" }}>
        <svg viewBox="0 0 480 274" className="dcv2-clinic" style={{ display: "block", width: "100%", height: "auto" }} aria-hidden="true">
          <defs>
            <linearGradient id="dcv2WallL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f8fbff" /><stop offset="1" stopColor="#e9f1fc" /></linearGradient>
            <linearGradient id="dcv2WallR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#e2ecfa" /><stop offset="1" stopColor="#f2f7fe" /></linearGradient>
            <linearGradient id="dcv2ChairBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#60a5fa" /><stop offset="1" stopColor="#3b82f6" /></linearGradient>
          </defs>
          {/* paredes */}
          <polygon points="30,156 240,60 240,6 30,102" fill="url(#dcv2WallL)" stroke="#d3e0f4" strokeWidth="1" />
          <polygon points="240,60 450,156 450,102 240,6" fill="url(#dcv2WallR)" stroke="#d3e0f4" strokeWidth="1" />
          <polygon points="82,120 124,101 124,74 82,93" fill="#dbeafe" stroke="#bfdbfe" />
          <polygon points="146,90 188,71 188,44 146,63" fill="#dbeafe" stroke="#bfdbfe" />
          <polygon points="292,70 334,89 334,63 292,44" fill="#dbeafe" stroke="#bfdbfe" />
          <circle cx="388" cy="100" r="7" fill="#fff" stroke="#cbd5e1" /><path d="M388 96v4l3 2" stroke="#64748b" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          {/* piso */}
          <polygon points="240,60 450,156 240,252 30,156" fill="#eaf2fd" stroke="#d7e3f6" strokeWidth="1.2" />
          <g stroke="#cddcf3" strokeWidth="0.8" opacity=".55">
            <path d="M72 137 L282 233" /><path d="M114 118 L324 214" /><path d="M156 98 L366 194" /><path d="M198 79 L408 175" />
            <path d="M72 175 L282 79" /><path d="M114 194 L324 98" /><path d="M156 214 L366 118" /><path d="M198 233 L408 137" />
          </g>
          {/* tapetes */}
          <path d="M140 116 L184 138 L140 160 L96 138 Z" fill="#f7fafe" stroke="#e3edfb" />
          <path d="M240 158 L284 180 L240 202 L196 180 Z" fill="#f7fafe" stroke="#e3edfb" />
          <path d="M340 116 L384 138 L340 160 L296 138 Z" fill="#f7fafe" stroke="#e3edfb" />
          {/* sillón dental 1 */}
          <g transform="translate(140,136)">
            <ellipse cx="0" cy="13" rx="26" ry="7" fill="rgba(30,58,138,.12)" />
            <ellipse cx="0" cy="10" rx="10" ry="3.5" fill="#94a3b8" />
            <rect x="-2.5" y="-2" width="5" height="12" rx="1.5" fill="#a8b3c2" />
            <rect x="6" y="-9" width="17" height="5.5" rx="2.75" fill="url(#dcv2ChairBlue)" transform="rotate(-16 6 -9)" />
            <rect x="-12" y="-7" width="22" height="6.5" rx="3" fill="#3b82f6" />
            <rect x="-18" y="-27" width="7.5" height="22" rx="3.75" fill="url(#dcv2ChairBlue)" transform="rotate(-22 -14 -16)" />
            <circle cx="-17.5" cy="-28.5" r="3.8" fill="#1d4ed8" />
            <rect x="-7" y="-11.5" width="12" height="2.6" rx="1.3" fill="#dbeafe" />
            <path d="M18 -6 L27 -30 L14 -37" stroke="#cbd5e1" strokeWidth="2" fill="none" strokeLinecap="round" />
            <ellipse cx="11" cy="-38.5" rx="6" ry="4" fill="#fff" stroke="#cbd5e1" />
            <circle cx="11" cy="-38" r="1.8" fill="#fde68a" />
            <rect x="26" y="-3" width="11" height="11" rx="1.5" fill="#f1f5f9" stroke="#dfe6ef" />
            <rect x="27.5" y="-10" width="8" height="5.5" rx="1" fill="#0f172a" />
          </g>
          {/* sillón dental 2 */}
          <g transform="translate(240,178)">
            <ellipse cx="0" cy="13" rx="26" ry="7" fill="rgba(30,58,138,.12)" />
            <ellipse cx="0" cy="10" rx="10" ry="3.5" fill="#94a3b8" />
            <rect x="-2.5" y="-2" width="5" height="12" rx="1.5" fill="#a8b3c2" />
            <rect x="6" y="-9" width="17" height="5.5" rx="2.75" fill="url(#dcv2ChairBlue)" transform="rotate(-16 6 -9)" />
            <rect x="-12" y="-7" width="22" height="6.5" rx="3" fill="#3b82f6" />
            <rect x="-18" y="-27" width="7.5" height="22" rx="3.75" fill="url(#dcv2ChairBlue)" transform="rotate(-22 -14 -16)" />
            <circle cx="-17.5" cy="-28.5" r="3.8" fill="#1d4ed8" />
            <rect x="-7" y="-11.5" width="12" height="2.6" rx="1.3" fill="#dbeafe" />
            <path d="M18 -6 L27 -30 L14 -37" stroke="#cbd5e1" strokeWidth="2" fill="none" strokeLinecap="round" />
            <ellipse cx="11" cy="-38.5" rx="6" ry="4" fill="#fff" stroke="#cbd5e1" />
            <rect x="26" y="-3" width="11" height="11" rx="1.5" fill="#f1f5f9" stroke="#dfe6ef" />
          </g>
          {/* sillón dental 3 */}
          <g transform="translate(340,136)">
            <ellipse cx="0" cy="13" rx="26" ry="7" fill="rgba(30,58,138,.12)" />
            <ellipse cx="0" cy="10" rx="10" ry="3.5" fill="#94a3b8" />
            <rect x="-2.5" y="-2" width="5" height="12" rx="1.5" fill="#a8b3c2" />
            <rect x="6" y="-9" width="17" height="5.5" rx="2.75" fill="url(#dcv2ChairBlue)" transform="rotate(-16 6 -9)" />
            <rect x="-12" y="-7" width="22" height="6.5" rx="3" fill="#3b82f6" />
            <rect x="-18" y="-27" width="7.5" height="22" rx="3.75" fill="url(#dcv2ChairBlue)" transform="rotate(-22 -14 -16)" />
            <circle cx="-17.5" cy="-28.5" r="3.8" fill="#1d4ed8" />
            <rect x="-7" y="-11.5" width="12" height="2.6" rx="1.3" fill="#dbeafe" />
            <path d="M18 -6 L27 -30 L14 -37" stroke="#cbd5e1" strokeWidth="2" fill="none" strokeLinecap="round" />
            <ellipse cx="11" cy="-38.5" rx="6" ry="4" fill="#fff" stroke="#cbd5e1" />
            <circle cx="11" cy="-38" r="1.8" fill="#fde68a" />
            <rect x="26" y="-3" width="11" height="11" rx="1.5" fill="#f1f5f9" stroke="#dfe6ef" />
          </g>
          {/* recepción */}
          <g transform="translate(138,216)">
            <ellipse cx="4" cy="12" rx="34" ry="8" fill="rgba(30,58,138,.10)" />
            <polygon points="-28,-14 28,-14 36,-4 -20,-4" fill="#f5d0a4" />
            <polygon points="-20,-4 36,-4 36,9 -20,9" fill="#e9b878" />
            <polygon points="-28,-14 -20,-4 -20,9 -28,-1" fill="#dda963" />
            <rect x="-4" y="-27" width="15" height="10" rx="1.5" fill="#0f172a" />
            <rect x="2" y="-17" width="3" height="4" fill="#475569" />
            <circle cx="-16" cy="-22" r="4.5" fill="#a78bfa" />
            <rect x="-21" y="-18" width="10" height="8" rx="4" fill="#7c3aed" />
          </g>
          {/* banca de espera */}
          <g transform="translate(346,214)">
            <ellipse cx="0" cy="11" rx="32" ry="7" fill="rgba(30,58,138,.10)" />
            <rect x="-28" y="-5" width="56" height="7" rx="3.5" fill="#dbeafe" stroke="#bfdbfe" />
            <rect x="-24" y="2" width="4" height="7" fill="#94a3b8" /><rect x="20" y="2" width="4" height="7" fill="#94a3b8" />
            <circle cx="-12" cy="-13" r="4.5" fill="#93c5fd" /><rect x="-17" y="-9" width="10" height="7" rx="3.5" fill="#60a5fa" />
            <circle cx="8" cy="-13" r="4.5" fill="#fbbf24" /><rect x="3" y="-9" width="10" height="7" rx="3.5" fill="#f59e0b" />
          </g>
          {/* plantas */}
          <g transform="translate(58,158)">
            <ellipse cx="0" cy="9" rx="12" ry="4" fill="rgba(30,58,138,.10)" />
            <polygon points="-7,0 7,0 5,9 -5,9" fill="#e9b878" />
            <ellipse cx="-4" cy="-7" rx="5" ry="8" fill="#4ade80" /><ellipse cx="4" cy="-8" rx="5" ry="9" fill="#22c55e" /><ellipse cx="0" cy="-13" rx="4" ry="7" fill="#86efac" />
          </g>
          <g transform="translate(424,158)">
            <ellipse cx="0" cy="9" rx="12" ry="4" fill="rgba(30,58,138,.10)" />
            <polygon points="-7,0 7,0 5,9 -5,9" fill="#e9b878" />
            <ellipse cx="-4" cy="-7" rx="5" ry="8" fill="#4ade80" /><ellipse cx="4" cy="-8" rx="5" ry="9" fill="#22c55e" /><ellipse cx="0" cy="-13" rx="4" ry="7" fill="#86efac" />
          </g>
          {/* TV de pared */}
          <rect x="222" y="18" width="36" height="21" rx="2" fill="#0f172a" stroke="#475569" transform="skewY(-24) translate(0 118)" />
        </svg>
        <span style={{ position: "absolute", left: "19%", top: "24%", transform: "translateX(-50%)", background: "#dcfce7", color: "#15803d", fontWeight: 800, fontSize: 8, padding: "3px 8px", borderRadius: 999, border: "1px solid #bbf7d0", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(15,23,42,.12)" }}>● Ana Torres · En atención</span>
        <span style={{ position: "absolute", left: "50%", top: "44%", transform: "translateX(-50%)", background: "#eff6ff", color: "#1d4ed8", fontWeight: 800, fontSize: 8, padding: "3px 8px", borderRadius: 999, border: "1px solid #bfdbfe", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(15,23,42,.12)" }}>Sillón libre</span>
        <span style={{ position: "absolute", right: "6%", top: "24%", background: "#fef3c7", color: "#b45309", fontWeight: 800, fontSize: 8, padding: "3px 8px", borderRadius: 999, border: "1px solid #fde68a", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(15,23,42,.12)" }}>● J. Medina · Esperando</span>
        <span style={{ position: "absolute", left: "8%", bottom: "9%", background: "#7c3aed", color: "#fff", fontWeight: 700, fontSize: 8, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(15,23,42,.2)" }}>Recepción · 2 en espera</span>
        <span style={{ position: "absolute", right: "3%", bottom: "5%", fontSize: 8, color: "#64748b", fontWeight: 600, background: "rgba(255,255,255,.85)", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 7px" }}>↻ Arrastra para recorrerla</span>
      </div>
    </BrowserFrame>
  );
}

/* ── 7. WhatsApp + Asistente IA FUSIONADO (CAMBIOS §1): ventana dividida —
      chat del bot | tarjetas IA con /comandos. ── */
export function InboxIaSplitMock() {
  return (
    <BrowserFrame
      url="app.dalecontrol.com/inbox"
      right={<span style={{ marginLeft: "auto", fontSize: 8.5, fontWeight: 800, color: "#16a34a", background: "#dcfce7", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>● Bot activo</span>}
    >
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 200, borderRight: "1px solid #eef2f7", padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
            <span style={{ display: "flex", width: 20, height: 20, borderRadius: "50%", background: "#16a34a", color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800 }}>W</span>
            <b style={{ fontSize: 10.5 }}>Inbox WhatsApp</b>
          </div>
          <div style={{ alignSelf: "flex-start", background: "#f1f5f9", borderRadius: "11px 11px 11px 4px", padding: "7px 10px", maxWidth: "92%", fontSize: 10 }}>Hola, ¿tienen espacio para limpieza esta semana?</div>
          <div style={{ alignSelf: "flex-end", background: "#dcfce7", borderRadius: "11px 11px 4px 11px", padding: "7px 10px", maxWidth: "92%", fontSize: 10 }}>¡Claro! Tengo jueves 12:00 o viernes 10:30. ¿Cuál prefieres? 🤖</div>
          <div style={{ alignSelf: "flex-start", background: "#f1f5f9", borderRadius: "11px 11px 11px 4px", padding: "7px 10px", maxWidth: "92%", fontSize: 10 }}>Viernes 10:30 👍</div>
          <div style={{ alignSelf: "center", background: "#f1ebfe", border: "1px solid #e2d8fb", color: "#6d28d9", fontWeight: 700, borderRadius: 999, padding: "4px 11px", fontSize: 8.5, textAlign: "center" }}>✓ El bot agendó: viernes 10:30 · Limpieza</div>
          <div style={{ marginTop: "auto", fontSize: 8.5, color: "#94a3b8" }}><span style={{ color: "#6d28d9", fontWeight: 700 }}>✦ Recall:</span> Elena Castro · 6 meses sin venir → mensaje enviado</div>
        </div>
        <div style={{ flex: "1 1 190px", minWidth: 190, padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
            <span style={{ display: "flex", width: 20, height: 20, borderRadius: 6, background: "#7c3aed", color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 10 }}>✦</span>
            <b style={{ fontSize: 10.5 }}>Asistente IA Clínico</b>
          </div>
          <div style={{ border: "1px solid #eeeaf8", borderRadius: 9, padding: 8 }}><div style={{ fontSize: 10, fontWeight: 700 }}>⚕ Diagnóstico diferencial</div><div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>Paciente con síntomas X/Y/Z, dame DDx</div></div>
          <div style={{ border: "1px solid #eeeaf8", borderRadius: 9, padding: 8 }}><div style={{ fontSize: 10, fontWeight: 700 }}>▤ Redactar nota SOAP</div><div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>Estructura una nota de evolución</div></div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: "#6d28d9", background: "#f1ebfe", borderRadius: 999, padding: "3px 8px" }}>/soap</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "#475569", border: "1px solid #e8e3f6", borderRadius: 999, padding: "3px 8px" }}>/receta</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "#475569", border: "1px solid #e8e3f6", borderRadius: 999, padding: "3px 8px" }}>Resumir historia</span>
          </div>
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 6, border: "1px solid #e8e3f6", borderRadius: 9, padding: "7px 9px" }}>
            <span style={{ flex: 1, fontSize: 8.5, color: "#94a3b8" }}>Pregúntame o escribe / …</span>
            <span style={{ display: "flex", width: 19, height: 19, borderRadius: 6, background: "#7c3aed", color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 9 }}>➤</span>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── 10. Analytics (trío) ──────────────────────────────────────────────── */
export function AnalyticsMock() {
  const tab: CSSProperties = { color: "#64748b", border: "1px solid #eeeaf8", borderRadius: 999, padding: "3px 8px" };
  const stat: CSSProperties = { border: "1px solid #eeeaf8", borderRadius: 8, padding: 7 };
  return (
    <BrowserFrame url="…/analytics" small stretch shadow="0 12px 30px rgba(15,23,42,.08)">
      <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10, fontSize: 8, fontWeight: 700 }}>
          <span style={{ background: "#f1ebfe", color: "#6d28d9", borderRadius: 999, padding: "3px 8px" }}>Resumen</span>
          <span style={tab}>Ocupación</span>
          <span style={tab}>Doctores</span>
          <span style={tab}>No-shows</span>
          <span style={tab}>Costos &amp; Margen</span>
          <span style={tab}>CRM</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <svg viewBox="0 0 84 50" style={{ width: 96, flex: "0 0 auto" }} aria-hidden="true">
            <path d="M10 46 A34 34 0 0 1 74 46" fill="none" stroke="#e9e3f8" strokeWidth="7" strokeLinecap="round" />
            <path d="M10 46 A34 34 0 0 1 66 22" fill="none" stroke="#7c3aed" strokeWidth="7" strokeLinecap="round" />
            <text x="42" y="40" textAnchor="middle" fontSize="15" fontWeight="800" fill="#0f172a">87</text>
            <text x="42" y="48" textAnchor="middle" fontSize="6" fill="#94a3b8">de 100</text>
          </svg>
          <div>
            <div style={{ fontSize: 8, color: "#94a3b8", fontWeight: 800, letterSpacing: ".05em" }}>EFICIENCIA OPERATIVA</div>
            <div style={{ fontSize: 9.5, color: "#16a34a", fontWeight: 700, marginTop: 2 }}>● Capacidad bien utilizada</div>
            <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 2 }}>Tiempo promedio de espera: 8 min</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
          <div style={stat}><div style={{ fontSize: 6.5, color: "#94a3b8", fontWeight: 800 }}>CITAS DEL MES</div><div style={{ fontSize: 12, fontWeight: 800 }}>212</div><div style={{ fontSize: 7, color: "#16a34a", fontWeight: 700 }}>▲ +12%</div></div>
          <div style={stat}><div style={{ fontSize: 6.5, color: "#94a3b8", fontWeight: 800 }}>COMPLETADAS</div><div style={{ fontSize: 12, fontWeight: 800 }}>94%</div><div style={{ fontSize: 7, color: "#94a3b8" }}>del total</div></div>
          <div style={stat}><div style={{ fontSize: 6.5, color: "#94a3b8", fontWeight: 800 }}>NO-SHOWS</div><div style={{ fontSize: 12, fontWeight: 800 }}>2.1%</div><div style={{ fontSize: 7, color: "#16a34a", fontWeight: 700 }}>▼ mejora</div></div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── 11. Equipo (trío) ─────────────────────────────────────────────────── */
export function EquipoMock() {
  const stat: CSSProperties = { border: "1px solid #eeeaf8", borderRadius: 8, padding: 7, textAlign: "center" };
  return (
    <BrowserFrame url="…/equipo" small stretch shadow="0 12px 30px rgba(15,23,42,.08)">
      <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <span><b style={{ fontSize: 11.5 }}>Equipo médico</b><br /><span style={{ fontSize: 8.5, color: "#94a3b8" }}>Rafael Clinica · 3 miembros activos</span></span>
          <span style={{ fontSize: 9, color: "#fff", fontWeight: 700, background: "#7c3aed", borderRadius: 7, padding: "4px 9px", whiteSpace: "nowrap" }}>+ Invitar miembro</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 10 }}>
          <div style={stat}><div style={{ fontSize: 6.5, color: "#94a3b8", fontWeight: 800 }}>ACTIVOS</div><div style={{ fontSize: 13, fontWeight: 800 }}>3</div></div>
          <div style={stat}><div style={{ fontSize: 6.5, color: "#94a3b8", fontWeight: 800 }}>DOCTORES</div><div style={{ fontSize: 13, fontWeight: 800 }}>2</div></div>
          <div style={stat}><div style={{ fontSize: 6.5, color: "#94a3b8", fontWeight: 800 }}>ADMINS</div><div style={{ fontSize: 13, fontWeight: 800 }}>1</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ border: "1px solid #eeeaf8", borderRadius: 10, padding: 9, textAlign: "center" }}>
            <span style={{ display: "inline-flex", width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#a78bfa)", color: "#fff", fontSize: 8, fontWeight: 800, alignItems: "center", justifyContent: "center", marginBottom: 4 }}>RM</span>
            <div style={{ fontSize: 9.5, fontWeight: 700 }}>Rafael Martinez <span style={{ fontSize: 6.5, color: "#94a3b8", border: "1px solid #eeeaf8", borderRadius: 99, padding: "1px 4px" }}>Tú</span></div>
            <div style={{ margin: "4px 0" }}><span style={{ fontSize: 6.5, fontWeight: 800, color: "#6d28d9", background: "#f1ebfe", borderRadius: 99, padding: "2px 6px" }}>● SUPER ADMIN</span></div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, fontSize: 7, color: "#94a3b8", fontWeight: 700 }}>CITAS <b style={{ color: "#0f172a", fontSize: 9 }}>57</b> EXPED. <b style={{ color: "#0f172a", fontSize: 9 }}>34</b></div>
          </div>
          <div style={{ border: "1px solid #eeeaf8", borderRadius: 10, padding: 9, textAlign: "center" }}>
            <span style={{ display: "inline-flex", width: 26, height: 26, borderRadius: "50%", background: "#0d9488", color: "#fff", fontSize: 8, fontWeight: 800, alignItems: "center", justifyContent: "center", marginBottom: 4 }}>JG</span>
            <div style={{ fontSize: 9.5, fontWeight: 700 }}>Jorge Garcia</div>
            <div style={{ margin: "4px 0" }}><span style={{ fontSize: 6.5, fontWeight: 800, color: "#15803d", background: "#dcfce7", borderRadius: 99, padding: "2px 6px" }}>● DOCTOR/A</span></div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, fontSize: 7, color: "#475569", fontWeight: 700 }}>
              <span style={{ border: "1px solid #eeeaf8", borderRadius: 5, padding: "2px 6px" }}>✎ Editar</span>
              <span style={{ border: "1px solid #eeeaf8", borderRadius: 5, padding: "2px 6px" }}>⛨ Permisos</span>
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── 12. Página web (trío) ─────────────────────────────────────────────── */
export function PaginaWebMock() {
  const chip: CSSProperties = { border: "1px solid #eeeaf8", borderRadius: 99, padding: "2px 7px" };
  return (
    <BrowserFrame url="…/pagina-web" small stretch shadow="0 12px 30px rgba(15,23,42,.08)">
      <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9, gap: 8 }}>
          <span><b style={{ fontSize: 11.5 }}>Página pública de tu clínica</b><br /><span style={{ fontSize: 8.5, color: "#94a3b8" }}>Cómo te verán tus pacientes</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 8.5, fontWeight: 800, color: "#16a34a", background: "#dcfce7", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>● Publicada</span>
        </div>
        <div style={{ background: "#f4f7ff", border: "1px solid #dbe4fb", borderRadius: 8, padding: "7px 10px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 8.5, color: "#1e40af", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>dalecontrol.com/rafael-clinica</span>
          <span style={{ fontSize: 8, color: "#2563eb", fontWeight: 800, whiteSpace: "nowrap" }}>⧉ Copiar</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 9, fontSize: 7.5, fontWeight: 700, color: "#64748b" }}>
          <span style={{ background: "#f1ebfe", color: "#6d28d9", borderRadius: 99, padding: "2px 7px" }}>Plantilla</span>
          <span style={chip}>General</span><span style={chip}>Servicios</span><span style={chip}>Testimonios</span><span style={chip}>FAQs</span><span style={chip}>Galería</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 9, fontSize: 7, fontWeight: 700, color: "#475569", textAlign: "center" }}>
          <span><span style={{ display: "block", height: 30, borderRadius: 6, background: "linear-gradient(160deg,#2563eb,#60a5fa)", marginBottom: 3 }} />Clásico</span>
          <span><span style={{ display: "block", height: 30, borderRadius: 6, background: "linear-gradient(160deg,#6d28d9,#0f172a)", marginBottom: 3 }} />Futurista</span>
          <span style={{ position: "relative" }}>
            <span style={{ display: "block", height: 30, borderRadius: 6, background: "linear-gradient(160deg,#34d399,#a7f3d0)", marginBottom: 3, border: "1.5px solid #16a34a" }} />Healthtech
            <span style={{ position: "absolute", top: -4, right: -2, background: "#16a34a", color: "#fff", fontSize: 6, borderRadius: 99, padding: "1px 4px" }}>✓</span>
          </span>
          <span><span style={{ display: "block", height: 30, borderRadius: 6, background: "linear-gradient(160deg,#fbbf24,#fb923c)", marginBottom: 3 }} />Cálido</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ flex: 1, textAlign: "center", border: "1px solid #eeeaf8", color: "#475569", fontSize: 8.5, fontWeight: 700, borderRadius: 7, padding: 6 }}>◉ Previsualizar</span>
          <span style={{ flex: 1.4, textAlign: "center", background: "#7c3aed", color: "#fff", fontSize: 8.5, fontWeight: 700, borderRadius: 7, padding: 6 }}>✓ Aplicar / Usar esta plantilla</span>
        </div>
      </div>
    </BrowserFrame>
  );
}
