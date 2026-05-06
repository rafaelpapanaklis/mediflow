export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PatientDetailClient } from "./patient-detail-client";
import { PatientContextPanel } from "@/components/dashboard/patient-context";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";
import { canSeePediatrics, PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import { loadPediatricsData } from "@/lib/pediatrics/load-data";
import type { PediatricsTabData } from "@/components/patient-detail/pediatrics/PediatricsTab";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import type { ImplantFull } from "@/lib/types/implants";
import { PERIODONTICS_MODULE_KEY, ENDODONTICS_MODULE_KEY, ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { loadOrthoData, type OrthoTabData } from "@/lib/orthodontics/load-data";
import { loadPerioData, type PerioTabData } from "@/lib/periodontics/load-data";
import { loadEndoSoapPrefill } from "@/lib/endodontics/load-soap-prefill";
import { loadEndoToothSummaries } from "@/lib/helpers/loadEndoToothData";
import type { SoapPrefill, EndoToothSummary } from "@/lib/types/endodontics";
import { getActiveClinicModuleKeys } from "@/lib/clinical-shared/get-active-clinic-modules";

export default async function PatientDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const tz = user.clinic.timezone;

  const [patient, doctors] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: params.id, clinicId: user.clinicId },
      include: {
        primaryDoctor: { select: { id: true, firstName: true, lastName: true, color: true } },
        appointments: {
          orderBy: { startsAt: "desc" },
          take: 30,
          include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        },
        records: {
          orderBy: { visitDate: "desc" },
          take: 20,
          include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        },
        invoices: { include: { payments: true } },
        // FIX: fetch treatment plans for the Tratamientos tab
        treatments: {
          orderBy: { createdAt: "desc" },
          include: {
            doctor:   { select: { id: true, firstName: true, lastName: true, color: true } },
            sessions: { orderBy: { sessionNumber: "asc" } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where:  { clinicId: user.clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  if (!patient) notFound();

  const portalUrl = patient.portalToken
    ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/${patient.portalToken}`
    : null;

  // ── ClinicModule gating ──────────────────────────────────────────────────
  // Una sola lectura del marketplace: derivamos el set de specialty keys
  // activas (o todas, si la clínica está en trial vigente) y reusamos esa
  // lista para Pediatría / Periodoncia / prefill endo. Reemplaza tres
  // llamadas previas a canAccessModule() — mismo contrato, una query.
  const clinicModuleKeys = await getActiveClinicModuleKeys(user.clinicId);
  const isDental = user.clinic.category === "DENTAL";

  // Pediatría — predicado puro existente: categoría DENTAL|MEDICINE +
  // módulo activo + DOB + edad < cutoff (default 18, LGDNNA). Reportamos
  // por separado al cliente si la clínica tiene el módulo activo
  // (`pediatricsModuleActive`) para que el tab pueda mostrarse en estado
  // disabled cuando el admin lo contrató pero el paciente actual es adulto.
  const pediatricsModuleActive = clinicModuleKeys.includes(PEDIATRICS_MODULE_KEY);
  let pediatricsData: PediatricsTabData | null = null;
  if (
    canSeePediatrics({
      clinicCategory: user.clinic.category,
      clinicModules: clinicModuleKeys,
      patientDob: patient.dob,
    })
  ) {
    pediatricsData = await loadPediatricsData({
      clinicId: user.clinicId,
      patientId: patient.id,
    });
  }

  // Periodoncia — solo DENTAL con el módulo activo. Sin gate por edad
  // (aplica a adultos y adolescentes con dentición permanente).
  let perioData: PerioTabData | null = null;
  if (isDental && clinicModuleKeys.includes(PERIODONTICS_MODULE_KEY)) {
    perioData = await loadPerioData({
      clinicId: user.clinicId,
      patientId: patient.id,
    });
  }

  // Endodoncia — solo DENTAL con el módulo activo. Sin gate por edad.
  // Cargamos: (1) summaries de los 32 dientes para el odontograma miniatura
  // del tab, y (2) prefill SOAP para hidratar el editor cuando el paciente
  // tiene tratamiento o diagnóstico endodóntico activo. El cliente decide
  // qué mostrar — `endoSummaries === null` significa módulo inactivo y el
  // tab no se renderiza.
  let endoSummaries: EndoToothSummary[] | null = null;
  let endoSoapPrefill: SoapPrefill | null = null;
  if (isDental && clinicModuleKeys.includes(ENDODONTICS_MODULE_KEY)) {
    [endoSummaries, endoSoapPrefill] = await Promise.all([
      loadEndoToothSummaries({ clinicId: user.clinicId, patientId: patient.id }),
      loadEndoSoapPrefill({ clinicId: user.clinicId, patientId: patient.id }),
    ]);
  }

  // Implantes — solo DENTAL con el módulo activo. Sin gate por edad. La
  // tabla `implants` no tiene helper extraído todavía (el módulo lo
  // carga inline en /dashboard/specialties/implants/[patientId]/page.tsx);
  // replicamos los mismos includes para que ImplantsTab reciba la shape
  // ImplantFull que espera. null cuando módulo inactivo.
  let implants: ImplantFull[] | null = null;
  if (isDental && clinicModuleKeys.includes(IMPLANTS_MODULE_KEY)) {
    implants = (await prisma.implant.findMany({
      where: { patientId: patient.id, clinicId: user.clinicId },
      include: {
        surgicalRecord:  true,
        healingPhase:    true,
        secondStage:     true,
        prostheticPhase: true,
        complications:   { orderBy: { detectedAt: "desc" } },
        followUps:       { orderBy: { scheduledAt: "asc" } },
        consents:        { orderBy: { createdAt: "desc" } },
        passport:        true,
      },
      orderBy: { placedAt: "desc" },
    })) as unknown as ImplantFull[];
  }

  // Ortodoncia — solo DENTAL con el módulo activo. Sin gate por edad. El
  // helper loadOrthoData devuelve null cuando el paciente no existe o
  // está soft-deleted (caso ya descartado arriba via notFound), por eso
  // el null aquí solo refleja "módulo inactivo" para el cliente.
  let orthoData: OrthoTabData | null = null;
  if (isDental && clinicModuleKeys.includes(ORTHODONTICS_MODULE_KEY)) {
    orthoData = await loadOrthoData({
      clinicId: user.clinicId,
      patientId: patient.id,
    });
  }

  const totalPaid    = patient.invoices.reduce((s, i) => s + i.paid, 0);
  const totalBalance = patient.invoices.reduce((s, i) => s + i.balance, 0);
  const totalPlan    = patient.invoices.reduce((s, i) => s + i.total, 0);

  const lastVisit  = patient.appointments[0]?.startsAt?.toISOString() ?? null;
  const visitCount = patient.appointments.filter(a => a.status === "COMPLETED").length;

  // Serialize + override legacy strings derivados de startsAt/endsAt en clinic tz.
  const serializedAppts = patient.appointments.map(a => ({
    ...a,
    date:         dateISOInTz(a.startsAt, tz),
    startTime:    timeHHMMInTz(a.startsAt, tz),
    endTime:      timeHHMMInTz(a.endsAt, tz),
    durationMins: durationMinutes(a.startsAt, a.endsAt),
    startsAt:     a.startsAt.toISOString(),
    endsAt:       a.endsAt.toISOString(),
    createdAt:    a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    updatedAt:    a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
  }));

  const serializedRecords = patient.records.map(r => ({
    ...r,
    visitDate: r.visitDate instanceof Date ? r.visitDate.toISOString() : String(r.visitDate),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }));

  const serializedTreatments = patient.treatments.map(t => ({
    ...t,
    startDate:        t.startDate instanceof Date ? t.startDate.toISOString() : String(t.startDate),
    endDate:          t.endDate instanceof Date ? t.endDate.toISOString() : (t.endDate ?? null),
    nextExpectedDate: t.nextExpectedDate instanceof Date ? t.nextExpectedDate.toISOString() : (t.nextExpectedDate ?? null),
    lastFollowUpSent: t.lastFollowUpSent instanceof Date ? t.lastFollowUpSent.toISOString() : (t.lastFollowUpSent ?? null),
    createdAt:        t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    updatedAt:        t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
    sessions: t.sessions.map(s => ({
      ...s,
      completedAt: s.completedAt instanceof Date ? s.completedAt.toISOString() : (s.completedAt ?? null),
      createdAt:   s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    })),
  }));

  return (
    <div>
      <PatientContextPanel patient={{
        firstName:          patient.firstName,
        lastName:           patient.lastName,
        patientNumber:      patient.patientNumber,
        bloodType:          patient.bloodType,
        dob:                patient.dob?.toISOString() ?? null,
        gender:             patient.gender,
        allergies:          patient.allergies,
        chronicConditions:  patient.chronicConditions,
        currentMedications: patient.currentMedications,
        lastVisit,
        visitCount,
      }} />

      <ErrorBoundary fallbackTitle="Error al cargar detalle del paciente">
        <PatientDetailClient
          patient={patient as any}
          records={serializedRecords as any}
          appointments={serializedAppts as any}
          invoices={patient.invoices as any}
          treatments={serializedTreatments as any}
          doctors={doctors}
          currentUser={{
            id:                 user.id,
            firstName:          user.firstName,
            lastName:           user.lastName,
            cedulaProfesional:  user.cedulaProfesional ?? null,
          }}
          specialty={user.clinic.specialty}
          totalPaid={totalPaid}
          totalBalance={totalBalance}
          totalPlan={totalPlan}
          portalUrl={portalUrl}
          pediatricsData={pediatricsData}
          pediatricsModuleActive={pediatricsModuleActive}
          perioData={perioData}
          endoSummaries={endoSummaries}
          endoSoapPrefill={endoSoapPrefill}
          implants={implants}
          orthoData={orthoData}
        />
      </ErrorBoundary>
    </div>
  );
}
