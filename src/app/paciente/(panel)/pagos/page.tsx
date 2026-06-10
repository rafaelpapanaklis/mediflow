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

// Cada factura es un grid responsive: en desktop se alinea como tabla fluida
// (mismas columnas en todas las filas) y en pantallas angostas las celdas
// se apilan como card — sin anchos fijos ni scroll horizontal.
const rowGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
  gap: 10,
  alignItems: "center",
  padding: "12px 2px",
};

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
          <div>
            {visibles.map((f, i) => (
              <FacturaRow
                key={f.id}
                factura={f}
                first={i === 0}
                clinicLabel={multiClinic ? clinicName(clinics, f.clinicId) : null}
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
}: {
  factura: PacienteFactura;
  first: boolean;
  clinicLabel: string | null;
}) {
  const saldoPendiente = f.balance > 0 && f.status !== "CANCELLED";
  return (
    <div style={{ ...rowGrid, borderTop: first ? "none" : DIVIDER }}>
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
