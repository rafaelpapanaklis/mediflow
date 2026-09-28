"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026).
// H9: "verlo desde el caso" — enlaza al visor 3D que YA funciona (mide
// distancias) en vez de reconstruirlo aquí. H10: análisis de Bolton y
// espacio de arco a partir de anchos mesiodistales que el doctor teclea
// (medidos con la regla del visor 3D o un calibre físico).

import { useMemo, useState } from "react";
import Link from "next/link";
import { Box } from "lucide-react";
import { computeArchSpaceDiscrepancy, computeBolton, type ToothWidths } from "@/lib/orthodontics/alineadores/bolton";
import { Btn } from "../redesign/atoms/Btn";
import orto from "../redesign/orto.module.css";

const UPPER_TEETH = [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26];
const LOWER_TEETH = [46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36];

export interface BoltonPanelProps {
  patientId: string;
}

export function BoltonPanel({ patientId }: BoltonPanelProps) {
  const [widths, setWidths] = useState<ToothWidths>({});
  const [upperSpace, setUpperSpace] = useState<number | "">("");
  const [lowerSpace, setLowerSpace] = useState<number | "">("");

  const bolton = useMemo(() => computeBolton(widths), [widths]);
  const upperDiscrepancy = useMemo(
    () => (upperSpace === "" ? null : computeArchSpaceDiscrepancy(Number(upperSpace), widths, UPPER_TEETH)),
    [upperSpace, widths],
  );
  const lowerDiscrepancy = useMemo(
    () => (lowerSpace === "" ? null : computeArchSpaceDiscrepancy(Number(lowerSpace), widths, LOWER_TEETH)),
    [lowerSpace, widths],
  );

  return (
    <div className="bg-[color:var(--pr-tarjeta)] p-[18px]">
      <div className="flex items-center justify-between mb-3">
        <h4 className={orto.bloqueTitulo}>Bolton y espacio</h4>
        <Link href={`/dashboard/patients/${patientId}?tab=modelos-3d`} className="inline-flex">
          <Btn variant="secondary" size="sm" icon={<Box size={14} strokeWidth={1.75} aria-hidden />}>
            Abrir modelo 3D
          </Btn>
        </Link>
      </div>
      <p className="text-xs text-[color:var(--pr-texto-3)] mb-3">
        Mide cada diente con la regla del visor 3D (o un calibre) y anota el ancho mesiodistal en mm.
      </p>

      <ArchInput label="Superior" teeth={UPPER_TEETH} widths={widths} onChange={setWidths} />
      <div className="mt-3">
        <ArchInput label="Inferior" teeth={LOWER_TEETH} widths={widths} onChange={setWidths} />
      </div>

      <div className={`${orto.rejilla2} mt-4`}>
        <ResultCard
          title="Bolton anterior (6×6)"
          ratio={bolton.anteriorRatio}
          ideal={bolton.anteriorIdeal}
          discrepancyMm={bolton.anteriorDiscrepancyMm}
        />
        <ResultCard
          title="Bolton total (12×12)"
          ratio={bolton.overallRatio}
          ideal={bolton.overallIdeal}
          discrepancyMm={bolton.overallDiscrepancyMm}
        />
      </div>

      <div className={`${orto.rejilla2} mt-4`}>
        <SpaceInput label="Espacio disponible, arco superior (mm)" value={upperSpace} onChange={setUpperSpace} result={upperDiscrepancy} />
        <SpaceInput label="Espacio disponible, arco inferior (mm)" value={lowerSpace} onChange={setLowerSpace} result={lowerDiscrepancy} />
      </div>

      {bolton.missingTeeth.length > 0 ? (
        <p className="mt-3 text-[11px] text-[color:var(--pr-texto-3)]">
          Faltan {bolton.missingTeeth.length} diente(s) por medir para completar el análisis.
        </p>
      ) : null}
    </div>
  );
}

function ArchInput({
  label,
  teeth,
  widths,
  onChange,
}: {
  label: string;
  teeth: number[];
  widths: ToothWidths;
  onChange: (w: ToothWidths) => void;
}) {
  return (
    <div>
      <div className={`${orto.campoEtiqueta} mb-[5px]`}>{label}</div>
      <div className="grid grid-cols-6 gap-[5px]">
        {teeth.map((fdi) => (
          <div key={fdi} className="text-center min-w-0">
            <div className="text-[11px] font-semibold text-[color:var(--pr-texto-3)]">{fdi}</div>
            <input
              type="number"
              step="0.1"
              min="0"
              value={widths[fdi] ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : Number(e.target.value);
                onChange({ ...widths, [fdi]: v as number });
              }}
              aria-label={`Ancho del diente ${fdi} en mm`}
              className={`${orto.entrada} ${orto.entradaCorta}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  title,
  ratio,
  ideal,
  discrepancyMm,
}: {
  title: string;
  ratio: number | null;
  ideal: number;
  discrepancyMm: number | null;
}) {
  return (
    <div className={orto.caja}>
      <div className={orto.datoEtiqueta}>{title}</div>
      <div className={orto.datoValor}>
        {ratio !== null ? `${ratio}%` : "—"}
        <span className={`${orto.datoNota} ${orto.tonoApagado}`}>ideal {ideal}%</span>
      </div>
      {discrepancyMm !== null ? (
        <div className={orto.datoSub}>
          {discrepancyMm > 0 ? `+${discrepancyMm} mm de exceso mandibular` : `${discrepancyMm} mm de déficit mandibular`}
        </div>
      ) : null}
    </div>
  );
}

function SpaceInput({
  label,
  value,
  onChange,
  result,
}: {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  result: ReturnType<typeof computeArchSpaceDiscrepancy> | null;
}) {
  return (
    <div className={orto.campo}>
      <label className={orto.campoEtiqueta}>{label}</label>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className={orto.entrada}
      />
      {result ? (
        <div className={`mt-1 text-[11px] ${result.discrepancyMm < 0 ? "text-[color:var(--pr-alerta)]" : "text-[color:var(--pr-exito)]"}`}>
          {result.discrepancyMm < 0 ? `Apiñamiento de ${Math.abs(result.discrepancyMm)} mm` : `Espaciado de ${result.discrepancyMm} mm`}
        </div>
      ) : null}
    </div>
  );
}
