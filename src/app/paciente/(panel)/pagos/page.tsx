"use client";

// Pagos del paciente. Implementa A8.
// Datos: usePacienteData<PacientePagosResponse>("/api/paciente/payments").
// · Cards resumen arriba: "Pagado" (totals.paidTotal) y "Pendiente"
//   (totals.pendingTotal) con formatMxn; si 2+ clínicas, desglose byClinic.
// · ClinicFilterChips si hay 2+ clínicas.
// · Lista de facturas desc: invoiceNumber, fecha (formatFecha), StatusBadge
//   kind="factura", total/paid/balance (formatMxn). Pendientes resaltadas.
// · Estados vacíos. Responsive: tabla fluida desktop / cards móvil, sin
//   anchos fijos con scroll cortado.
// · Acciones por factura (A3): "Pagar ahora" → POST /api/paciente/payments/
//   checkout {invoiceId} → redirige a {url} (solo si la clínica tiene
//   onlinePaymentEnabled); si no, "Paga en tu clínica". "Recibo (PDF)" si
//   paid > 0 → GET /api/paciente/invoices/[id]/receipt en pestaña nueva.
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type { PacienteFactura, PacientePagosResponse } from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  ClinicFilterChips,
  StatusBadge,
  clinicName,
  formatMxn,
  formatFecha,
} from "@/components/paciente/ui";

const GREEN = "#34d399";
const AMBER = "#fbbf24";
const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";
const DIVIDER = "1px solid rgba(255,255,255,0.08)";

const summaryGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
  gap: 12,
};

// Cada factura es un grid responsive sin anchos fijos ni scroll horizontal:
// · <768px: auto-fit apila las celdas como card (1 col en ~360px, 2-3 según
//   quepan mínimos de 150px).
// · ≥768px: 5 columnas fijas proporcionales (minmax(0,…fr)) para que todas
//   las filas alineen entre sí (efecto tabla). auto-fit solo no alcanza
//   5×150px con sidebar de 240px en viewports de 1024-1125px (~700px útiles).
const facturaRowCss = `
.a8FacturaRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px;align-items:center;padding:12px 2px}
@media (min-width:768px){.a8FacturaRow{grid-template-columns:minmax(0,1.6fr) repeat(3,minmax(0,1fr)) minmax(0,1.2fr)}}
`;

const breakdownBox: CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: DIVIDER,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
};

const breakdownRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 12,
};

const retryBtn: CSSProperties = {
  background: "#7c3aed",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export default function PacientePagosPage() {
  const { data, error, isLoading, mutate } =
    usePacienteData<PacientePagosResponse>("/api/paciente/payments");
  const [clinicFilter, setClinicFilter] = useState<string | null>(null);

  if (error && !data) {
    return (
      <PageShell>
        <PacienteCard>
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <p style={{ color: MUTED, margin: "0 0 14px" }}>
              No pudimos cargar tus pagos. Revisa tu conexión e intenta de nuevo.
            </p>
            <button type="button" onClick={() => mutate()} style={retryBtn}>
              Reintentar
            </button>
          </div>
        </PacienteCard>
      </PageShell>
    );
  }

  if (isLoading || !data) return <PagosSkeleton />;

  const { clinics, invoices, totals, byClinic } = data;
  const multiClinic = clinics.length > 1;
  const visibles = clinicFilter
    ? invoices.filter((f) => f.clinicId === clinicFilter)
    : invoices;

  return (
    <PageShell>
      <div style={summaryGrid}>
        <PacienteCard title="Pagado">
          <div style={{ fontSize: 26, fontWeight: 700, color: GREEN }}>
            {formatMxn(totals.paidTotal)}
          </div>
          {multiClinic && byClinic.length > 0 && (
            <div style={breakdownBox}>
              {byClinic.map((b) => (
                <div key={b.clinicId} style={breakdownRow}>
                  <span style={{ color: MUTED }}>{clinicName(clinics, b.clinicId)}</span>
                  <span style={{ color: TEXT, fontWeight: 600 }}>{formatMxn(b.paid)}</span>
                </div>
              ))}
            </div>
          )}
        </PacienteCard>

        <PacienteCard title="Pendiente">
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: totals.pendingTotal > 0 ? AMBER : MUTED,
            }}
          >
            {formatMxn(totals.pendingTotal)}
          </div>
          {multiClinic && byClinic.length > 0 && (
            <div style={breakdownBox}>
              {byClinic.map((b) => (
                <div key={b.clinicId} style={breakdownRow}>
                  <span style={{ color: MUTED }}>{clinicName(clinics, b.clinicId)}</span>
                  <span
                    style={{ color: b.pending > 0 ? AMBER : MUTED, fontWeight: 600 }}
                  >
                    {formatMxn(b.pending)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </PacienteCard>
      </div>

      <ClinicFilterChips clinics={clinics} value={clinicFilter} onChange={setClinicFilter} />

      {visibles.length === 0 ? (
        <PacienteEmptyState
          message={
            invoices.length === 0
              ? "Aún no tienes facturas"
              : "No hay facturas de esta clínica"
          }
        />
      ) : (
        <PacienteCard title="Facturas">
          <style>{facturaRowCss}</style>
          <div>
            {visibles.map((f, i) => (
              <FacturaRow
                key={f.id}
                factura={f}
                first={i === 0}
                clinicLabel={multiClinic ? clinicName(clinics, f.clinicId) : null}
                onlinePaymentEnabled={
                  clinics.find((c) => c.clinicId === f.clinicId)?.onlinePaymentEnabled ===
                  true
                }
              />
            ))}
          </div>
        </PacienteCard>
      )}
    </PageShell>
  );
}

/** Título + layout vertical común a todos los estados de la página. */
function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT }}>Tus pagos</h1>
      {children}
    </div>
  );
}

function FacturaRow({
  factura: f,
  first,
  clinicLabel,
  onlinePaymentEnabled,
}: {
  factura: PacienteFactura;
  first: boolean;
  clinicLabel: string | null;
  onlinePaymentEnabled: boolean;
}) {
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const saldoPendiente = f.balance > 0 && f.status !== "CANCELLED";

  async function handlePagar() {
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch("/api/paciente/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: f.id }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.url) {
        // Mantiene "Abriendo pago…" deshabilitado mientras redirige.
        window.location.href = data.url;
        return;
      }
      setPayError((data && data.error) || "No se pudo iniciar el pago. Intenta de nuevo.");
      setPaying(false);
    } catch {
      setPayError("No se pudo iniciar el pago. Intenta de nuevo.");
      setPaying(false);
    }
  }

  return (
    <div className="a8FacturaRow" style={{ borderTop: first ? "none" : DIVIDER }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ color: TEXT, fontWeight: 600, fontSize: 15 }}>
            Factura {f.invoiceNumber}
          </span>
          <StatusBadge kind="factura" value={f.status} />
        </div>
        <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>
          {formatFecha(f.createdAt)}
          {clinicLabel ? ` · ${clinicLabel}` : ""}
        </div>
      </div>
      <Monto label="Total" value={formatMxn(f.total)} />
      <Monto label="Pagado" value={formatMxn(f.paid)} />
      <Monto
        label="Saldo"
        value={formatMxn(f.balance)}
        color={saldoPendiente ? AMBER : MUTED}
      />
      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 6,
        }}
      >
        {saldoPendiente &&
          (onlinePaymentEnabled ? (
            <div style={{ minWidth: 0, maxWidth: "100%" }}>
              <button
                type="button"
                onClick={handlePagar}
                disabled={paying}
                style={{
                  background: "#7c3aed",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: paying ? "default" : "pointer",
                  minHeight: 38,
                  // Cubre el ancho de "Abriendo pago…" para que el botón no
                  // salte al entrar al estado loading.
                  minWidth: 132,
                  maxWidth: "100%",
                  opacity: paying ? 0.7 : 1,
                }}
              >
                {paying ? "Abriendo pago…" : "Pagar ahora"}
              </button>
              {payError && (
                <div role="alert" style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>
                  {payError}
                </div>
              )}
            </div>
          ) : (
            <span style={{ color: MUTED, fontSize: 13 }}>Paga en tu clínica</span>
          ))}
        {f.paid > 0 && (
          <a
            href={"/api/paciente/invoices/" + f.id + "/receipt"}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={"Recibo PDF de la factura " + f.invoiceNumber}
            style={{
              // Área táctil ≥34px y aire respecto al botón "Pagar ahora".
              display: "inline-flex",
              alignItems: "center",
              minHeight: 34,
              padding: "2px 10px 2px 0",
              color: "#a78bfa",
              fontSize: 13,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Recibo (PDF)
          </a>
        )}
      </div>
    </div>
  );
}

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

function PagosSkeleton() {
  return (
    <PageShell>
      <style>{`@keyframes a8PagosPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <div style={summaryGrid}>
        <div style={skeletonBlock(112)} />
        <div style={skeletonBlock(112)} />
      </div>
      <div style={skeletonBlock(260)} />
    </PageShell>
  );
}

function skeletonBlock(height: number): CSSProperties {
  return {
    height,
    borderRadius: 14,
    background: "rgba(255,255,255,0.06)",
    animation: "a8PagosPulse 1.4s ease-in-out infinite",
  };
}
