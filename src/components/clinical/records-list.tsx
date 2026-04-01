"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDate } from "@/lib/utils";

const SPECIALTY_ICONS: Record<string, string> = {
  dental:     "🦷",
  nutrition:  "🥗",
  psychology: "🧠",
  medicine:   "🩺",
};

const SPECIALTY_LABELS: Record<string, string> = {
  dental:     "Odontología",
  nutrition:  "Nutrición",
  psychology: "Psicología",
  medicine:   "Medicina general",
};

function DentalRecordDetail({ data, record }: { data: any; record: any }) {
  return (
    <div className="space-y-4 text-sm">
      {record.subjective && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Motivo de consulta</div>
          <p className="text-sm">{record.subjective}</p>
        </div>
      )}
      {record.objective && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Antecedentes médicos</div>
          <p className="text-sm">{record.objective}</p>
        </div>
      )}
      {record.vitals && (Object.values(record.vitals).some(v => v)) && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Signos vitales</div>
          <div className="grid grid-cols-3 gap-2">
            {record.vitals.bloodPressure && <div className="bg-muted/30 rounded-lg p-2 text-center"><div className="text-xs font-bold">{record.vitals.bloodPressure}</div><div className="text-[10px] text-muted-foreground">Presión</div></div>}
            {record.vitals.heartRate     && <div className="bg-muted/30 rounded-lg p-2 text-center"><div className="text-xs font-bold">{record.vitals.heartRate}</div><div className="text-[10px] text-muted-foreground">F. Cardíaca</div></div>}
            {record.vitals.notes         && <div className="bg-muted/30 rounded-lg p-2 text-center"><div className="text-xs font-bold">{record.vitals.notes}</div><div className="text-[10px] text-muted-foreground">Notas</div></div>}
          </div>
        </div>
      )}
      {data.odontogram && Object.keys(data.odontogram).length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Odontograma</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.odontogram).map(([num, state]: [string, any]) => (
              <span key={num} className="text-[10px] font-semibold bg-white border border-border rounded-lg px-2 py-1">
                <span className="text-muted-foreground">D{num}:</span> {state.condition}
              </span>
            ))}
          </div>
        </div>
      )}
      {data.procedures?.length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Procedimientos realizados</div>
          <div className="flex flex-wrap gap-1.5">
            {data.procedures.map((p: string) => (
              <span key={p} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">{p}</span>
            ))}
          </div>
        </div>
      )}
      {data.periodontal && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Evaluación periodontal</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.periodontal.plaque      && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Placa</span><span className="font-semibold">{data.periodontal.plaque}</span></div>}
            {data.periodontal.calculus    && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Cálculo</span><span className="font-semibold">{data.periodontal.calculus}</span></div>}
            {data.periodontal.gingival    && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Encías</span><span className="font-semibold">{data.periodontal.gingival}</span></div>}
            {data.periodontal.pocketDepth && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Bolsas</span><span className="font-semibold">{data.periodontal.pocketDepth}</span></div>}
          </div>
        </div>
      )}
      {record.assessment && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Observaciones clínicas</div>
          <p className="text-sm">{record.assessment}</p>
        </div>
      )}
      {record.plan && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Plan de tratamiento</div>
          <p className="text-sm">{record.plan}</p>
        </div>
      )}
      {data.xrays && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Radiografías</div>
          <p className="text-sm">{data.xrays}</p>
        </div>
      )}
      {data.nextVisit && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Próxima cita recomendada</div>
          <p className="text-sm font-semibold text-brand-700">{data.nextVisit}</p>
        </div>
      )}
    </div>
  );
}

function NutritionRecordDetail({ data, record }: { data: any; record: any }) {
  const a = data.anthropometrics;
  return (
    <div className="space-y-4 text-sm">
      {record.subjective && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Motivo de consulta</div>
          <p>{record.subjective}</p>
        </div>
      )}
      {a && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Antropometría</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Peso",       val: a.weight     ? `${a.weight} kg`  : null },
              { label: "Talla",      val: a.height     ? `${a.height} cm`  : null },
              { label: "IMC",        val: a.bmi        ? a.bmi             : null },
              { label: "GET",        val: a.tdee       ? `${a.tdee} kcal`  : null },
              { label: "TMB",        val: a.bmr        ? `${a.bmr} kcal`   : null },
              { label: "% Grasa",   val: a.bodyFat    ? `${a.bodyFat}%`   : null },
              { label: "Cintura",   val: a.waist      ? `${a.waist} cm`   : null },
              { label: "Cadera",    val: a.hip        ? `${a.hip} cm`     : null },
              { label: "ICC",       val: a.waistHip   ? a.waistHip        : null },
              { label: "M. Musc.", val: a.muscleMass ? `${a.muscleMass} kg` : null },
            ].filter(i => i.val).map(item => (
              <div key={item.label} className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-xs font-bold">{item.val}</div>
                <div className="text-[10px] text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {(data.activityLevel || data.diet || data.waterIntake) && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Hábitos</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.diet          && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Dieta</span><span className="font-semibold">{data.diet}</span></div>}
            {data.activityLevel && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Actividad</span><span className="font-semibold">{data.activityLevel}</span></div>}
            {data.waterIntake   && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Agua</span><span className="font-semibold">{data.waterIntake} L/día</span></div>}
            {data.sleepHours    && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Sueño</span><span className="font-semibold">{data.sleepHours} hrs</span></div>}
          </div>
        </div>
      )}
      {data.allergies && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Alergias alimentarias</div><p>{data.allergies}</p></div>}
      {data.labResults && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Laboratorios</div><p className="whitespace-pre-line">{data.labResults}</p></div>}
      {record.assessment && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Diagnóstico nutricional</div><p>{record.assessment}</p></div>}
      {data.goals && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Objetivos</div><p>{data.goals}</p></div>}
      {record.plan && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Plan alimenticio</div><p className="whitespace-pre-line">{record.plan}</p></div>}
    </div>
  );
}

function PsychologyRecordDetail({ data, record }: { data: any; record: any }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold">Sesión #{data.sessionNumber}</span>
        <span className="text-xs text-muted-foreground">{data.sessionType}</span>
        <span className="text-xs text-muted-foreground">Enfoque: {data.approach}</span>
      </div>
      {data.scales && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Escalas de evaluación</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-extrabold text-brand-700">{data.scales.phq9?.score ?? "—"}<span className="text-sm text-muted-foreground">/27</span></div>
              <div className="text-xs font-bold text-muted-foreground">PHQ-9 · Depresión</div>
              <div className="text-xs font-bold text-brand-700 mt-0.5">{data.scales.phq9?.severity}</div>
            </div>
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-extrabold text-violet-700">{data.scales.gad7?.score ?? "—"}<span className="text-sm text-muted-foreground">/21</span></div>
              <div className="text-xs font-bold text-muted-foreground">GAD-7 · Ansiedad</div>
              <div className="text-xs font-bold text-violet-700 mt-0.5">{data.scales.gad7?.severity}</div>
            </div>
          </div>
        </div>
      )}
      {data.mentalStatus && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Estado mental</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.mentalStatus.sleepQuality      && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Sueño</span><span className="font-semibold">{data.mentalStatus.sleepQuality}</span></div>}
            {data.mentalStatus.appetiteChanges   && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Apetito</span><span className="font-semibold">{data.mentalStatus.appetiteChanges}</span></div>}
            {data.mentalStatus.socialFunctioning && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Func. social</span><span className="font-semibold">{data.mentalStatus.socialFunctioning}</span></div>}
            {data.mentalStatus.workFunctioning   && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">Func. laboral</span><span className="font-semibold">{data.mentalStatus.workFunctioning}</span></div>}
          </div>
          {data.mentalStatus.suicidalIdeation && data.mentalStatus.suicidalIdeation !== "no" && (
            <div className="mt-2 flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-rose-700">⚠️ Ideación suicida: {data.mentalStatus.suicidalIdeation}</span>
            </div>
          )}
        </div>
      )}
      {record.objective && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Contenido de la sesión</div><p className="whitespace-pre-line">{record.objective}</p></div>}
      {record.assessment && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Diagnóstico</div><p>{record.assessment}</p></div>}
      {data.interventions && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Intervenciones</div><p>{data.interventions}</p></div>}
      {data.patientResponse && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Respuesta del paciente</div><p>{data.patientResponse}</p></div>}
      {data.homework && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Tarea para casa</div><p>{data.homework}</p></div>}
      {record.plan && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Plan terapéutico</div><p>{record.plan}</p></div>}
    </div>
  );
}

function MedicineRecordDetail({ data, record }: { data: any; record: any }) {
  return (
    <div className="space-y-4 text-sm">
      {record.subjective && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Motivo / HEA</div><p className="whitespace-pre-line">{record.subjective}</p></div>}
      {record.vitals && Object.values(record.vitals).some(v => v) && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Signos vitales</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "T/A",         val: record.vitals.bloodPressure   },
              { label: "FC",          val: record.vitals.heartRate        },
              { label: "Temperatura", val: record.vitals.temperature      },
              { label: "FR",          val: record.vitals.respiratoryRate  },
              { label: "Sat. O₂",    val: record.vitals.oxygenSat        },
              { label: "Glucemia",   val: record.vitals.bloodGlucose     },
              { label: "Peso",       val: record.vitals.weight ? `${record.vitals.weight} kg` : null },
              { label: "Talla",      val: record.vitals.height ? `${record.vitals.height} cm` : null },
            ].filter(i => i.val).map(item => (
              <div key={item.label} className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-xs font-bold">{item.val}</div>
                <div className="text-[10px] text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {record.objective && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Exploración física / Laboratorios</div><p className="whitespace-pre-line">{record.objective}</p></div>}
      {record.assessment && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Diagnóstico</div><p className="font-semibold">{record.assessment}</p></div>}
      {data.medications?.filter((m: any) => m.drug).length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Prescripción médica</div>
          <div className="space-y-1.5">
            {data.medications.filter((m: any) => m.drug).map((med: any, i: number) => (
              <div key={i} className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-xs">
                <span className="font-bold text-orange-700">💊 {med.drug}</span>
                {med.dose      && <span className="text-muted-foreground">{med.dose}</span>}
                {med.frequency && <span className="text-muted-foreground">· {med.frequency}</span>}
                {med.duration  && <span className="text-muted-foreground">· {med.duration}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {record.plan && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Plan / Indicaciones</div><p className="whitespace-pre-line">{record.plan}</p></div>}
      {data.referral && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Referencia</div><p>{data.referral}</p></div>}
      {data.sicLeave?.granted && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="text-xs font-bold text-amber-700">📋 Incapacidad médica: {data.sicLeave.days} días</span>
        </div>
      )}
    </div>
  );
}

interface Props {
  records: any[];
}

export function ClinicalRecordsList({ records }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(
    records.length > 0 ? records[0].id : null
  );

  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No hay expedientes clínicos aún.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((record, idx) => {
        const specialty = record.specialtyData?.type ?? "medicine";
        const icon      = SPECIALTY_ICONS[specialty] ?? "📋";
        const label     = SPECIALTY_LABELS[specialty] ?? "Consulta";
        const isOpen    = expandedId === record.id;

        return (
          <div key={record.id} className="rounded-xl border border-border bg-white shadow-card overflow-hidden">
            {/* Header - always visible, clickable */}
            <button
              onClick={() => setExpandedId(isOpen ? null : record.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                {records.length - idx}
              </div>
              <span className="text-lg flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{label}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(record.visitDate)} · Dr/a. {record.doctor?.firstName} {record.doctor?.lastName}
                  {record.subjective && ` · ${record.subjective.slice(0, 40)}${record.subjective.length > 40 ? "…" : ""}`}
                </div>
              </div>
              {record.assessment && (
                <span className="text-xs font-semibold text-muted-foreground hidden sm:block max-w-[150px] truncate">
                  {record.assessment.slice(0, 30)}
                </span>
              )}
              <div className="flex-shrink-0 text-muted-foreground">
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {/* Expandable detail */}
            {isOpen && (
              <div className="border-t border-border p-4 animate-fade-up">
                {specialty === "dental"     && <DentalRecordDetail     data={record.specialtyData ?? {}} record={record} />}
                {specialty === "nutrition"  && <NutritionRecordDetail  data={record.specialtyData ?? {}} record={record} />}
                {specialty === "psychology" && <PsychologyRecordDetail data={record.specialtyData ?? {}} record={record} />}
                {specialty === "medicine"   && <MedicineRecordDetail   data={record.specialtyData ?? {}} record={record} />}

                {/* Fallback for records without specialtyData */}
                {!record.specialtyData && (
                  <div className="space-y-3 text-sm">
                    {record.subjective && <div><div className="text-xs font-bold text-muted-foreground mb-1">Subjetivo</div><p>{record.subjective}</p></div>}
                    {record.objective  && <div><div className="text-xs font-bold text-muted-foreground mb-1">Objetivo</div><p>{record.objective}</p></div>}
                    {record.assessment && <div><div className="text-xs font-bold text-muted-foreground mb-1">Diagnóstico</div><p>{record.assessment}</p></div>}
                    {record.plan       && <div><div className="text-xs font-bold text-muted-foreground mb-1">Plan</div><p>{record.plan}</p></div>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
