"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";

const SPECIALTY_ICONS: Record<string, string> = {
  dental:     "🦷",
  nutrition:  "🥗",
  psychology: "🧠",
  medicine:   "🩺",
};

const SPECIALTY_LABEL_KEYS: Record<string, string> = {
  dental:     "clinical.recordsList.specialtyDental",
  nutrition:  "clinical.recordsList.specialtyNutrition",
  psychology: "clinical.recordsList.specialtyPsychology",
  medicine:   "clinical.recordsList.specialtyMedicine",
};

export function DentalRecordDetail({ data, record }: { data: any; record: any }) {
  const t = useT();
  return (
    <div className="space-y-4 text-sm">
      {record.subjective && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.reasonForVisit")}</div>
          <p className="text-sm">{record.subjective}</p>
        </div>
      )}
      {record.objective && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.medicalHistory")}</div>
          <p className="text-sm">{record.objective}</p>
        </div>
      )}
      {record.vitals && (Object.values(record.vitals).some(v => v)) && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.vitalSigns")}</div>
          <div className="grid grid-cols-3 gap-2">
            {record.vitals.bloodPressure && <div className="bg-muted/30 rounded-lg p-2 text-center"><div className="text-xs font-bold">{record.vitals.bloodPressure}</div><div className="text-[10px] text-muted-foreground">{t("clinical.recordsList.bloodPressure")}</div></div>}
            {record.vitals.heartRate     && <div className="bg-muted/30 rounded-lg p-2 text-center"><div className="text-xs font-bold">{record.vitals.heartRate}</div><div className="text-[10px] text-muted-foreground">{t("clinical.recordsList.heartRate")}</div></div>}
            {record.vitals.notes         && <div className="bg-muted/30 rounded-lg p-2 text-center"><div className="text-xs font-bold">{record.vitals.notes}</div><div className="text-[10px] text-muted-foreground">{t("common.notes")}</div></div>}
          </div>
        </div>
      )}
      {data.odontogram && Object.keys(data.odontogram).length > 0 && (() => {
        const conditionLabels: Record<string, string> = {
          healthy: t("clinical.recordsList.condHealthy"), caries: t("clinical.recordsList.condCaries"), restoration: t("clinical.recordsList.condRestoration"),
          crown: t("clinical.recordsList.condCrown"), endo: t("clinical.recordsList.condEndo"), absent: t("clinical.recordsList.condAbsent"),
          extraction: t("clinical.recordsList.condExtraction"), implant: t("clinical.recordsList.condImplant"),
        };
        return (
          <div>
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.odontogram")}</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.odontogram).map(([num, state]: [string, any]) => {
                if (typeof state === "string") {
                  // OLD format: { "26": "caries" }
                  return (
                    <span key={num} className="text-[10px] font-semibold bg-card border border-border rounded-lg px-2 py-1">
                      <span className="text-muted-foreground">D{num}:</span> {conditionLabels[state] ?? state}
                    </span>
                  );
                }
                // NEW format: { "26": { "O": "caries", "M": "restoration" } }
                const surfaces = Object.entries(state as Record<string, string>)
                  .filter(([, v]) => v && v !== "healthy")
                  .map(([s, v]) => `${s}=${conditionLabels[v] ?? v}`)
                  .join(", ");
                if (!surfaces) return null;
                return (
                  <span key={num} className="text-[10px] font-semibold bg-card border border-border rounded-lg px-2 py-1">
                    <span className="text-muted-foreground">D{num}:</span> {surfaces}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })()}
      {data.procedures?.length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.proceduresPerformed")}</div>
          <div className="flex flex-wrap gap-1.5">
            {data.procedures.map((p: any) => {
              const label = typeof p === "string" ? p : (p?.name ?? t("clinical.recordsList.procedure"));
              const key = typeof p === "string" ? p : (p?.id ?? label);
              return <span key={key} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-600/15 text-brand-700 border border-brand-200">{label}</span>;
            })}
          </div>
        </div>
      )}
      {data.periodontal && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.periodontalEval")}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.periodontal.plaque      && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.plaque")}</span><span className="font-semibold">{data.periodontal.plaque}</span></div>}
            {data.periodontal.calculus    && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.calculus")}</span><span className="font-semibold">{data.periodontal.calculus}</span></div>}
            {data.periodontal.gingival    && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.gingival")}</span><span className="font-semibold">{data.periodontal.gingival}</span></div>}
            {data.periodontal.pocketDepth && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.pockets")}</span><span className="font-semibold">{data.periodontal.pocketDepth}</span></div>}
          </div>
        </div>
      )}
      {record.assessment && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.clinicalObservations")}</div>
          <p className="text-sm">{record.assessment}</p>
        </div>
      )}
      {record.plan && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.treatmentPlan")}</div>
          <p className="text-sm">{record.plan}</p>
        </div>
      )}
      {data.xrays && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.xrays")}</div>
          <p className="text-sm">{data.xrays}</p>
        </div>
      )}
      {data.nextVisit && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.nextVisitRecommended")}</div>
          <p className="text-sm font-semibold text-brand-700">{data.nextVisit}</p>
        </div>
      )}
    </div>
  );
}

function NutritionRecordDetail({ data, record }: { data: any; record: any }) {
  const t = useT();
  const a = data.anthropometrics;
  return (
    <div className="space-y-4 text-sm">
      {record.subjective && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.reasonForVisit")}</div>
          <p>{record.subjective}</p>
        </div>
      )}
      {a && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.anthropometry")}</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: t("clinical.recordsList.weight"),       val: a.weight     ? `${a.weight} kg`  : null },
              { label: t("clinical.recordsList.height"),      val: a.height     ? `${a.height} cm`  : null },
              { label: t("clinical.recordsList.bmi"),        val: a.bmi        ? a.bmi             : null },
              { label: t("clinical.recordsList.tdee"),        val: a.tdee       ? `${a.tdee} kcal`  : null },
              { label: t("clinical.recordsList.bmr"),        val: a.bmr        ? `${a.bmr} kcal`   : null },
              { label: t("clinical.recordsList.bodyFat"),   val: a.bodyFat    ? `${a.bodyFat}%`   : null },
              { label: t("clinical.recordsList.waist"),   val: a.waist      ? `${a.waist} cm`   : null },
              { label: t("clinical.recordsList.hip"),    val: a.hip        ? `${a.hip} cm`     : null },
              { label: t("clinical.recordsList.whr"),       val: a.waistHip   ? a.waistHip        : null },
              { label: t("clinical.recordsList.muscleMass"), val: a.muscleMass ? `${a.muscleMass} kg` : null },
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
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.habits")}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.diet          && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.diet")}</span><span className="font-semibold">{data.diet}</span></div>}
            {data.activityLevel && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.activity")}</span><span className="font-semibold">{data.activityLevel}</span></div>}
            {data.waterIntake   && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.water")}</span><span className="font-semibold">{data.waterIntake} {t("clinical.recordsList.litersPerDay")}</span></div>}
            {data.sleepHours    && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.sleep")}</span><span className="font-semibold">{data.sleepHours} {t("clinical.recordsList.hrs")}</span></div>}
          </div>
        </div>
      )}
      {data.allergies && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.foodAllergies")}</div><p>{data.allergies}</p></div>}
      {data.labResults && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.labs")}</div><p className="whitespace-pre-line">{data.labResults}</p></div>}
      {record.assessment && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.nutritionalDiagnosis")}</div><p>{record.assessment}</p></div>}
      {data.goals && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.goals")}</div><p>{data.goals}</p></div>}
      {record.plan && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.mealPlan")}</div><p className="whitespace-pre-line">{record.plan}</p></div>}
    </div>
  );
}

function PsychologyRecordDetail({ data, record }: { data: any; record: any }) {
  const t = useT();
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold">{t("clinical.recordsList.session")} #{data.sessionNumber}</span>
        <span className="text-xs text-muted-foreground">{data.sessionType}</span>
        <span className="text-xs text-muted-foreground">{t("clinical.recordsList.approach")}: {data.approach}</span>
      </div>
      {data.scales && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.assessmentScales")}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-extrabold text-brand-700">{data.scales.phq9?.score ?? "—"}<span className="text-sm text-muted-foreground">/27</span></div>
              <div className="text-xs font-bold text-muted-foreground">PHQ-9 · {t("clinical.recordsList.depression")}</div>
              <div className="text-xs font-bold text-brand-700 mt-0.5">{data.scales.phq9?.severity}</div>
            </div>
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-extrabold text-violet-700">{data.scales.gad7?.score ?? "—"}<span className="text-sm text-muted-foreground">/21</span></div>
              <div className="text-xs font-bold text-muted-foreground">GAD-7 · {t("clinical.recordsList.anxiety")}</div>
              <div className="text-xs font-bold text-violet-700 mt-0.5">{data.scales.gad7?.severity}</div>
            </div>
          </div>
        </div>
      )}
      {data.mentalStatus && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.mentalStatus")}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.mentalStatus.sleepQuality      && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.sleep")}</span><span className="font-semibold">{data.mentalStatus.sleepQuality}</span></div>}
            {data.mentalStatus.appetiteChanges   && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.appetite")}</span><span className="font-semibold">{data.mentalStatus.appetiteChanges}</span></div>}
            {data.mentalStatus.socialFunctioning && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.socialFunctioning")}</span><span className="font-semibold">{data.mentalStatus.socialFunctioning}</span></div>}
            {data.mentalStatus.workFunctioning   && <div className="flex justify-between bg-muted/30 rounded-lg px-3 py-2"><span className="text-muted-foreground">{t("clinical.recordsList.workFunctioning")}</span><span className="font-semibold">{data.mentalStatus.workFunctioning}</span></div>}
          </div>
          {data.mentalStatus.suicidalIdeation && data.mentalStatus.suicidalIdeation !== "no" && (
            <div className="mt-2 flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-rose-700">⚠️ {t("clinical.recordsList.suicidalIdeation")}: {data.mentalStatus.suicidalIdeation}</span>
            </div>
          )}
        </div>
      )}
      {record.objective && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.sessionContent")}</div><p className="whitespace-pre-line">{record.objective}</p></div>}
      {record.assessment && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.diagnosis")}</div><p>{record.assessment}</p></div>}
      {data.interventions && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.interventions")}</div><p>{data.interventions}</p></div>}
      {data.patientResponse && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.patientResponse")}</div><p>{data.patientResponse}</p></div>}
      {data.homework && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.homework")}</div><p>{data.homework}</p></div>}
      {record.plan && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.therapeuticPlan")}</div><p>{record.plan}</p></div>}
    </div>
  );
}

function MedicineRecordDetail({ data, record }: { data: any; record: any }) {
  const t = useT();
  return (
    <div className="space-y-4 text-sm">
      {record.subjective && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.reasonHpi")}</div><p className="whitespace-pre-line">{record.subjective}</p></div>}
      {record.vitals && Object.values(record.vitals).some(v => v) && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.vitalSigns")}</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "T/A",         val: record.vitals.bloodPressure   },
              { label: "FC",          val: record.vitals.heartRate        },
              { label: t("clinical.recordsList.temperature"), val: record.vitals.temperature      },
              { label: "FR",          val: record.vitals.respiratoryRate  },
              { label: "Sat. O₂",    val: record.vitals.oxygenSat        },
              { label: t("clinical.recordsList.bloodGlucose"),   val: record.vitals.bloodGlucose     },
              { label: t("clinical.recordsList.weight"),       val: record.vitals.weight ? `${record.vitals.weight} kg` : null },
              { label: t("clinical.recordsList.height"),      val: record.vitals.height ? `${record.vitals.height} cm` : null },
            ].filter(i => i.val).map(item => (
              <div key={item.label} className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-xs font-bold">{item.val}</div>
                <div className="text-[10px] text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {record.objective && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.physicalExamLabs")}</div><p className="whitespace-pre-line">{record.objective}</p></div>}
      {record.assessment && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.diagnosis")}</div><p className="font-semibold">{record.assessment}</p></div>}
      {data.medications?.filter((m: any) => m.drug).length > 0 && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("clinical.recordsList.medicalPrescription")}</div>
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
      {record.plan && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.planInstructions")}</div><p className="whitespace-pre-line">{record.plan}</p></div>}
      {data.referral && <div><div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{t("clinical.recordsList.referral")}</div><p>{data.referral}</p></div>}
      {data.sicLeave?.granted && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="text-xs font-bold text-amber-700">📋 {t("clinical.recordsList.medicalLeave")}: {data.sicLeave.days} {t("clinical.recordsList.days")}</span>
        </div>
      )}
    </div>
  );
}

interface Props {
  records: any[];
}

export function ClinicalRecordsList({ records }: Props) {
  const t = useT();
  const [expandedId, setExpandedId] = useState<string | null>(
    records.length > 0 ? records[0].id : null
  );

  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        {t("clinical.recordsList.emptyState")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((record, idx) => {
        const specialty = record.specialtyData?.type ?? "medicine";
        const icon      = SPECIALTY_ICONS[specialty] ?? "📋";
        const labelKey  = SPECIALTY_LABEL_KEYS[specialty];
        const label     = labelKey ? t(labelKey) : t("clinical.recordsList.consultation");
        const isOpen    = expandedId === record.id;

        return (
          <div key={record.id} className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
            {/* Header - always visible, clickable */}
            <button
              onClick={() => setExpandedId(isOpen ? null : record.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full bg-brand-500/15 flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                {records.length - idx}
              </div>
              <span className="text-lg flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{label}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(record.visitDate)} · {t("clinical.recordsList.doctorPrefix")} {record.doctor?.firstName} {record.doctor?.lastName}
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
                    {record.subjective && <div><div className="text-xs font-bold text-muted-foreground mb-1">{t("clinical.recordsList.subjective")}</div><p>{record.subjective}</p></div>}
                    {record.objective  && <div><div className="text-xs font-bold text-muted-foreground mb-1">{t("clinical.recordsList.objective")}</div><p>{record.objective}</p></div>}
                    {record.assessment && <div><div className="text-xs font-bold text-muted-foreground mb-1">{t("clinical.recordsList.diagnosis")}</div><p>{record.assessment}</p></div>}
                    {record.plan       && <div><div className="text-xs font-bold text-muted-foreground mb-1">{t("clinical.recordsList.plan")}</div><p>{record.plan}</p></div>}
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
