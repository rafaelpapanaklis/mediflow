import { Fragment } from "react";
import { Check } from "lucide-react";

type V = boolean | string;
type Row = { f: string; b: V; p: V; c: V };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  { title: "Esenciales · en los 3 planes", rows: [
    { f: "Agenda + Google Calendar", b: true, p: true, c: true },
    { f: "Recordatorios por WhatsApp", b: true, p: true, c: true },
    { f: "Expediente + odontograma", b: true, p: true, c: true },
    { f: "Recetas digitales (QR + cédula)", b: true, p: true, c: true },
    { f: "Facturación CFDI 4.0", b: true, p: true, c: true },
    { f: "Portal del paciente", b: true, p: true, c: true },
    { f: "Inbox / mensajes", b: true, p: true, c: true },
    { f: "Presupuestos y cotizaciones", b: true, p: true, c: true },
    { f: "Pagos en línea del paciente", b: true, p: true, c: true },
    { f: "Recordatorios + recall automático", b: true, p: true, c: true },
    { f: "Importar mi clínica (migración)", b: true, p: true, c: true },
    { f: "Página web + directorio público", b: true, p: true, c: true },
  ]},
  { title: "Límites", rows: [
    { f: "Pacientes", b: "200", p: "Ilimitados", c: "Ilimitados" },
    { f: "Usuarios", b: "2", p: "6", c: "Ilimitados" },
    { f: "Almacenamiento", b: "5 GB", p: "15 GB", c: "75 GB" },
    { f: "WhatsApp / mes", b: "300+", p: "1,500+", c: "6,000+" },
  ]},
  { title: "Inteligencia y gestión avanzada · Pro y Clínica", rows: [
    { f: "IA: radiografías con análisis", b: false, p: true, c: true },
    { f: "IA: asistente clínico", b: false, p: true, c: true },
    { f: "Tokens de IA / mes", b: "—", p: "200 mil", c: "1 millón" },
    { f: "Analytics y reportes", b: false, p: true, c: true },
    { f: "Pantallas TV (sala de espera)", b: false, p: true, c: true },
    { f: "Mi Clínica Visual 3D", b: false, p: true, c: true },
    { f: "Visor CBCT / 3D dental", b: false, p: true, c: true },
    { f: "Proveedores e insumos", b: false, p: true, c: true },
    { f: "Órdenes a laboratorios", b: false, p: true, c: true },
  ]},
  { title: "Solo Clínica", rows: [
    { f: "Varias clínicas en una cuenta", b: false, p: false, c: true },
    { f: "Roles avanzados", b: false, p: false, c: true },
    { f: "Soporte prioritario", b: false, p: false, c: true },
    { f: "Onboarding dedicado", b: false, p: false, c: true },
  ]},
  { title: "En todos", rows: [
    { f: "Soporte en español · sin permanencia", b: true, p: true, c: true },
    { f: "Garantía de 30 días", b: true, p: true, c: true },
    { f: "Cumplimiento NOM-024", b: true, p: true, c: true },
  ]},
];

function PlanCell({ v, highlight }: { v: V; highlight?: boolean }) {
  return (
    <td style={{ textAlign: "center", padding: "11px 10px", background: highlight ? "rgba(124,58,237,0.05)" : undefined }}>
      {v === true ? (
        <Check size={18} style={{ color: "#7c3aed" }} aria-label="Incluido" />
      ) : v === false ? (
        <span style={{ color: "#cbd5e1" }} aria-label="No incluido">—</span>
      ) : (
        <span style={{ fontWeight: 600, color: "#0f172a" }}>{v}</span>
      )}
    </td>
  );
}

export function PlanComparison() {
  return (
    <section className="mfh-section mfh-band--soft" id="comparar-planes" aria-label="Comparativa de planes">
      <div className="mfh-container">
        <div className="mfh-head mfh-center mfh-reveal">
          <span className="mfh-kicker">Comparativa</span>
          <h2 className="mfh-h2 mfh-balance">Qué incluye cada plan</h2>
          <p className="mfh-lede">Todas las funciones de DaleControl y en qué plan están.</p>
        </div>
        <div className="mfh-reveal" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 580, fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "12px 14px", color: "#64748b", fontWeight: 600 }}>Función</th>
                <th style={{ padding: "12px 10px", fontWeight: 700, color: "#0f172a" }}>Básico</th>
                <th style={{ padding: "12px 10px", fontWeight: 700, color: "#7c3aed", background: "rgba(124,58,237,0.05)" }}>Profesional</th>
                <th style={{ padding: "12px 10px", fontWeight: 700, color: "#0f172a" }}>Clínica</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => (
                <Fragment key={g.title}>
                  <tr>
                    <td colSpan={4} style={{ padding: "18px 14px 6px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#7c3aed" }}>{g.title}</td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.f} style={{ borderTop: "1px solid rgba(100,116,139,0.15)" }}>
                      <td style={{ padding: "11px 14px", color: "#0f172a" }}>{r.f}</td>
                      <PlanCell v={r.b} />
                      <PlanCell v={r.p} highlight />
                      <PlanCell v={r.c} />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
