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
    <div className="bg-white p-5 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Modelo 3D · Bolton y espacio
        </h4>
        <Link href={`/dashboard/patients/${patientId}/orthodontics`} className="inline-flex">
          <Btn variant="secondary" size="sm" icon={<Box className="w-3.5 h-3.5" />}>
            Abrir modelo 3D
          </Btn>
        </Link>
      </div>
      <p className="text-[11px] text-slate-500 mb-3 dark:text-slate-400">
        Mide cada diente con la regla del visor 3D (o un calibre) y anota el ancho mesiodistal en mm.
      </p>

      <ArchInput label="Superior" teeth={UPPER_TEETH} widths={widths} onChange={setWidths} />
      <div className="mt-3">
        <ArchInput label="Inferior" teeth={LOWER_TEETH} widths={widths} onChange={setWidths} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
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

      <div className="mt-4 grid grid-cols-2 gap-3">
        <SpaceInput label="Espacio disponible arco superior (mm)" value={upperSpace} onChange={setUpperSpace} result={upperDiscrepancy} />
        <SpaceInput label="Espacio disponible arco inferior (mm)" value={lowerSpace} onChange={setLowerSpace} result={lowerDiscrepancy} />
      </div>

      {bolton.missingTeeth.length > 0 ? (
        <p className="mt-3 text-[11px] text-slate-400">
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
      <div className="text-[11px] text-slate-500 mb-1 dark:text-slate-400">{label}</div>
      <div className="grid grid-cols-6 gap-1">
        {teeth.map((fdi) => (
          <div key={fdi} className="text-center">
            <div className="text-[9px] text-slate-400">{fdi}</div>
            <input
              type="number"
              step="0.1"
              min="0"
              value={widths[fdi] ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : Number(e.target.value);
                onChange({ ...widths, [fdi]: v as number });
              }}
              className="w-full text-xs text-center border border-slate-200 rounded px-1 py-0.5 dark:bg-slate-800 dark:border-slate-700"
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
    <div className="rounded-md bg-slate-50 dark:bg-slate-800/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">{title}</div>
      <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
        {ratio !== null ? `${ratio}%` : "—"}
        <span className="text-[10px] text-slate-400 font-normal ml-1">ideal {ideal}%</span>
      </div>
      {discrepancyMm !== null ? (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
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
    <div>
      <label className="text-[11px] text-slate-500 dark:text-slate-400">{label}</label>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="mt-1 w-full text-xs border border-slate-200 rounded px-2 py-1 dark:bg-slate-800 dark:border-slate-700"
      />
      {result ? (
        <div className={`mt-1 text-[11px] ${result.discrepancyMm < 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {result.discrepancyMm < 0 ? `Apiñamiento de ${Math.abs(result.discrepancyMm)} mm` : `Espaciado de ${result.discrepancyMm} mm`}
        </div>
      ) : null}
    </div>
  );
}
