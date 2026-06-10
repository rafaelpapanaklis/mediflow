"use client";

// Tab "Recibos de pago" del portal del paciente — Implementa D8 (WS1-T6).
// Props FIJAS (page.tsx ya las pasa así — NO cambiarlas).
// Referencia visual: FacturaRow + Monto de src/app/paciente/(panel)/pagos/page.tsx.
//
// · Filtra por clinicFilter (r.clinicId). Vacíos:
//   - sin recibos: <PacienteEmptyState message="Aún no tienes pagos
//     registrados" />
//   - filtro oculta todo: "No hay pagos de esta clínica".
// · Lista dentro de <PacienteCard title="Recibos de pago">. Por fila (grid
//   responsive estilo FacturaRow, sin anchos fijos, dividers):
//   - Monto formatMxn(amount) (fontSize 15, fontWeight 600): verde #34d399
//     normal; ROJO #f87171 si es reembolso (method en {refund, reembolso} o
//     amount < 0).
//   - Método mapeado a español (helper local metodoLabel(method)):
//     cash|efectivo→"Efectivo", card|tarjeta→"Tarjeta",
//     transfer|transferencia→"Transferencia", refund|reembolso→"Reembolso";
//     otro → primera letra mayúscula tal cual.
//   - formatFecha(paidAt) muted.
//   - "Factura {invoiceNumber}" muted.
//   - Etiqueta de clínica si clinics.length > 1 (clinicName()).
//   - <a href={`/api/paciente/recibos/${r.id}/pdf`}> "Descargar PDF" (botón
//     outline violeta pequeño: borde 1px solid rgba(139,92,246,0.5), color
//     #a78bfa, borderRadius 10, fontSize 12.5, fontWeight 600, padding
//     "6px 12px", textDecoration none, whiteSpace nowrap).
// · Español neutro con tú. Responsive SIEMPRE.
import type { CSSProperties } from "react";
import type { PacienteClinica, PacienteRecibo } from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  clinicName,
  formatFecha,
  formatMxn,
} from "@/components/paciente/ui";

const GREEN = "#34d399";
const RED = "#f87171";
const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";
const DIVIDER = "1px solid rgba(255,255,255,0.08)";

// Misma grilla fluida de FacturaRow (pagos): tabla alineada en desktop y
// celdas apiladas como card en pantallas angostas — sin anchos fijos ni
// scroll horizontal.
const rowGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
  gap: 10,
  alignItems: "center",
  padding: "12px 2px",
};

const pdfBtn: CSSProperties = {
  display: "inline-block",
  justifySelf: "start",
  background: "transparent",
  border: "1px solid rgba(139,92,246,0.5)",
  color: "#a78bfa",
  borderRadius: 10,
  fontSize: 12.5,
  fontWeight: 600,
  padding: "6px 12px",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

export function TabRecibos({
  recibos,
  clinics,
  clinicFilter,
}: {
  recibos: PacienteRecibo[];
  clinics: PacienteClinica[];
  clinicFilter: string | null;
}) {
  const multiClinic = clinics.length > 1;
  const visibles = clinicFilter
    ? recibos.filter((r) => r.clinicId === clinicFilter)
    : recibos;

  if (visibles.length === 0) {
    return (
      <PacienteEmptyState
        message={
          recibos.length === 0
            ? "Aún no tienes pagos registrados"
            : "No hay pagos de esta clínica"
        }
      />
    );
  }

  return (
    <PacienteCard title="Recibos de pago">
      <div>
        {visibles.map((r, i) => (
          <ReciboRow
            key={r.id}
            recibo={r}
            first={i === 0}
            clinicLabel={multiClinic ? clinicName(clinics, r.clinicId) : null}
          />
        ))}
      </div>
    </PacienteCard>
  );
}

/** Mapea Payment.method (crudo de DB) a su etiqueta en español. */
function metodoLabel(method: string): string {
  switch ((method || "").toLowerCase()) {
    case "cash":
    case "efectivo":
      return "Efectivo";
    case "card":
    case "tarjeta":
      return "Tarjeta";
    case "transfer":
    case "transferencia":
      return "Transferencia";
    case "refund":
    case "reembolso":
      return "Reembolso";
    default:
      return method ? method.charAt(0).toUpperCase() + method.slice(1) : method;
  }
}

/** Un reembolso se pinta en rojo: method refund/reembolso o monto negativo. */
function esReembolso(r: PacienteRecibo): boolean {
  const m = (r.method || "").toLowerCase();
  return m === "refund" || m === "reembolso" || r.amount < 0;
}

function ReciboRow({
  recibo: r,
  first,
  clinicLabel,
}: {
  recibo: PacienteRecibo;
  first: boolean;
  clinicLabel: string | null;
}) {
  const reembolso = esReembolso(r);
  return (
    <div style={{ ...rowGrid, borderTop: first ? "none" : DIVIDER }}>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: reembolso ? RED : GREEN,
            whiteSpace: "nowrap",
          }}
        >
          {formatMxn(r.amount)}
        </div>
        <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>
          {formatFecha(r.paidAt)}
          {clinicLabel ? ` · ${clinicLabel}` : ""}
        </div>
      </div>
      <Monto label="Método" value={metodoLabel(r.method)} />
      <div style={{ color: MUTED, fontSize: 13, minWidth: 0, overflowWrap: "anywhere" }}>
        Factura {r.invoiceNumber}
      </div>
      <a href={`/api/paciente/recibos/${r.id}/pdf`} style={pdfBtn}>
        Descargar PDF
      </a>
    </div>
  );
}

/** Celda etiqueta+valor (copia local del Monto de pagos/page.tsx). */
function Monto({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: MUTED }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: color || TEXT, whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}
