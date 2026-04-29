import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

export type TimelineEventType =
  | "soap"
  | "appointment"
  | "prescription"
  | "xray"
  | "treatment"
  | "referral"
  | "diagnosis";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  date: string;
  title: string;
  summary: string;
  doctorName: string | null;
  link?: string;
  /** Datos extra (ej. recordId para abrir modal SOAP, status, etc.) */
  meta?: Record<string, unknown>;
}

const ALL_TYPES: TimelineEventType[] = [
  "soap", "appointment", "prescription", "xray", "treatment", "referral", "diagnosis",
];

/**
 * GET /api/patients/[id]/timeline?from=&to=&types=
 *
 * Devuelve eventos clínicos del paciente ordenados desc por fecha. Agrega
 * SOAP notes, citas completadas, recetas, radiografías, tratamientos,
 * referrals y diagnósticos CIE-10 estructurados.
 *
 * Multi-tenant: validamos que patient.clinicId coincida con
 * getCurrentUser().clinicId antes de cargar nada. Todas las queries
 * filtran por clinicId directo o vía relation.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Validar que el paciente pertenece a la clínica del usuario.
  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const typesParam = sp.get("types");
  const requestedTypes: TimelineEventType[] = typesParam
    ? typesParam.split(",").map((t) => t.trim() as TimelineEventType).filter((t) => ALL_TYPES.includes(t))
    : ALL_TYPES;

  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  const dateGte = from ?? undefined;
  const dateLte = to ?? undefined;

  // Helper: agregar filtro de fechas a un where dado.
  function dateRange<F extends string>(field: F): Record<F, unknown> | Record<string, never> {
    if (!from && !to) return {};
    return { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } as Record<F, unknown>;
  }

  const wantSoap        = requestedTypes.includes("soap");
  const wantAppt        = requestedTypes.includes("appointment");
  const wantRx          = requestedTypes.includes("prescription");
  const wantXray        = requestedTypes.includes("xray");
  const wantTreatment   = requestedTypes.includes("treatment");
  const wantReferral    = requestedTypes.includes("referral");
  const wantDiagnosis   = requestedTypes.includes("diagnosis");

  // Promise.all con max 7 entidades (regla MediFlow).
  const [soapRows, apptRows, rxRows, xrayRows, treatmentRows, referralRows, dxRows] = await Promise.all([
    wantSoap ? prisma.medicalRecord.findMany({
      where: { clinicId: user.clinicId, patientId: params.id, ...dateRange<"visitDate">("visitDate") },
      select: {
        id: true, visitDate: true, subjective: true, assessment: true, plan: true,
        specialtyData: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { visitDate: "desc" },
    }) : Promise.resolve([]),
    wantAppt ? prisma.appointment.findMany({
      where: {
        clinicId: user.clinicId, patientId: params.id,
        status: { in: ["COMPLETED", "CHECKED_OUT"] },
        ...dateRange<"startsAt">("startsAt"),
      },
      select: {
        id: true, startsAt: true, type: true, status: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startsAt: "desc" },
    }) : Promise.resolve([]),
    wantRx ? prisma.prescription.findMany({
      where: { clinicId: user.clinicId, patientId: params.id, ...dateRange<"issuedAt">("issuedAt") },
      select: {
        id: true, issuedAt: true, qrCode: true, verifyUrl: true, cofeprisGroup: true,
        items: { select: { cums: { select: { descripcion: true } } } },
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { issuedAt: "desc" },
    }) : Promise.resolve([]),
    wantXray ? prisma.patientFile.findMany({
      // Coherente con la pestaña "Radiografías" (/api/xrays). Filtramos a
      // categorías XRAY_* para excluir fotos intraorales/consents/etc.
      // El xrayAnalysis (1:1 opcional) enriquece el summary cuando existe.
      where: {
        clinicId: user.clinicId,
        patientId: params.id,
        category: { in: ["XRAY_PERIAPICAL", "XRAY_PANORAMIC", "XRAY_BITEWING", "XRAY_OCCLUSAL"] },
        ...dateRange<"createdAt">("createdAt"),
      },
      select: {
        id: true, createdAt: true, name: true, category: true, toothNumber: true,
        xrayAnalysis: { select: { summary: true, severity: true } },
      },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
    wantTreatment ? prisma.treatmentPlan.findMany({
      where: { clinicId: user.clinicId, patientId: params.id, ...dateRange<"startDate">("startDate") },
      select: {
        id: true, startDate: true, name: true, status: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startDate: "desc" },
    }) : Promise.resolve([]),
    wantReferral ? prisma.referral.findMany({
      where: { clinicId: user.clinicId, patientId: params.id, ...dateRange<"sentAt">("sentAt") },
      select: {
        id: true, sentAt: true, type: true, status: true,
        toClinicName: true, toSpecialty: true, reason: true,
        fromDoctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { sentAt: "desc" },
    }) : Promise.resolve([]),
    wantDiagnosis ? prisma.medicalRecordDiagnosis.findMany({
      where: {
        medicalRecord: { clinicId: user.clinicId, patientId: params.id },
        ...dateRange<"createdAt">("createdAt"),
      },
      select: {
        id: true, createdAt: true, isPrimary: true, note: true,
        cie10: { select: { code: true, description: true } },
        medicalRecord: {
          select: { id: true, doctor: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
  ]);

  const events: TimelineEvent[] = [];

  for (const r of soapRows) {
    const subj = (r.subjective ?? "").trim();
    const summary = subj
      ? subj.split("\n")[0].slice(0, 140)
      : (r.assessment ?? r.plan ?? "Nota clínica sin contenido.").slice(0, 140);
    events.push({
      id: `soap-${r.id}`,
      type: "soap",
      date: r.visitDate.toISOString(),
      title: "Nota SOAP",
      summary,
      doctorName: r.doctor ? `Dr/a. ${r.doctor.firstName} ${r.doctor.lastName}` : null,
      meta: { recordId: r.id, specialtyType: (r.specialtyData as { type?: string } | null)?.type ?? null },
    });
  }

  for (const a of apptRows) {
    events.push({
      id: `appt-${a.id}`,
      type: "appointment",
      date: a.startsAt.toISOString(),
      title: "Cita completada",
      summary: a.type ?? "Consulta",
      doctorName: a.doctor ? `Dr/a. ${a.doctor.firstName} ${a.doctor.lastName}` : null,
      meta: { entityId: a.id, status: a.status },
    });
  }

  for (const rx of rxRows) {
    const firstMed = rx.items[0]?.cums.descripcion ?? "Receta";
    const more = rx.items.length > 1 ? ` +${rx.items.length - 1} más` : "";
    events.push({
      id: `rx-${rx.id}`,
      type: "prescription",
      date: rx.issuedAt.toISOString(),
      title: "Receta médica",
      summary: `${firstMed}${more}`,
      doctorName: rx.doctor ? `Dr/a. ${rx.doctor.firstName} ${rx.doctor.lastName}` : null,
      link: rx.verifyUrl || undefined,
      meta: { qrCode: rx.qrCode, cofeprisGroup: rx.cofeprisGroup, itemCount: rx.items.length },
    });
  }

  const CAT_LABEL: Record<string, string> = {
    XRAY_PERIAPICAL: "Periapical",
    XRAY_PANORAMIC: "Panorámica",
    XRAY_BITEWING: "Bitewing",
    XRAY_OCCLUSAL: "Oclusal",
  };
  for (const x of xrayRows) {
    const aiSummary = x.xrayAnalysis?.summary?.trim();
    const fallback = `${CAT_LABEL[x.category] ?? "Radiografía"}${x.toothNumber ? ` · pieza #${x.toothNumber}` : ""} · ${x.name}`;
    events.push({
      id: `xray-${x.id}`,
      type: "xray",
      date: x.createdAt.toISOString(),
      title: "Radiografía",
      summary: (aiSummary ?? fallback).slice(0, 140),
      doctorName: null,
      meta: { entityId: x.id, severity: x.xrayAnalysis?.severity ?? null, hasAnalysis: !!aiSummary },
    });
  }

  for (const t of treatmentRows) {
    events.push({
      id: `treat-${t.id}`,
      type: "treatment",
      date: t.startDate.toISOString(),
      title: "Plan de tratamiento",
      summary: t.name,
      doctorName: t.doctor ? `Dr/a. ${t.doctor.firstName} ${t.doctor.lastName}` : null,
      meta: { entityId: t.id, status: t.status },
    });
  }

  for (const r of referralRows) {
    const direction = r.type === "OUTGOING" ? "→" : "←";
    events.push({
      id: `ref-${r.id}`,
      type: "referral",
      date: r.sentAt.toISOString(),
      title: r.type === "OUTGOING" ? "Referencia enviada" : "Contrarreferencia recibida",
      summary: `${direction} ${r.toClinicName}${r.toSpecialty ? ` (${r.toSpecialty})` : ""} — ${r.reason.slice(0, 80)}`,
      doctorName: r.fromDoctor ? `Dr/a. ${r.fromDoctor.firstName} ${r.fromDoctor.lastName}` : null,
      meta: { entityId: r.id, status: r.status, type: r.type },
    });
  }

  for (const dx of dxRows) {
    events.push({
      id: `dx-${dx.id}`,
      type: "diagnosis",
      date: dx.createdAt.toISOString(),
      title: dx.isPrimary ? "Diagnóstico CIE-10 primario" : "Diagnóstico CIE-10",
      summary: `${dx.cie10.code} — ${dx.cie10.description}${dx.note ? ` · ${dx.note}` : ""}`,
      doctorName: dx.medicalRecord.doctor
        ? `Dr/a. ${dx.medicalRecord.doctor.firstName} ${dx.medicalRecord.doctor.lastName}`
        : null,
      meta: { recordId: dx.medicalRecord.id, isPrimary: dx.isPrimary, code: dx.cie10.code },
    });
  }

  events.sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({
    patientId: params.id,
    from: dateGte?.toISOString() ?? null,
    to: dateLte?.toISOString() ?? null,
    types: requestedTypes,
    count: events.length,
    events,
  });
}
