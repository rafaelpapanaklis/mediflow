"use client";
// Implants — panel lateral derecho con datos técnicos en mono.
// Lotes en color amber para visibilidad COFEPRIS. Spec §6.6.

import type { ImplantFull } from "@/lib/types/implants";

function Row({ label, value, mono = true, accent = false }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 text-xs py-0.5">
      <span className="text-[var(--text-3,theme(colors.gray.500))]">{label}</span>
      <span
        className={[
          mono ? "font-mono" : "",
          accent ? "text-amber-600 dark:text-amber-400 font-medium" : "text-[var(--text-1,theme(colors.gray.900))]",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-3,theme(colors.gray.500))] font-medium">
        {title}
      </h4>
      <div>{children}</div>
    </div>
  );
}

function fmtShort(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function daysSince(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  return `${days} días`;
}

export interface ImplantSidePanelProps {
  implant: ImplantFull;
}

export function ImplantSidePanel({ implant }: ImplantSidePanelProps) {
  const inFunctionSince =
    implant.prostheticPhase?.prosthesisDeliveredAt ?? null;

  return (
    <aside className="border-l border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800 p-4 space-y-4 text-sm w-full md:w-72 flex-shrink-0">
      <Section title="Implante (COFEPRIS)">
        <Row label="Marca" value={implant.brand === "OTRO" ? implant.brandCustomName ?? "OTRO" : implant.brand} mono={false} />
        <Row label="Modelo" value={implant.modelName} mono={false} />
        <Row label="⌀" value={`${String(implant.diameterMm)} mm`} />
        <Row label="Longitud" value={`${String(implant.lengthMm)} mm`} />
        <Row label="Conexión" value={implant.connectionType} mono={false} />
        {implant.surfaceTreatment && <Row label="Superficie" value={implant.surfaceTreatment} mono={false} />}
        <Row label="Lote" value={implant.lotNumber} accent />
        {implant.expiryDate && <Row label="Caduca" value={fmtShort(implant.expiryDate)} mono={false} />}
      </Section>

      {implant.surgicalRecord && (
        <Section title="Cirugía">
          <Row label="Fecha" value={fmtShort(implant.surgicalRecord.performedAt)} mono={false} />
          <Row label="Torque" value={`${implant.surgicalRecord.insertionTorqueNcm} Ncm`} />
          <Row
            label="ISQ MD/VL"
            value={`${implant.surgicalRecord.isqMesiodistal} / ${implant.surgicalRecord.isqVestibulolingual}`}
          />
          <Row label="Densidad" value={implant.surgicalRecord.boneDensity} />
          <Row label="Protocolo" value={implant.protocol} mono={false} />
          {implant.surgicalRecord.healingAbutmentLot && (
            <Row label="Lote pilar cic." value={implant.surgicalRecord.healingAbutmentLot} accent />
          )}
        </Section>
      )}

      {implant.healingPhase && (
        <Section title="Osteointegración">
          <Row label="Inicio" value={fmtShort(implant.healingPhase.startedAt)} mono={false} />
          <Row label="Plan" value={`${implant.healingPhase.expectedDurationWeeks} sem`} />
          {implant.healingPhase.isqLatest && (
            <Row label="ISQ último" value={String(implant.healingPhase.isqLatest)} />
          )}
          {implant.healingPhase.completedAt && (
            <Row label="Completada" value={fmtShort(implant.healingPhase.completedAt)} mono={false} />
          )}
        </Section>
      )}

      {implant.prostheticPhase && (
        <Section title="Prótesis">
          <Row label="Pilar" value={implant.prostheticPhase.abutmentType} mono={false} />
          <Row label="Lote pilar" value={implant.prostheticPhase.abutmentLot} accent />
          <Row label="Torque pilar" value={`${implant.prostheticPhase.abutmentTorqueNcm} Ncm`} />
          <Row label="Tipo" value={implant.prostheticPhase.prosthesisType} mono={false} />
          <Row label="Material" value={implant.prostheticPhase.prosthesisMaterial} mono={false} />
          <Row label="Lab" value={implant.prostheticPhase.prosthesisLabName} mono={false} />
          <Row label="Lote prótesis" value={implant.prostheticPhase.prosthesisLabLot} accent />
          <Row label="Entrega" value={fmtShort(implant.prostheticPhase.prosthesisDeliveredAt)} mono={false} />
        </Section>
      )}

      {inFunctionSince && (
        <p className="text-[11px] text-[var(--text-3,theme(colors.gray.500))] pt-2 border-t border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800">
          En función desde hace {daysSince(inFunctionSince)}
        </p>
      )}
    </aside>
  );
}
