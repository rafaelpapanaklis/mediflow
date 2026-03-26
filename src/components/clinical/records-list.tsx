"use client";

import { formatDate } from "@/lib/utils";

const SPECIALTY_ICONS: Record<string, string> = {
  dental:     "🦷",
  nutrition:  "🥗",
  psychology: "🧠",
  medicine:   "🩺",
};

function DentalRecordView({ data }: { data: any }) {
  return (
    <div className="space-y-3 text-sm">
      {data.procedures?.length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground mb-1">Procedimientos:</div>
          <div className="flex flex-wrap gap-1">
            {data.procedures.map((p: string) => (
              <span key={p} className="text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded-full">{p}</span>
            ))}
          </div>
        </div>
      )}
      {data.periodontal?.gingival && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted-foreground">Placa:</span> {data.periodontal.plaque}</div>
          <div><span className="text-muted-foreground">Encías:</span> {data.periodontal.gingival}</div>
        </div>
      )}
      {data.odontogram && Object.keys(data.odontogram).length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground mb-1">Odontograma:</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(data.odontogram).map(([num, state]: [string, any]) => (
              <span key={num} className="text-[10px] bg-white border border-border rounded px-1.5 py-0.5">D{num}: {state.condition}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NutritionRecordView({ data }: { data: any }) {
  const a = data.anthropometrics;
  return (
    <div className="space-y-3 text-sm">
      {a && (
        <div className="grid grid-cols-4 gap-2 text-xs">
          {a.weight  && <div><span className="text-muted-foreground">Peso:</span> {a.weight}kg</div>}
          {a.height  && <div><span className="text-muted-foreground">Talla:</span> {a.height}cm</div>}
          {a.bmi     && <div><span className="text-muted-foreground">IMC:</span> {a.bmi}</div>}
          {a.tdee    && <div><span className="text-muted-foreground">GET:</span> {a.tdee}kcal</div>}
          {a.bodyFat && <div><span className="text-muted-foreground">% Grasa:</span> {a.bodyFat}%</div>}
          {a.waistHip && <div><span className="text-muted-foreground">ICC:</span> {a.waistHip}</div>}
        </div>
      )}
      {data.diet && <div className="text-xs"><span className="text-muted-foreground">Dieta:</span> {data.diet}</div>}
      {data.goals && <div className="text-xs"><span className="text-muted-foreground">Objetivos:</span> {data.goals}</div>}
    </div>
  );
}

function PsychologyRecordView({ data }: { data: any }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-4 text-xs">
        <span className="font-bold">Sesión #{data.sessionNumber}</span>
        <span className="text-muted-foreground">{data.sessionType}</span>
        <span className="text-muted-foreground">{data.approach}</span>
      </div>
      {data.scales && (
        <div className="flex gap-4">
          <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-extrabold">{data.scales.phq9?.score ?? "—"}</div>
            <div className="text-[10px] text-muted-foreground">PHQ-9</div>
            <div className="text-[10px] font-bold">{data.scales.phq9?.severity}</div>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-extrabold">{data.scales.gad7?.score ?? "—"}</div>
            <div className="text-[10px] text-muted-foreground">GAD-7</div>
            <div className="text-[10px] font-bold">{data.scales.gad7?.severity}</div>
          </div>
          {data.mentalStatus?.suicidalIdeation && data.mentalStatus.suicidalIdeation !== "no" && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-center">
              <div className="text-xs font-bold text-rose-700">⚠️ Ideación suicida</div>
              <div className="text-[10px] text-rose-600">{data.mentalStatus.suicidalIdeation}</div>
            </div>
          )}
        </div>
      )}
      {data.homework && <div className="text-xs"><span className="text-muted-foreground">Tarea:</span> {data.homework}</div>}
    </div>
  );
}

function MedicineRecordView({ data }: { data: any }) {
  return (
    <div className="space-y-3 text-sm">
      {data.medications?.length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground mb-1">Medicamentos recetados:</div>
          <div className="space-y-1">
            {data.medications.filter((m: any) => m.drug).map((med: any, i: number) => (
              <div key={i} className="text-xs flex gap-2">
                <span className="font-semibold">{med.drug}</span>
                {med.dose && <span className="text-muted-foreground">{med.dose}</span>}
                {med.frequency && <span className="text-muted-foreground">— {med.frequency}</span>}
                {med.duration && <span className="text-muted-foreground">por {med.duration}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {data.referral && <div className="text-xs"><span className="text-muted-foreground">Referencia:</span> {data.referral}</div>}
      {data.sicLeave?.granted && <div className="text-xs text-amber-700 font-bold">📋 Incapacidad: {data.sicLeave.days} días</div>}
    </div>
  );
}

interface Props {
  records: any[];
}

export function ClinicalRecordsList({ records }: Props) {
  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No hay expedientes clínicos aún.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map(record => {
        const specialty = record.specialtyData?.type ?? "medicine";
        const icon = SPECIALTY_ICONS[specialty] ?? "📋";
        return (
          <div key={record.id} className="rounded-xl border border-border bg-white p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{icon}</span>
                <div>
                  <div className="text-sm font-bold capitalize">{specialty === "medicine" ? "Medicina general" : specialty === "dental" ? "Odontología" : specialty === "nutrition" ? "Nutrición" : "Psicología"}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(record.visitDate)} · Dr/a. {record.doctor?.firstName} {record.doctor?.lastName}
                  </div>
                </div>
              </div>
            </div>

            {record.subjective && (
              <div className="mb-2">
                <span className="text-xs font-bold text-muted-foreground">Motivo: </span>
                <span className="text-xs">{record.subjective.slice(0, 150)}{record.subjective.length > 150 ? "…" : ""}</span>
              </div>
            )}

            {record.assessment && (
              <div className="mb-2">
                <span className="text-xs font-bold text-muted-foreground">Diagnóstico: </span>
                <span className="text-xs">{record.assessment}</span>
              </div>
            )}

            {record.plan && (
              <div className="mb-3">
                <span className="text-xs font-bold text-muted-foreground">Plan: </span>
                <span className="text-xs">{record.plan.slice(0, 100)}{record.plan.length > 100 ? "…" : ""}</span>
              </div>
            )}

            {record.specialtyData && (
              <div className="border-t border-border pt-3">
                {specialty === "dental"     && <DentalRecordView     data={record.specialtyData} />}
                {specialty === "nutrition"  && <NutritionRecordView  data={record.specialtyData} />}
                {specialty === "psychology" && <PsychologyRecordView data={record.specialtyData} />}
                {specialty === "medicine"   && <MedicineRecordView   data={record.specialtyData} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
