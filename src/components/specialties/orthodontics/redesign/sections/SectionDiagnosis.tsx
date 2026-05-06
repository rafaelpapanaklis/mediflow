"use client";
// Sección B — Diagnóstico ortodóntico (4 sub-cards en grid 2×2).
//
// 1. Clasificación clínica (Angle, overbite, overjet, crowding, mordida cruzada,
//    líneas medias).
// 2. Patrón skeletal & ATM (mesofacial/dolicofacial/braquifacial, hábitos chips,
//    ATM clicking/dolor).
// 3. Cefalometría placeholder G2 (Próximamente Fase 3 con preview blurry).
// 4. Records digitales (foto-set T0, RX panorámica, lateral cef, link STL).

import { Camera, FileText, Layers, Pencil, Plus, Sparkles } from "lucide-react";
import { Btn, Card, KV } from "../atoms";
import { Pill } from "../atoms/Pill";
import { fmtDateShort, fmtMm } from "../atoms/format";
import { SKELETAL_PATTERN_LABELS, type DiagnosisDTO } from "../types";

export interface DigitalRecordEntry {
  label: string;
  date: string | null;
  kind: "photo" | "ceph" | "pano" | "stl" | "other";
  href?: string;
}

export interface SectionDiagnosisProps {
  diagnosis: DiagnosisDTO | null;
  digitalRecords?: DigitalRecordEntry[];
  onStartWizard?: () => void;
  onEdit?: () => void;
  onUploadRecord?: () => void;
}

const HABIT_LABELS: Record<string, string> = {
  DIGITAL_SUCKING: "succión digital",
  MOUTH_BREATHING: "respirador bucal",
  TONGUE_THRUSTING: "deglución atípica",
  BRUXISM: "bruxismo",
  NAIL_BITING: "onicofagia",
  LIP_BITING: "succión labial",
  OTHER: "otro hábito",
};

export function SectionDiagnosis(props: SectionDiagnosisProps) {
  const d = props.diagnosis;

  if (!d) {
    return (
      <Card id="diagnosis" eyebrow="Sección B" title="Diagnóstico ortodóntico">
        <div className="px-6 py-10 flex flex-col items-center text-center gap-3">
          <div
            className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center dark:bg-violet-900/30 dark:text-violet-300"
            aria-hidden
          >
            <Sparkles className="w-6 h-6" aria-hidden />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Sin diagnóstico capturado
          </h3>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            Captura Angle, overbite, overjet, mordida cruzada y hábitos para iniciar el plan.
          </p>
          {props.onStartWizard ? (
            <Btn
              variant="primary"
              size="md"
              icon={<Plus className="w-4 h-4" aria-hidden />}
              onClick={props.onStartWizard}
            >
              Iniciar wizard de diagnóstico
            </Btn>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card
      id="diagnosis"
      eyebrow="Sección B"
      title="Diagnóstico ortodóntico"
      action={
        props.onEdit ? (
          <Btn
            variant="ghost"
            size="sm"
            icon={<Pencil className="w-3.5 h-3.5" aria-hidden />}
            onClick={props.onEdit}
          >
            Editar
          </Btn>
        ) : null
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-100 dark:bg-slate-800">
        <ClassificationCard d={d} />
        <SkeletalAtmCard d={d} />
        <CephalometryCard />
        <DigitalRecordsCard
          records={props.digitalRecords ?? []}
          onUpload={props.onUploadRecord}
        />
      </div>
    </Card>
  );
}

function ClassificationCard({ d }: { d: DiagnosisDTO }) {
  const angleLabel = (k: string) => {
    if (k === "CLASS_I") return "Clase I";
    if (k === "CLASS_II_DIV_1") return "Clase II div. 1";
    if (k === "CLASS_II_DIV_2") return "Clase II div. 2";
    if (k === "CLASS_III") return "Clase III";
    return k;
  };
  return (
    <div className="bg-white p-5 dark:bg-slate-900">
      <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3 dark:text-slate-400">
        Clasificación clínica
      </h4>
      <div className="grid grid-cols-2 gap-3">
        <KV k="Angle der." v={angleLabel(d.angleClassRight)} />
        <KV k="Angle izq." v={angleLabel(d.angleClassLeft)} />
        <KV k="Overbite" v={fmtMm(d.overbiteMm)} />
        <KV k="Overjet" v={fmtMm(d.overjetMm)} />
        <KV k="Apiñam. sup." v={fmtMm(d.crowdingUpperMm ?? null)} />
        <KV k="Apiñam. inf." v={fmtMm(d.crowdingLowerMm ?? null)} />
        <KV
          k="Línea media"
          v={
            d.midlineDeviationMm != null
              ? `${d.midlineDeviationMm > 0 ? "+" : ""}${d.midlineDeviationMm.toFixed(1)} mm`
              : "centrada"
          }
          vClass={
            d.midlineDeviationMm != null && Math.abs(d.midlineDeviationMm) > 0
              ? "text-rose-600 font-medium dark:text-rose-400"
              : "text-slate-900 font-medium dark:text-slate-100"
          }
        />
        <KV k="Mordida abierta" v={d.openBite ? "sí" : "no"} />
      </div>
      {d.crossbite || d.openBiteDetails ? (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 mb-1 dark:text-slate-400">
            Mordida cruzada / abierta
          </div>
          <div className="flex flex-wrap gap-1">
            {d.crossbite ? (
              <Pill color="amber" size="xs">
                {d.crossbiteDetails ?? "cruzada"}
              </Pill>
            ) : null}
            {d.openBite && d.openBiteDetails ? (
              <Pill color="amber" size="xs">
                {d.openBiteDetails}
              </Pill>
            ) : null}
          </div>
        </div>
      ) : null}
      {d.clinicalSummary ? (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 mb-1 dark:text-slate-400">Resumen</div>
          <p className="text-xs text-slate-700 leading-relaxed dark:text-slate-300">
            {d.clinicalSummary}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SkeletalAtmCard({ d }: { d: DiagnosisDTO }) {
  return (
    <div className="bg-white p-5 dark:bg-slate-900">
      <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3 dark:text-slate-400">
        Patrón skeletal &amp; ATM
      </h4>
      <div className="space-y-2">
        <KV
          k="Patrón skeletal"
          v={d.skeletalPattern ? SKELETAL_PATTERN_LABELS[d.skeletalPattern] : "no clasificado"}
        />
        <KV k="ATM clicking" v={d.tmjClickingPresent ? "presente" : "ausente"}
          vClass={d.tmjClickingPresent ? "text-amber-700 font-medium dark:text-amber-400" : "text-slate-900 font-medium dark:text-slate-100"}
        />
        <KV k="Dolor ATM" v={d.tmjPainPresent ? "presente" : "ausente"}
          vClass={d.tmjPainPresent ? "text-rose-700 font-medium dark:text-rose-400" : "text-slate-900 font-medium dark:text-slate-100"}
        />
        {d.tmjNotes ? (
          <div className="text-[11px] text-slate-500 leading-snug dark:text-slate-400">
            {d.tmjNotes}
          </div>
        ) : null}
      </div>
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
        <div className="text-[11px] text-slate-500 mb-1 dark:text-slate-400">
          Hábitos parafuncionales
        </div>
        {d.habits.length === 0 ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">Sin hábitos registrados</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {d.habits.map((h) => (
              <Pill key={h} color="rose" size="xs">
                {HABIT_LABELS[h] ?? h.toLowerCase()}
              </Pill>
            ))}
          </div>
        )}
        {d.habitsDescription ? (
          <p className="text-[11px] text-slate-500 mt-2 leading-snug dark:text-slate-400">
            {d.habitsDescription}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CephalometryCard() {
  return (
    <div className="bg-white p-5 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Cefalometría
        </h4>
        <Pill color="amber" size="xs">
          G2 · Próximamente
        </Pill>
      </div>
      <div className="h-32 rounded-md bg-gradient-to-br from-violet-50 via-slate-50 to-violet-100/40 border border-dashed border-slate-200 flex items-center justify-center relative overflow-hidden dark:from-violet-900/10 dark:via-slate-800 dark:to-violet-900/20 dark:border-slate-700">
        <svg viewBox="0 0 200 100" className="absolute inset-0 w-full h-full opacity-20" aria-hidden>
          <path
            d="M30 70 Q50 20 110 35 Q160 45 170 80"
            stroke="#7c3aed"
            strokeWidth="1.5"
            fill="none"
          />
          <circle cx="60" cy="40" r="2" fill="#7c3aed" />
          <circle cx="100" cy="35" r="2" fill="#7c3aed" />
          <circle cx="130" cy="50" r="2" fill="#7c3aed" />
        </svg>
        <div className="relative text-center">
          <Sparkles className="w-5 h-5 text-violet-500 mx-auto mb-1" aria-hidden />
          <div className="text-xs text-slate-700 font-medium dark:text-slate-200">
            Landmarking AI · Steiner / Ricketts / Tweed
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 dark:text-slate-400">
            Integración WebCeph · Fase 3
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-slate-400 dark:text-slate-500">
        <div>SNA · —</div>
        <div>SNB · —</div>
        <div>ANB · —</div>
        <div>U1-NA · —</div>
        <div>L1-NB · —</div>
        <div>FMA · —</div>
      </div>
    </div>
  );
}

function DigitalRecordsCard({
  records,
  onUpload,
}: {
  records: DigitalRecordEntry[];
  onUpload?: () => void;
}) {
  const ICONS: Record<DigitalRecordEntry["kind"], React.ReactNode> = {
    photo: <Camera className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden />,
    ceph: <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden />,
    pano: <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden />,
    stl: <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden />,
    other: <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden />,
  };
  return (
    <div className="bg-white p-5 dark:bg-slate-900">
      <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3 dark:text-slate-400">
        Records digitales
      </h4>
      {records.length === 0 ? (
        <div className="text-xs text-slate-400 mb-3 dark:text-slate-500">
          Sin registros digitales todavía.
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <div className="flex items-center gap-2 min-w-0">
                {ICONS[r.kind]}
                <span className="text-sm text-slate-700 truncate dark:text-slate-300">
                  {r.label}
                </span>
              </div>
              <Pill color="emerald" size="xs">
                {fmtDateShort(r.date)}
              </Pill>
            </div>
          ))}
        </div>
      )}
      {onUpload ? (
        <Btn
          variant="violet-soft"
          size="sm"
          className="mt-3 w-full justify-center"
          icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
          onClick={onUpload}
        >
          Subir nuevo registro
        </Btn>
      ) : null}
    </div>
  );
}
