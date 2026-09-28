"use client";

// Ortodoncia — Ola 0 (ws1-t1): el cableado de la pestaña «Ortodoncia» de la
// ficha del paciente, sacado tal cual de `patient-detail-client.tsx`
// (líneas ~2010-2652 antes de este movimiento — ver REPORTE-ws1-t1.md).
// Movimiento MECÁNICO: mismas props, mismos handlers, mismo comportamiento.
// A partir de aquí, patient-detail-client.tsx NO vuelve a tocar ortodoncia:
// cada parte de la Ola 1 trabaja en este archivo o en los suyos propios
// (ver «MAPA DE PARTES», REPORTE-ws1-t1.md), nunca en la ficha compartida.
//
// Mantiene la MISMA carga perezosa que tenía en patient-detail-client.tsx:
// los dos `next/dynamic` de abajo (Fase 1 rediseño + fallback legacy) siguen
// siendo el punto de corte del bundle — moverlos aquí no cambia qué se
// descarga ni cuándo.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { getInitials } from "@/lib/utils";
import { ageFromDob } from "@/lib/format";
import type { OrthoTabData } from "@/lib/orthodontics/load-data";
import type { OrthoRedesignViewModel } from "./types";
import type { OrthoRedesignBundle } from "@/lib/orthodontics/redesign/loader";
import {
  signTreatmentCard,
  saveTreatmentCardDraft,
  createOrthoTAD,
  addWireStep,
  advanceTreatmentPhase,
  selectQuoteScenario,
  sendSignAtHomeLink,
  confirmCollect,
  createOrthoLabOrder,
  toggleRetentionPreSurvey,
  createPhotoSet,
  uploadPhotoToSet,
  updateFinancialPlan,
  updateDiagnosis,
  updateOrthoAppliances,
  createReferralLetter,
  updateRetentionRegimenConfig,
  updateNpsConfig,
  scheduleG15Checkpoint,
  updateQuoteScenario,
  createDiagnosis,
  createTreatmentPlan,
  updateTreatmentPlan,
  getCaseIntakeOptions,
} from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import orto from "./orto.module.css";
import { RAIZ_ORTO } from "./raiz";

// Fallback de carga de los módulos lazy — idéntico al de
// patient-detail-client.tsx (componente cliente para poder traducir con
// useT dentro del árbol que ya tiene el I18nProvider).
function ModuleLoading({ labelKey }: { labelKey: string }) {
  const t = useT();
  // Ocupa el alto de la cabecera del paciente: cuando el módulo termina de
  // bajar, lo de debajo no da un salto.
  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`} role="status" aria-live="polite">
      <div
        className={`${orto.cabecera} ${orto.tonoApagado} flex items-center justify-center text-xs`}
        style={{ minHeight: 168 }}
      >
        {t(labelKey)}
      </div>
    </div>
  );
}

// Fase 1 rediseño usa OrthodonticsRedesignClient (Hero + Diagnóstico + Plan +
// Treatment Card G1 + drawers + sidebar derecha). Fallback al cliente legacy
// `OrthodonticsClient` cuando no hay viewModel.
const OrthodonticsRedesignClient = dynamicImport(
  () =>
    import("./OrthodonticsRedesignClient").then(
      (m) => ({ default: m.OrthodonticsRedesignClient }),
    ),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.orthodontics" />
    ),
  },
);

const OrthodonticsClient = dynamicImport(
  () =>
    import("@/components/specialties/orthodontics/OrthodonticsClient").then((m) => ({
      default: m.OrthodonticsClient,
    })),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.orthodonticsLegacy" />
    ),
  },
);

// resolveFileUrl es función — no se puede pasar de server a client. Este
// archivo ya es "use client" (igual que antes en patient-detail-client.tsx),
// mismo patrón que /dashboard/patients/[id]/orthodontics/page.tsx.
function resolveOrthoFileUrl(fileId: string): string {
  return `/api/patient-files/${fileId}`;
}

// Mapeo slotId del SectionPhotos → OrthoPhotoView del API. Solo las 8 vistas
// AAO persistibles tienen mapeo; sobremordida y resalte (extra-AAO) no
// tienen columna en OrthoPhotoSet y se documentan como Fase 2.
const SLOT_TO_VIEW: Record<
  string,
  | "EXTRA_FRONTAL"
  | "EXTRA_PROFILE"
  | "EXTRA_SMILE"
  | "INTRA_FRONTAL_OCCLUSION"
  | "INTRA_LATERAL_RIGHT"
  | "INTRA_LATERAL_LEFT"
  | "INTRA_OCCLUSAL_UPPER"
  | "INTRA_OCCLUSAL_LOWER"
> = {
  normal: "EXTRA_FRONTAL",
  lateral: "EXTRA_PROFILE",
  sonrisa: "EXTRA_SMILE",
  frontal: "INTRA_FRONTAL_OCCLUSION",
  lat_der: "INTRA_LATERAL_RIGHT",
  lat_izq: "INTRA_LATERAL_LEFT",
  oclusal_sup: "INTRA_OCCLUSAL_UPPER",
  oclusal_inf: "INTRA_OCCLUSAL_LOWER",
};

export interface OrthodonticsPatientTabPatient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string | Date | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  bloodType: string | null;
  allergies: unknown;
}

export interface OrthodonticsPatientTabProps {
  patient: OrthodonticsPatientTabPatient;
  fullName: string;
  // `appointments` es `any[]` en patient-detail-client.tsx (sin tipar):
  // `date` viaja tal cual venga del server component, sin garantía de forma.
  nextAppt: { id: string; date: any } | undefined;
  lastAppt: { date: any } | undefined;
  completedCount: number;
  pediatricsModuleActive: boolean;
  /** Interruptor `menu-dos-niveles`. Ya no decide nada aquí: el módulo viste
   *  el idioma nuevo por sí mismo (ver más abajo). Se conserva en la firma
   *  para no tocar a quien monta la pestaña. */
  rediseno: boolean;
  orthoData: OrthoTabData | null | undefined;
  orthoRedesignVM: OrthoRedesignViewModel | null | undefined;
  orthoRedesignBundle: OrthoRedesignBundle | null | undefined;
  /** Antes `() => setTab("agenda")` en patient-detail-client.tsx. */
  onScheduleNext: () => void;
  /** Antes `openBillingTab` en patient-detail-client.tsx. */
  onCollect: () => void;
}

/** La pestaña «Ortodoncia» completa: banda de rediseño + ficha nueva o legacy. */
export function OrthodonticsPatientTab(props: OrthodonticsPatientTabProps) {
  const {
    patient,
    fullName,
    nextAppt,
    lastAppt,
    completedCount,
    pediatricsModuleActive,
    orthoData,
    orthoRedesignVM,
    orthoRedesignBundle,
    onScheduleNext,
    onCollect,
  } = props;
  const router = useRouter();
  const t = useT();

  // Ola 1 (ws1-t6) — A10: si ya hay diagnóstico, pregunta una sola vez si
  // existe un consentimiento GENERAL de ortodoncia firmado (no bloquea el
  // render mientras llega: el banner solo aparece cuando la respuesta es
  // explícitamente `false`, nunca en `null`/cargando).
  const [generalConsentSigned, setGeneralConsentSigned] = useState<boolean | null>(null);
  const diagnosisId = orthoRedesignVM?.diagnosis?.id ?? null;
  useEffect(() => {
    if (!diagnosisId) {
      setGeneralConsentSigned(null);
      return;
    }
    let cancelled = false;
    getCaseIntakeOptions({ patientId: patient.id }).then((res) => {
      if (!cancelled && !isFailure(res)) setGeneralConsentSigned(res.data.generalConsentSigned);
    });
    return () => {
      cancelled = true;
    };
  }, [patient.id, diagnosisId]);

  return (
    <>
      {/* La banda «Ortodoncia · paciente» (hallazgo 21) era el escalón entre
          la ficha nueva y un módulo que conservaba su ropa vieja. El módulo
          ya habla el idioma de la ficha y abre con la cabecera del paciente,
          así que la banda repetía el nombre una tercera vez y empujaba el
          contenido 75 px: se deja de montar (SalidaOrtodoncia sigue en su
          archivo). */}
      {orthoRedesignVM && (
        <OrthodonticsRedesignClient
          vm={orthoRedesignVM}
          digitalRecords={orthoData?.digitalRecords?.map((r: any) => {
            const RECORD_LABEL: Record<string, string> = {
              CEPH_ANALYSIS_PDF: t("patients.ortho.recordCeph"),
              SCAN_STL: t("patients.ortho.recordStl"),
            };
            const RECORD_KIND: Record<string, "ceph" | "stl" | "other"> = {
              CEPH_ANALYSIS_PDF: "ceph",
              SCAN_STL: "stl",
            };
            return {
              label: r.notes ?? RECORD_LABEL[r.recordType] ?? r.recordType,
              date: r.capturedAt instanceof Date
                ? r.capturedAt.toISOString()
                : (typeof r.capturedAt === "string" ? r.capturedAt : null),
              kind: RECORD_KIND[r.recordType] ?? "other",
            };
          }) ?? []}
          historicalPhotoSets={orthoRedesignBundle?.historicalPhotoSets ?? []}
          installments={orthoRedesignBundle?.installments ?? []}
          quoteScenarios={orthoRedesignBundle?.quoteScenarios ?? []}
          cfdiRecords={orthoRedesignBundle?.cfdiRecords ?? []}
          retentionRegimen={orthoRedesignBundle?.retentionRegimen ?? null}
          retainerCheckups={orthoRedesignBundle?.retainerCheckups ?? []}
          npsSchedules={orthoRedesignBundle?.npsSchedules ?? []}
          referralCode={orthoRedesignBundle?.referralCode ?? null}
          labOrders={orthoRedesignBundle?.labOrders ?? []}
          consents={orthoRedesignBundle?.consents ?? []}
          referralLetters={orthoRedesignBundle?.referralLetters ?? []}
          whatsappLog={orthoRedesignBundle?.whatsappLog ?? []}
          treatmentStatus={orthoRedesignBundle?.treatmentStatus ?? "en-tratamiento"}
          generalConsentSigned={generalConsentSigned}
          financialPlan={orthoRedesignBundle?.financialPlan ?? null}
          onUpdateFinancialPlan={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateFinancialPlan({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(
              t("patients.ortho.financialPlanUpdated", {
                count: res.data.installmentCount,
                amount: res.data.installmentAmount.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }),
              }),
            );
            router.refresh();
          }}
          canOverridePhase={true}
          patientHeader={{
            patient: {
              id: patient.id,
              fullName: fullName,
              avatarInitials: getInitials(patient.firstName, patient.lastName),
              age: patient.dob ? ageFromDob(new Date(patient.dob)) : null,
              sex:
                patient.gender === "F"
                  ? "F"
                  : patient.gender === "M"
                    ? "M"
                    : patient.gender === "OTHER"
                      ? "X"
                      : null,
              phone: patient.phone ?? null,
              email: patient.email ?? null,
              bloodType: patient.bloodType ?? null,
              guardianLabel: orthoData?.guardianName
                ? t("patients.ortho.guardianLabel", { name: orthoData.guardianName })
                : null,
              criticalAllergies:
                Array.isArray(patient.allergies) && patient.allergies.length > 0
                  ? patient.allergies.join(", ")
                  : null,
            },
            // outstandingAmount ya no se calcula aquí (hallazgo ws1-t4 §5):
            // OrthodonticsRedesignClient lee la factura real del caso vía
            // cargarPanelDeCobro, no `treatment.totalCost - treatment.paid`
            // (el precio de referencia, que decía "$45,000 Pendiente" sin
            // que existiera ninguna factura).
            // En tab Ortodoncia, derivamos lastVisitAt y totalVisits del
            // modelo OrthodonticControlAppointment (visitas reales del tx
            // ortodóntico), no del Appointment genérico.
            lastVisitAt: (() => {
              const performed = (orthoData?.controls ?? []).filter(
                (c: any) => c.performedAt,
              );
              if (performed.length === 0) return lastAppt?.date ?? null;
              performed.sort(
                (a: any, b: any) =>
                  new Date(b.performedAt).getTime() -
                  new Date(a.performedAt).getTime(),
              );
              return performed[0].performedAt instanceof Date
                ? performed[0].performedAt.toISOString()
                : performed[0].performedAt;
            })(),
            totalVisits: {
              count:
                (orthoData?.controls ?? []).filter(
                  (c: any) => c.attendance === "ATTENDED" && c.performedAt,
                ).length || completedCount,
              sinceLabel: orthoRedesignVM.treatment.startDate
                ? t("patients.ortho.sinceLabel", { date: new Date(orthoRedesignVM.treatment.startDate).toLocaleDateString("es-MX", { month: "short", year: "numeric" }) })
                : null,
            },
            onStartVisit: () => {
              if (nextAppt) router.push(`?appointment=${nextAppt.id}`);
              else toast(t("patients.ortho.scheduleApptFirst"));
            },
            onScheduleNext,
            onCollect,
            onMore: undefined,
          }}
          // Ola 1 (ws1-t6) — «Alta del caso»: antes estos dos handlers
          // mandaban a la vista antigua (/dashboard/specialties/orthodontics/
          // [id], S1). Ahora abren el asistente DENTRO de la ficha nueva —
          // ver `onCreateCase` más abajo — así que S1 ya no es el único
          // camino para abrir un caso y se puede ocultar cuando Rafael lo
          // decida (REPORTE-ws1-t1.md, «Ojo» de esta parte).
          onCreateCase={async (payload) => {
            let diagnosisId = orthoRedesignVM.diagnosis?.id ?? null;
            if (payload.diagnosis) {
              const res = await createDiagnosis({ patientId: patient.id, ...payload.diagnosis });
              if (isFailure(res)) {
                toast.error(res.error);
                return;
              }
              diagnosisId = res.data.id;
              if (
                !res.data.altaCasoFieldsSaved &&
                (payload.diagnosis.referredByDoctorId || payload.diagnosis.inObservation)
              ) {
                toast(t("patients.ortho.altaCasoSqlPending"));
              }
            }
            if (!diagnosisId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            if (payload.plan) {
              const res = await createTreatmentPlan({
                diagnosisId,
                patientId: patient.id,
                ...payload.plan,
              });
              if (isFailure(res)) {
                toast.error(res.error);
                return;
              }
              if (!res.data.altaCasoFieldsSaved && (payload.plan.treatingDoctorId || payload.plan.responsibleGuardianId || payload.plan.newResponsibleGuardian)) {
                toast(t("patients.ortho.altaCasoSqlPending"));
              }
              toast.success(t("patients.ortho.caseOpened"));
            } else {
              toast.success(t("patients.ortho.caseOpenedObservation"));
            }
            router.refresh();
          }}
          onOpenImagingRecords={() => {
            // A9 · enlaza a lo que ya existe en el expediente (radiografías,
            // panorámica, lateral de cráneo, modelos 3D) en vez de mandar al
            // asistente de diagnóstico — el alcance lo pidió reducido a
            // "enlazar", no a construir un uploader propio dentro del caso.
            router.push(`/dashboard/xrays/${patient.id}`);
          }}
          onUpdateCaseSettings={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateTreatmentPlan({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
              // `status` es `z.enum(...).optional()` — SIN `.nullable()` — a
              // diferencia de los demás campos de este payload; `null` lo
              // rechazaría cuando el estado no cambió.
              status: payload.status ?? undefined,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            if (!res.data.altaCasoFieldsSaved && (payload.treatingDoctorId || payload.responsibleGuardianId || payload.newResponsibleGuardian)) {
              toast(t("patients.ortho.altaCasoSqlPending"));
            }
            toast.success(t("patients.ortho.caseSettingsSaved"));
            router.refresh();
          }}
          onUpdateDiagnosis={async (payload) => {
            const res = await updateDiagnosis({
              ...payload,
              patientId: patient.id,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.diagnosisUpdated"));
            router.refresh();
          }}
          onUpdateAppliances={async (payload) => {
            const res = await updateOrthoAppliances(payload);
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.appliancesUpdated"));
            router.refresh();
          }}
          onCreateReferralLetter={async (payload) => {
            const res = await createReferralLetter({
              patientId: patient.id,
              ...payload,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.referralLetterSent"));
            router.refresh();
          }}
          onUpdateRetentionRegimen={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateRetentionRegimenConfig({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
              upperRetainer: payload.upperRetainer as any,
              lowerRetainer: payload.lowerRetainer as any,
              fixedLingualGauge: payload.fixedLingualGauge as any,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.retentionRegimenSaved"));
            router.refresh();
          }}
          onUpdateNpsConfig={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await updateNpsConfig({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              ...payload,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(
              payload.customMessage
                ? t("patients.ortho.npsConfigSavedWhatsapp")
                : t("patients.ortho.npsConfigSaved"),
            );
            router.refresh();
          }}
          onScheduleG15Action={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await scheduleG15Checkpoint({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.g15Scheduled"));
            router.refresh();
          }}
          onUpdateQuoteScenario={async (payload) => {
            const res = await updateQuoteScenario(payload);
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.scenarioUpdated"));
            router.refresh();
          }}
          onAddWireStep={undefined}
          onSubmitWireStep={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await addWireStep({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              phase: payload.phase,
              material: payload.material,
              shape: payload.shape,
              gauge: payload.gauge,
              archUpper: payload.archUpper,
              archLower: payload.archLower,
              durationWeeks: payload.durationWeeks,
              auxiliaries: payload.auxiliaries,
              purpose: payload.purpose ?? null,
              notes: payload.notes ?? null,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.wireStepAdded"));
            router.refresh();
          }}
          // onAddTad queda sin override: OrthodonticsRedesignClient abre su
          // DrawerAddTad interno (hallazgo ws1-t4 §9 — antes 4
          // window.prompt() seguidos, sin poder corregir un campo sin
          // cancelar los cuatro).
          onAddTad={undefined}
          onSubmitAddTad={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await createOrthoTAD({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              brand: payload.brand,
              size: payload.size,
              location: payload.location,
              torqueNcm: payload.torqueNcm,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.tadRegistered"));
            router.refresh();
          }}
          onCardSigned={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await signTreatmentCard({
              cardId: payload.cardId,
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              cardNumber:
                (orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                  ?.cardNumber ??
                  orthoRedesignVM.treatmentCards.reduce(
                    (m, c) => Math.max(m, c.cardNumber),
                    0,
                  ) + 1),
              visitDate:
                orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                  ?.visitDate ?? new Date().toISOString(),
              durationMin:
                orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                  ?.durationMin ?? 30,
              phaseKey:
                orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                  ?.phaseKey ??
                orthoRedesignVM.treatment.phase ??
                "LEVELING",
              monthAt:
                orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                  ?.monthAt ?? orthoRedesignVM.treatment.monthCurrent,
              wireFromId:
                orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                  ?.wireFrom?.id ?? null,
              wireToId: payload.wireToId,
              soap: payload.soap,
              hygiene: payload.hygiene,
              elastics: payload.elastics,
              iprPoints: payload.iprPoints,
              brokenBrackets: payload.brokenBrackets,
              hasProgressPhoto: payload.hasProgressPhoto,
              photoSetId: payload.photoSetId,
              nextDate: payload.nextDate,
              nextDurationMin: payload.nextDurationMin,
              activationsNote: payload.activationsNote,
              indications: payload.indications,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            // Ola 2 (ws1-t1) — «nada en silencio»: si el control era de una
            // cita de agenda y el modo de cobro es «Pago por control» pero
            // no se pudo facturar solo (catálogo sin precio, o un error al
            // crear la factura), la firma clínica se guardó igual pero
            // Recepción tiene que enterarse para cobrarlo a mano.
            if (res.data.avisoControlSinFacturar) {
              toast.error(res.data.avisoControlSinFacturar, { duration: 8000 });
            }
            toast.success(t("patients.ortho.appointmentSigned"));
            router.refresh();
            // §1 completo (ws1-t8): el cajón recuerda este id — así, si ya
            // se había guardado un borrador antes en la MISMA sesión y
            // ahora se firma, el siguiente submit manda este cardId en vez
            // de null (evita el "Unique constraint failed on
            // (treatmentPlanId, cardNumber)" de intentar CREAR dos veces).
            return res.data.cardId;
          }}
          onCardDraftSaved={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const card = orthoRedesignVM.treatmentCards.find(
              (c) => c.id === payload.cardId,
            );
            const res = await saveTreatmentCardDraft({
              cardId: payload.cardId,
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              cardNumber:
                card?.cardNumber ??
                orthoRedesignVM.treatmentCards.reduce(
                  (m, c) => Math.max(m, c.cardNumber),
                  0,
                ) + 1,
              visitDate: card?.visitDate ?? new Date().toISOString(),
              durationMin: card?.durationMin ?? 30,
              phaseKey:
                card?.phaseKey ?? orthoRedesignVM.treatment.phase ?? "LEVELING",
              monthAt: card?.monthAt ?? orthoRedesignVM.treatment.monthCurrent,
              wireFromId: card?.wireFrom?.id ?? null,
              wireToId: payload.wireToId,
              soap: payload.soap,
              hygiene: payload.hygiene,
              elastics: payload.elastics,
              iprPoints: payload.iprPoints,
              brokenBrackets: payload.brokenBrackets,
              hasProgressPhoto: payload.hasProgressPhoto,
              photoSetId: payload.photoSetId,
              nextDate: payload.nextDate,
              nextDurationMin: payload.nextDurationMin,
              activationsNote: payload.activationsNote,
              indications: payload.indications,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.draftSaved"));
            router.refresh();
            // §1 completo (ws1-t8): mismo motivo que en onCardSigned arriba.
            return res.data.cardId;
          }}
          onPhaseAdvanced={async (payload) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            // El audit trail (criteriaChecked, isOverride) lo registra
            // OrthoPhaseTransition por separado; advanceTreatmentPhase solo
            // necesita treatmentPlanId + toPhase + notes.
            const notesParts = [
              payload.doctorNotes ?? "",
              payload.isOverride
                ? `OVERRIDE: ${payload.overrideReason ?? "—"}`
                : "",
              payload.criteriaChecked.length > 0
                ? `Criterios: ${payload.criteriaChecked.join(", ")}`
                : "",
            ].filter(Boolean);
            const res = await advanceTreatmentPhase({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              toPhase: payload.toPhase,
              notes: notesParts.join(" · ") || null,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.phaseAdvanced", { phase: payload.toPhase }));
            router.refresh();
          }}
          onSelectQuoteScenario={async (scenarioId) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await selectQuoteScenario({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              scenarioId,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.scenarioSelected"));
            router.refresh();
          }}
          onSendSignAtHome={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const accepted = orthoRedesignBundle?.quoteScenarios.find(
              (s) => s.status === "ACCEPTED",
            );
            if (!accepted) {
              toast.error(t("patients.ortho.selectScenarioBeforeSign"));
              return;
            }
            const res = await sendSignAtHomeLink({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              scenarioId: accepted.id,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.signAtHomeSent"));
            router.refresh();
          }}
          onConfirmCollect={async (method) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await confirmCollect({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              method,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.collectRegistered"));
            if ((res.data as { cfdiTimbradoStub?: boolean }).cfdiTimbradoStub) {
              toast(t("patients.ortho.cfdiStub"));
            }
            router.refresh();
          }}
          onCreateLabOrder={async (payload) => {
            const res = await createOrthoLabOrder({
              patientId: patient.id,
              catalog: payload.catalog,
              description: payload.description,
              lab: payload.lab,
              expectedDate: payload.expectedDate,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(t("patients.ortho.labOrderCreated"));
            router.refresh();
          }}
          onTogglePreSurvey={async (enabled) => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const res = await toggleRetentionPreSurvey({
              treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
              enabled,
            });
            if (isFailure(res)) {
              toast.error(res.error);
              return;
            }
            toast.success(
              enabled ? t("patients.ortho.preSurveyEnabled") : t("patients.ortho.preSurveyDisabled"),
            );
            router.refresh();
          }}
          onGeneratePdfBeforeAfter={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            // Genera PDF comparativo T0 vs Tn vía endpoint existente. El
            // download se dispara en el browser; el endpoint usa puppeteer +
            // las URLs firmadas de Supabase Storage.
            const url = `/api/orthodontics/treatment-plans/${orthoRedesignVM.treatment.treatmentPlanId}/comparison-pdf`;
            window.open(url, "_blank");
            toast.success(t("patients.ortho.generatingBeforeAfterPdf"));
          }}
          onCopyReferralCode={() => {
            const code = orthoRedesignBundle?.referralCode?.code;
            if (!code) {
              toast(t("patients.ortho.noReferralCode"));
              return;
            }
            navigator.clipboard
              .writeText(code)
              .then(() => toast.success(t("patients.ortho.codeCopied", { code })))
              .catch(() => toast.error(t("patients.ortho.clipboardFailed")));
          }}
          onUploadPhoto={async (stage, slotId, file) => {
            // Persistencia real: createPhotoSet (si no existe set para esta
            // etapa) → POST /api/orthodontics/photos/upload →
            // uploadPhotoToSet → router.refresh() para que el loader
            // re-pinte con la URL firmada de Supabase.
            const view = SLOT_TO_VIEW[slotId];
            if (!view) {
              // Slot extra-AAO (sobremordida / resalte): no tienen columna
              // en OrthoPhotoSet schema actual. Subir requiere ALTER TABLE
              // (no servicio externo · backlog interno).
              toast.error(t("patients.ortho.slotOutsideAao"));
              return;
            }
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            try {
              // 1. Resolver setId · usar el del bundle si existe, o crear
              //    uno nuevo para esta etapa.
              const existingSet =
                orthoRedesignBundle?.historicalPhotoSets.find(
                  (s) => s.stage === stage,
                );
              let setId = existingSet?.setId ?? null;
              if (!setId) {
                const created = await createPhotoSet({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  patientId: patient.id,
                  setType: stage,
                  capturedAt: new Date().toISOString(),
                  monthInTreatment: orthoRedesignVM.treatment.monthCurrent,
                });
                if (isFailure(created)) {
                  toast.error(created.error);
                  return;
                }
                setId = (created.data as { id: string }).id;
              }

              // 2. POST file + setId + view al endpoint que sube a Supabase
              //    Storage + crea PatientFile.
              const fd = new FormData();
              fd.append("file", file);
              fd.append("setId", setId);
              fd.append("view", view);
              const res = await fetch(
                "/api/orthodontics/photos/upload",
                { method: "POST", body: fd },
              );
              if (!res.ok) {
                const errBody = await res.json().catch(() => null);
                toast.error(errBody?.error ?? t("patients.ortho.photoUploadFailed"));
                return;
              }
              const { fileId } = (await res.json()) as { fileId: string };

              // 3. Asocia el PatientFile a la columna del set.
              const attached = await uploadPhotoToSet({
                setId,
                fileId,
                view,
              });
              if (isFailure(attached)) {
                toast.error(attached.error);
                return;
              }

              toast.success(t("patients.ortho.photoUploaded", { view: view.replace(/_/g, " ").toLowerCase() }));
              // 4. Re-pinta con URLs firmadas frescas del loader.
              router.refresh();
            } catch (e) {
              console.error("[ortho upload] failed:", e);
              toast.error(t("patients.ortho.photoUploadUnexpected"));
            }
          }}
          onComparePhotos={undefined}
          onGenerateComparePdf={async () => {
            if (!orthoRedesignVM.treatment.treatmentPlanId) {
              toast.error(t("patients.ortho.noPlan"));
              return;
            }
            const url = `/api/orthodontics/treatment-plans/${orthoRedesignVM.treatment.treatmentPlanId}/comparison-pdf`;
            window.open(url, "_blank");
            toast.success(t("patients.ortho.generatingComparePdf"));
          }}
          onCollectNow={undefined}
        />
      )}
      {!orthoRedesignVM && orthoData && (
        <OrthodonticsClient
          patientId={orthoData.patientId}
          patientName={orthoData.patientName}
          isMinor={orthoData.isMinor}
          hasPediatricProfile={orthoData.hasPediatricProfile}
          guardianName={orthoData.guardianName}
          pediatricHabits={orthoData.pediatricHabits}
          pediatricsModuleActive={pediatricsModuleActive}
          diagnosis={orthoData.diagnosis}
          plan={orthoData.plan}
          phases={orthoData.phases}
          monthInTreatment={orthoData.monthInTreatment}
          paymentPlan={orthoData.paymentPlan}
          installments={orthoData.installments}
          photoSets={orthoData.photoSets}
          controls={orthoData.controls}
          digitalRecords={orthoData.digitalRecords}
          resolveFileUrl={resolveOrthoFileUrl}
          agreementPdfHref={
            orthoData.paymentPlan
              ? `/api/orthodontics/payment-plans/${orthoData.paymentPlan.id}/financial-agreement-pdf`
              : undefined
          }
        />
      )}
    </>
  );
}
