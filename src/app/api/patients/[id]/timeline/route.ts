import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { getVisiblePatientClinicIds, clinicScopeFilter, sharedRecordScope } from "@/lib/branches";

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

  // MULTI-CLÍNICA · FASE 2 — la historia se puede LEER desde una sede vinculada.
  // clinicalScope es el filtro ampliado que usan las fuentes CLÍNICAS de abajo;
  // con el flag apagado equivale a user.clinicId pelado.
  const visibleClinicIds = await getVisiblePatientClinicIds(user.clinicId);
  const clinicalScope = clinicScopeFilter(visibleClinicIds);

  // Validar que el paciente pertenece a la clínica del usuario Y que este usuario
  // puede verlo (visibilidad por paciente). Mismo 404. El assert scopea a
  // user.clinicId (= clinicalScope con el flag apagado) y cubre existencia, así que
  // sustituye al findFirst que traía main.
  const denied = await assertPatientVisible(params.id, {
    userId: user.id,
    role: user.role,
    clinicId: user.clinicId,
  });
  if (denied) return denied;

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

  // Paginación keyset. El cursor es `${ISOdate}__${eventId}` del último evento
  // de la página previa; over-fetchamos limit+1 por fuente y recortamos tras el
  // merge global. take/limit por defecto 40 (máx 100).
  const limitParam = parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 40;
  const cursorRaw = sp.get("cursor");
  let cursorDateIso = "";
  let cursorId = "";
  let cursorDate: Date | null = null;
  if (cursorRaw) {
    const sep = cursorRaw.indexOf("__");
    if (sep > 0) {
      cursorDateIso = cursorRaw.slice(0, sep);
      cursorId = cursorRaw.slice(sep + 2);
      const d = new Date(cursorDateIso);
      if (!Number.isNaN(d.getTime())) cursorDate = d;
    }
  }
  const useCursor = cursorDate !== null;
  // Límite superior efectivo de la query = min(to del usuario, fecha del cursor).
  const upper: Date | null =
    to && cursorDate ? (to.getTime() < cursorDate.getTime() ? to : cursorDate) : (to ?? cursorDate ?? null);

  // Helper: agregar filtro de fechas a un where dado (gte=from, lte=upper).
  function dateRange<F extends string>(field: F): Record<F, unknown> | Record<string, never> {
    if (!from && !upper) return {};
    return { [field]: { ...(from ? { gte: from } : {}), ...(upper ? { lte: upper } : {}) } } as Record<F, unknown>;
  }

  const wantSoap        = requestedTypes.includes("soap");
  const wantAppt        = requestedTypes.includes("appointment");
  const wantRx          = requestedTypes.includes("prescription");
  const wantXray        = requestedTypes.includes("xray");
  const wantTreatment   = requestedTypes.includes("treatment");
  const wantReferral    = requestedTypes.includes("referral");
  const wantDiagnosis   = requestedTypes.includes("diagnosis");

  // Promise.all con max 7 entidades (regla DaleControl).
  const [soapRows, apptRows, rxRows, xrayRows, treatmentRows, referralRows, dxRows] = await Promise.all([
    wantSoap ? prisma.medicalRecord.findMany({
      // sharedRecordScope (no clinicalScope pelado): de una sede AJENA nunca se
      // leen notas privadas de otro doctor. El timeline lo ven además los
      // RECEPTIONIST, así que aquí importa doblemente.
      where: { ...sharedRecordScope(user.clinicId, visibleClinicIds), patientId: params.id, ...dateRange<"visitDate">("visitDate") },
      select: {
        id: true, visitDate: true, subjective: true, assessment: true, plan: true,
        specialtyData: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { visitDate: "desc" },
      take: limit + 1,
    }) : Promise.resolve([]),
    wantAppt ? prisma.appointment.findMany({
      where: {
        // FASE 2: la AGENDA no se comparte — sólo las citas de la sede activa.
        clinicId: user.clinicId, patientId: params.id,
        // Incluir TODAS las citas excepto canceladas/no-show, para que el
        // historial muestre consultas previas (PENDING/SCHEDULED tambien
        // si ya pasaron, ademas de COMPLETED/CHECKED_OUT).
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        ...dateRange<"startsAt">("startsAt"),
      },
      select: {
        id: true, startsAt: true, type: true, status: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startsAt: "desc" },
      take: limit + 1,
    }) : Promise.resolve([]),
    wantRx ? prisma.prescription.findMany({
      where: { clinicId: clinicalScope, patientId: params.id, status: "ACTIVE", ...dateRange<"issuedAt">("issuedAt") },
      select: {
        id: true, issuedAt: true, qrCode: true, verifyUrl: true, cofeprisGroup: true,
        items: { select: { cums: { select: { descripcion: true } } } },
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { issuedAt: "desc" },
      take: limit + 1,
    }) : Promise.resolve([]),
    wantXray ? prisma.patientFile.findMany({
      // Coherente con la pestaña "Radiografías" (/api/xrays). Filtramos a
      // categorías XRAY_* para excluir fotos intraorales/consents/etc.
      // El xrayAnalysis (1:1 opcional) enriquece el summary cuando existe.
      where: {
        clinicId: clinicalScope,
        patientId: params.id,
        deletedAt: null,
        category: { in: ["XRAY_PERIAPICAL", "XRAY_PANORAMIC", "XRAY_BITEWING", "XRAY_OCCLUSAL"] },
        ...dateRange<"createdAt">("createdAt"),
      },
      select: {
        id: true, createdAt: true, name: true, category: true, toothNumber: true,
        xrayAnalysis: { select: { summary: true, severity: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    }) : Promise.resolve([]),
    wantTreatment ? prisma.treatmentPlan.findMany({
      // FASE 2: los planes de tratamiento llevan costo → sede activa.
      where: { clinicId: user.clinicId, patientId: params.id, ...dateRange<"startDate">("startDate") },
      select: {
        id: true, startDate: true, name: true, status: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startDate: "desc" },
      take: limit + 1,
    }) : Promise.resolve([]),
    wantReferral ? prisma.referral.findMany({
      where: { clinicId: clinicalScope, patientId: params.id, ...dateRange<"sentAt">("sentAt") },
      select: {
        id: true, sentAt: true, type: true, status: true,
        toClinicName: true, toSpecialty: true, reason: true,
        fromDoctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { sentAt: "desc" },
      take: limit + 1,
    }) : Promise.resolve([]),
    wantDiagnosis ? prisma.medicalRecordDiagnosis.findMany({
      where: {
        medicalRecord: { clinicId: clinicalScope, patientId: params.id },
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
      take: limit + 1,
    }) : Promise.resolve([]),
  ]);

  const events: TimelineEvent[] = [];

  for (const r of soapRows) {
    const subj = (r.subjective ?? "").trim();
    const summary = subj
      ? subj.split("\n")[0].slice(0, 140)
      : (r.assessment ?? r.plan ?? "Nota clínica sin contenido.").slice(0, 140);
    // Un medicalRecord con specialtyData.type es una CONSULTA (Nueva consulta /
    // Historial de consultas), NO una nota SOAP. Etiquetar acorde.
    const specialtyType = (r.specialtyData as { type?: string } | null)?.type ?? null;
    events.push({
      id: `soap-${r.id}`,
      type: "soap",
      date: r.visitDate.toISOString(),
      title: specialtyType ? "Consulta" : "Nota SOAP",
      summary,
      doctorName: r.doctor ? `Dr/a. ${r.doctor.firstName} ${r.doctor.lastName}` : null,
      meta: { recordId: r.id, specialtyType },
    });
  }

  const APPT_STATUS_LABEL: Record<string, string> = {
    COMPLETED: "completada",
    CHECKED_OUT: "completada",
    IN_PROGRESS: "en curso",
    IN_CHAIR: "en consultorio",
    CHECKED_IN: "registrada",
    CONFIRMED: "confirmada",
    SCHEDULED: "agendada",
    PENDING: "pendiente",
  };
  for (const a of apptRows) {
    const statusLabel = APPT_STATUS_LABEL[a.status] ?? a.status.toLowerCase();
    events.push({
      id: `appt-${a.id}`,
      type: "appointment",
      date: a.startsAt.toISOString(),
      title: `Cita ${statusLabel}`,
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

  // Orden total estable desc (fecha, luego id) para un cursor determinista.
  events.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  // Keyset: descarta lo ya mostrado (>= cursor en el orden desc) y recorta a
  // limit. nextCursor=null cuando no hay más páginas.
  const fresh = useCursor
    ? events.filter((e) => e.date < cursorDateIso || (e.date === cursorDateIso && e.id < cursorId))
    : events;
  const hasMore = fresh.length > limit;
  const page = hasMore ? fresh.slice(0, limit) : fresh;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.date}__${last.id}` : null;

  return NextResponse.json({
    patientId: params.id,
    from: dateGte?.toISOString() ?? null,
    to: dateLte?.toISOString() ?? null,
    types: requestedTypes,
    count: page.length,
    events: page,
    nextCursor,
  });
}
