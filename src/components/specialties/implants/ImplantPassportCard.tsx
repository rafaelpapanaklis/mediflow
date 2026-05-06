"use client";

/**
 * Pasaporte digital del implante — vista tipo credencial. Réplica
 * en HTML/CSS del PDF formato licencia (85.6 × 54 mm). Permite ver
 * el carnet en pantalla y disparar la descarga PDF al endpoint
 * /api/implants/[id]/passport.
 *
 * Soporte legal y técnico: el paciente lo necesita si se muda o
 * cambia de doctor — todos los datos del implante en una vista.
 */

import * as React from "react";
import { Download, Printer, ShieldCheck } from "lucide-react";

export interface ImplantPassportCardData {
  implantId: string;
  patient: { firstName: string; lastName: string };
  // Implante (COFEPRIS)
  toothFdi: number;
  brand: string;
  brandCustomName: string | null;
  modelName: string;
  diameterMm: string;
  lengthMm: string;
  connectionType: string;
  surfaceTreatment: string | null;
  lotNumber: string;
  placedAt: string; // ISO
  expiryDate: string | null;
  protocol: string;
  // Cirugía (torque)
  insertionTorqueNcm: number | null;
  // Prótesis
  prosthesisLabLot: string | null;
  prosthesisMaterial: string | null;
  // Doctor + clínica
  doctorName: string;
  doctorCedula: string | null;
  clinicName: string;
  clinicPhone: string | null;
  clinicLogoUrl: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fmtBrand(brand: string): string {
  return brand
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ImplantPassportCard({
  data,
}: {
  data: ImplantPassportCardData;
}) {
  const handleDownload = () => {
    window.open(`/api/implants/${data.implantId}/passport`, "_blank");
  };
  const handlePrint = () => {
    window.print();
  };

  const brandDisplay = data.brandCustomName ?? fmtBrand(data.brand);

  return (
    <div className="space-y-3">
      {/* botones */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
          <ShieldCheck className="h-4 w-4 text-[var(--color-success-fg)]" aria-hidden />
          Pasaporte digital — soporte legal y técnico
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--accent)]"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden /> Imprimir
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-fg)] hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> Descargar PDF
          </button>
        </div>
      </div>

      {/* tarjeta — proporción licencia 85.6:54 ≈ 1.586 */}
      <div
        className="relative mx-auto overflow-hidden rounded-lg border-2 border-[#1e3a8a] bg-white text-[#0f172a] shadow-md"
        style={{ aspectRatio: "85.6 / 54", maxWidth: "640px" }}
        role="region"
        aria-label="Tarjeta de pasaporte del implante"
      >
        {/* franja superior */}
        <div className="flex items-center justify-between bg-[#1e3a8a] px-3 py-1.5 text-white">
          <div className="flex items-center gap-2">
            {data.clinicLogoUrl ? (
              <img
                src={data.clinicLogoUrl}
                alt=""
                className="h-5 max-w-[80px] object-contain"
              />
            ) : null}
            <span className="text-[11px] font-semibold uppercase tracking-wide">
              {data.clinicName}
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-widest">
            Pasaporte del implante
          </span>
        </div>

        {/* contenido */}
        <div className="grid grid-cols-[1fr_auto] gap-3 p-3 text-[10px] leading-tight">
          <div className="space-y-1.5">
            <div>
              <p className="text-[8px] uppercase text-[#64748b]">Paciente</p>
              <p className="text-[12px] font-bold">
                {data.patient.firstName} {data.patient.lastName}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Diente FDI" value={String(data.toothFdi)} />
              <Field label="Protocolo" value={data.protocol} />
            </div>

            <div>
              <p className="text-[8px] uppercase text-[#64748b]">Implante</p>
              <p className="text-[11px] font-bold">{brandDisplay}</p>
              <p className="text-[10px]">
                {data.modelName} · {data.diameterMm}×{data.lengthMm} mm
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Conexión" value={data.connectionType} />
              <Field label="Superficie" value={data.surfaceTreatment ?? "—"} />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Field
                label="Lote (COFEPRIS)"
                value={data.lotNumber}
                emphasis
              />
              <Field
                label="Torque inserción"
                value={
                  data.insertionTorqueNcm != null
                    ? `${data.insertionTorqueNcm} Ncm`
                    : "—"
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Colocado" value={fmtDate(data.placedAt)} />
              <Field
                label="Caducidad pieza"
                value={fmtDate(data.expiryDate)}
              />
            </div>

            {(data.prosthesisLabLot || data.prosthesisMaterial) && (
              <div>
                <p className="text-[8px] uppercase text-[#64748b]">Prótesis</p>
                <p className="text-[10px]">
                  {data.prosthesisMaterial ?? "—"}
                  {data.prosthesisLabLot ? ` · Lote ${data.prosthesisLabLot}` : ""}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end justify-between text-right">
            <div>
              <p className="text-[8px] uppercase text-[#64748b]">Doctor</p>
              <p className="text-[10px] font-semibold">Dr. {data.doctorName}</p>
              {data.doctorCedula ? (
                <p className="text-[9px] text-[#475569]">
                  Céd. {data.doctorCedula}
                </p>
              ) : null}
              {data.clinicPhone ? (
                <p className="text-[9px] text-[#475569]">{data.clinicPhone}</p>
              ) : null}
            </div>
            <p className="text-[7px] text-[#94a3b8]">
              ID {data.implantId.slice(0, 8)}
            </p>
          </div>
        </div>
      </div>

      {/* Aviso */}
      <p className="text-center text-xs text-[var(--color-muted-fg)] print:hidden">
        Conserve este documento. Lo necesitará si cambia de doctor o se muda
        de ciudad.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-[8px] uppercase text-[#64748b]">{label}</p>
      <p className={emphasis ? "text-[11px] font-bold" : "text-[10px]"}>
        {value}
      </p>
    </div>
  );
}
