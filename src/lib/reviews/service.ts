import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  REVIEW_PAGE_SIZE,
  REVIEW_STATUS,
  REVIEW_TOKEN_TTL_DAYS,
  REVIEW_MAX_COMMENT_CHARS,
  REVIEW_MAX_RESPONSE_CHARS,
  REVIEW_MAX_REPORT_REASON_CHARS,
  ReviewError,
  buildAuthorName,
  clampRating,
  roundAvg,
  type AdminReviewDTO,
  type ClinicReviewDTO,
  type ClinicReviewsResponse,
  type PublicReviewDTO,
  type PublicReviewsResponse,
  type AdminReviewsResponse,
  type PatientReviewItemDTO,
  type PatientReviewablesResponse,
  type ReviewInviteView,
  type ReviewStatus,
  type ReviewSummary,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Capa de datos de reseñas. TODO acceso a prisma.clinicReview vive aquí; las
// rutas solo hacen guard + parse + delegan. Multi-tenant: cada función de
// clínica recibe clinicId de la sesión y lo aplica en el where (nunca confía
// en ids del cliente). Texto se sanitiza a plano antes de persistir.
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY_DISTRIBUTION: ReviewSummary["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
// Caracteres de control ASCII (0x00–0x1F y 0x7F). Construido por código para
// no embeber bytes de control en el fuente.
const CONTROL_CHARS = new RegExp(`[\\u0000-\\u001F\\u007F]`, "g");

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Quita HTML/control chars, colapsa espacios, recorta y trunca. Texto plano. */
export function sanitizePlainText(input: unknown, max: number): string {
  return String(input ?? "")
    .replace(/<[^>]*>/g, " ") // sin etiquetas HTML
    .replace(CONTROL_CHARS, " ") // sin control chars (incluye saltos)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ── Agregados (sin N+1) ─────────────────────────────────────────────────────

/** Resumen (avg/count/distribución) de reseñas PUBLICADAS de una clínica. */
export async function getReviewSummary(clinicId: string): Promise<ReviewSummary> {
  const rows = await prisma.clinicReview.groupBy({
    by: ["rating"],
    where: { clinicId, status: REVIEW_STATUS.PUBLISHED, rating: { not: null } },
    _count: { _all: true },
  });
  return summaryFromGroups(rows);
}

function summaryFromGroups(rows: { rating: number | null; _count: { _all: number } }[]): ReviewSummary {
  const distribution = { ...EMPTY_DISTRIBUTION };
  let total = 0;
  let weighted = 0;
  for (const r of rows) {
    const star = r.rating;
    if (star == null || star < 1 || star > 5) continue;
    const n = r._count._all;
    distribution[star as 1 | 2 | 3 | 4 | 5] = n;
    total += n;
    weighted += star * n;
  }
  return { avg: total > 0 ? roundAvg(weighted / total) : 0, count: total, distribution };
}

/**
 * Ratings de MUCHAS clínicas en UNA query (para las cards del directorio).
 * Devuelve un Map clinicId → { avg, count }. Clínicas sin reseñas no aparecen.
 */
export async function getRatingsForClinics(
  clinicIds: string[],
): Promise<Map<string, { avg: number; count: number }>> {
  const map = new Map<string, { avg: number; count: number }>();
  const ids = clinicIds.filter(Boolean);
  if (ids.length === 0) return map;
  try {
    const rows = await prisma.clinicReview.groupBy({
      by: ["clinicId"],
      where: { clinicId: { in: ids }, status: REVIEW_STATUS.PUBLISHED, rating: { not: null } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    for (const r of rows) {
      map.set(r.clinicId, { avg: roundAvg(r._avg.rating ?? 0), count: r._count._all });
    }
  } catch (err) {
    // Si clinic_reviews aún no existe (sql/resenas.sql sin aplicar), NO rompemos
    // el directorio existente: ratings vacíos → cards sin estrellas hasta el SQL.
    console.error("[reviews] getRatingsForClinics — ¿tabla ausente?", err);
  }
  return map;
}

// ── Perfil público ──────────────────────────────────────────────────────────

function toPublicDTO(r: {
  id: string;
  authorName: string;
  rating: number | null;
  comment: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  response: string | null;
  respondedAt: Date | null;
}): PublicReviewDTO {
  return {
    id: r.id,
    authorName: r.authorName,
    rating: r.rating ?? 0,
    comment: r.comment,
    createdAt: (r.submittedAt ?? r.createdAt).toISOString(),
    response: r.response,
    respondedAt: toIso(r.respondedAt),
  };
}

/** Reseñas publicadas de una clínica, paginadas, + resumen. 2 queries. */
export async function getPublicReviews(
  clinicId: string,
  page = 1,
): Promise<PublicReviewsResponse> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const where = { clinicId, status: REVIEW_STATUS.PUBLISHED, rating: { not: null } };
  const [groups, rows] = await Promise.all([
    prisma.clinicReview.groupBy({
      by: ["rating"],
      where,
      _count: { _all: true },
    }),
    prisma.clinicReview.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      skip: (safePage - 1) * REVIEW_PAGE_SIZE,
      take: REVIEW_PAGE_SIZE,
      select: {
        id: true, authorName: true, rating: true, comment: true,
        createdAt: true, submittedAt: true, response: true, respondedAt: true,
      },
    }),
  ]);
  const summary = summaryFromGroups(groups);
  return {
    items: rows.map(toPublicDTO),
    page: safePage,
    pageSize: REVIEW_PAGE_SIZE,
    total: summary.count,
    totalPages: Math.max(1, Math.ceil(summary.count / REVIEW_PAGE_SIZE)),
    summary,
  };
}

/** Vista del link /resena/[token]: datos públicos de la clínica + estado. */
export async function getInviteView(token: string): Promise<ReviewInviteView> {
  const empty: ReviewInviteView = {
    clinicName: "la clínica", clinicSlug: "", logoUrl: null, themeColor: null,
    state: "invalid", doctorName: null, serviceName: null,
  };
  if (!token) return empty;

  const review = await prisma.clinicReview.findUnique({
    where: { token },
    select: { status: true, tokenExpiresAt: true, clinicId: true },
  });
  if (!review) return empty;

  const clinic = await prisma.clinic.findUnique({
    where: { id: review.clinicId },
    select: { name: true, slug: true, logoUrl: true, landingThemeColor: true },
  });
  const view: ReviewInviteView = {
    clinicName: clinic?.name ?? "la clínica",
    clinicSlug: clinic?.slug ?? "",
    logoUrl: clinic?.logoUrl ?? null,
    themeColor: clinic?.landingThemeColor ?? null,
    state: "ok",
    doctorName: null,
    serviceName: null,
  };
  if (review.status !== REVIEW_STATUS.PENDING) return { ...view, state: "submitted" };
  if (review.tokenExpiresAt.getTime() < Date.now()) return { ...view, state: "expired" };
  return view;
}

// ── Envío de la reseña (paciente, vía token) ────────────────────────────────

/**
 * Publica la reseña asociada a un token de invitación. Valida: token existe,
 * status pending, no expirado. Un solo uso (al publicar deja de ser pending).
 */
export async function submitReview(
  token: string,
  ratingInput: unknown,
  commentInput: unknown,
): Promise<{ ok: true; clinicSlug: string }> {
  const rating = clampRating(ratingInput);
  if (rating == null) throw new ReviewError("Selecciona una calificación de 1 a 5 estrellas.", 400);

  const invite = await prisma.clinicReview.findUnique({
    where: { token },
    select: { id: true, status: true, tokenExpiresAt: true, clinicId: true },
  });
  if (!invite) throw new ReviewError("Enlace de reseña no válido.", 404);
  if (invite.status !== REVIEW_STATUS.PENDING) {
    throw new ReviewError("Esta reseña ya fue enviada. ¡Gracias!", 409);
  }
  if (invite.tokenExpiresAt.getTime() < Date.now()) {
    throw new ReviewError("El enlace para dejar tu reseña expiró.", 410);
  }

  const comment = sanitizePlainText(commentInput, REVIEW_MAX_COMMENT_CHARS) || null;

  // updateMany con guarda de status: si dos requests corren a la vez, solo una
  // pasa de pending → published (count 0 en la perdedora).
  const res = await prisma.clinicReview.updateMany({
    where: { id: invite.id, status: REVIEW_STATUS.PENDING },
    data: {
      rating,
      comment,
      status: REVIEW_STATUS.PUBLISHED,
      submittedAt: new Date(),
    },
  });
  if (res.count === 0) throw new ReviewError("Esta reseña ya fue enviada. ¡Gracias!", 409);

  const clinic = await prisma.clinic.findUnique({
    where: { id: invite.clinicId },
    select: { slug: true },
  });
  return { ok: true, clinicSlug: clinic?.slug ?? "" };
}

/** Reportar una reseña como inapropiada (cualquier visitante). Idempotente. */
export async function reportReview(reviewId: string, reason?: unknown): Promise<{ ok: true }> {
  const review = await prisma.clinicReview.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true, reported: true },
  });
  // Solo se reportan reseñas publicadas. Silencioso si no aplica (no filtra info).
  if (!review || review.status !== REVIEW_STATUS.PUBLISHED || review.reported) {
    return { ok: true };
  }
  await prisma.clinicReview.update({
    where: { id: reviewId },
    data: {
      reported: true,
      reportedReason: sanitizePlainText(reason, REVIEW_MAX_REPORT_REASON_CHARS) || null,
      reportedAt: new Date(),
    },
  });
  return { ok: true };
}

// ── Panel de la clínica ──────────────────────────────────────────────────────

function toClinicDTO(r: {
  id: string; authorName: string; rating: number | null; comment: string | null;
  status: string; response: string | null; respondedAt: Date | null; reported: boolean;
  createdAt: Date; submittedAt: Date | null;
}): ClinicReviewDTO {
  return {
    id: r.id,
    authorName: r.authorName,
    rating: r.rating,
    comment: r.comment,
    status: r.status as ReviewStatus,
    response: r.response,
    respondedAt: toIso(r.respondedAt),
    reported: r.reported,
    createdAt: r.createdAt.toISOString(),
    submittedAt: toIso(r.submittedAt),
  };
}

/** Reseñas enviadas (published|hidden) de la clínica, paginadas, + resumen. */
export async function getClinicReviews(
  clinicId: string,
  page = 1,
): Promise<ClinicReviewsResponse> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const where = { clinicId, status: { in: [REVIEW_STATUS.PUBLISHED, REVIEW_STATUS.HIDDEN] } };
  const [total, rows, summary] = await Promise.all([
    prisma.clinicReview.count({ where }),
    prisma.clinicReview.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      skip: (safePage - 1) * REVIEW_PAGE_SIZE,
      take: REVIEW_PAGE_SIZE,
      select: {
        id: true, authorName: true, rating: true, comment: true, status: true,
        response: true, respondedAt: true, reported: true, createdAt: true, submittedAt: true,
      },
    }),
    getReviewSummary(clinicId),
  ]);
  return {
    items: rows.map(toClinicDTO),
    page: safePage,
    pageSize: REVIEW_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)),
    summary,
  };
}

/** La clínica responde a una de SUS reseñas (una sola respuesta). */
export async function respondToReview(
  clinicId: string,
  reviewId: string,
  responseInput: unknown,
  respondedById: string,
): Promise<ClinicReviewDTO> {
  const text = sanitizePlainText(responseInput, REVIEW_MAX_RESPONSE_CHARS);
  if (!text) throw new ReviewError("Escribe una respuesta.", 400);

  const review = await prisma.clinicReview.findFirst({
    where: { id: reviewId, clinicId }, // multi-tenant: debe ser de esta clínica
    select: { id: true, status: true },
  });
  if (!review) throw new ReviewError("Reseña no encontrada.", 404);
  if (review.status === REVIEW_STATUS.PENDING) {
    throw new ReviewError("Esta reseña aún no ha sido enviada por el paciente.", 409);
  }

  const updated = await prisma.clinicReview.update({
    where: { id: reviewId },
    data: { response: text, respondedAt: new Date(), respondedById },
    select: {
      id: true, authorName: true, rating: true, comment: true, status: true,
      response: true, respondedAt: true, reported: true, createdAt: true, submittedAt: true,
    },
  });
  return toClinicDTO(updated);
}

// ── Panel admin (moderación) ──────────────────────────────────────────────────

/** Lista reseñas para el admin. filter: "reported" (default) | "hidden" | "all". */
export async function adminListReviews(
  filter: "reported" | "hidden" | "all" = "reported",
  page = 1,
): Promise<AdminReviewsResponse> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const where =
    filter === "reported"
      ? { reported: true, status: { not: REVIEW_STATUS.PENDING } }
      : filter === "hidden"
        ? { status: REVIEW_STATUS.HIDDEN }
        : { status: { not: REVIEW_STATUS.PENDING } };

  const [total, rows] = await Promise.all([
    prisma.clinicReview.count({ where }),
    prisma.clinicReview.findMany({
      where,
      orderBy: [{ reported: "desc" }, { reportedAt: "desc" }, { createdAt: "desc" }],
      skip: (safePage - 1) * REVIEW_PAGE_SIZE,
      take: REVIEW_PAGE_SIZE,
      select: {
        id: true, clinicId: true, authorName: true, rating: true, comment: true, status: true,
        response: true, respondedAt: true, reported: true, reportedReason: true, reportedAt: true,
        createdAt: true, submittedAt: true,
      },
    }),
  ]);

  // Nombres/slug de clínica en UNA query (sin relación Prisma → join manual).
  const clinicIds = Array.from(new Set(rows.map((r) => r.clinicId)));
  const clinics = clinicIds.length
    ? await prisma.clinic.findMany({
        where: { id: { in: clinicIds } },
        select: { id: true, name: true, slug: true },
      })
    : [];
  const clinicMap = new Map(clinics.map((c) => [c.id, c]));

  const items: AdminReviewDTO[] = rows.map((r) => ({
    id: r.id,
    authorName: r.authorName,
    rating: r.rating,
    comment: r.comment,
    status: r.status as ReviewStatus,
    response: r.response,
    respondedAt: toIso(r.respondedAt),
    reported: r.reported,
    createdAt: r.createdAt.toISOString(),
    submittedAt: toIso(r.submittedAt),
    clinicId: r.clinicId,
    clinicName: clinicMap.get(r.clinicId)?.name ?? "—",
    clinicSlug: clinicMap.get(r.clinicId)?.slug ?? "",
    reportedReason: r.reportedReason,
    reportedAt: toIso(r.reportedAt),
  }));

  return {
    items,
    page: safePage,
    pageSize: REVIEW_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)),
  };
}

/** Admin oculta / re-publica una reseña; "hide" también limpia el flag reported. */
export async function adminModerateReview(
  reviewId: string,
  action: "hide" | "publish",
): Promise<{ ok: true }> {
  const review = await prisma.clinicReview.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true },
  });
  if (!review || review.status === REVIEW_STATUS.PENDING) {
    throw new ReviewError("Reseña no encontrada.", 404);
  }
  await prisma.clinicReview.update({
    where: { id: reviewId },
    data:
      action === "hide"
        ? { status: REVIEW_STATUS.HIDDEN }
        : { status: REVIEW_STATUS.PUBLISHED, reported: false, reportedReason: null, reportedAt: null },
  });
  return { ok: true };
}

// ── Portal del paciente: calificar visitas completadas (post-cita) ───────────
// El paciente autenticado deja su reseña desde /paciente sin necesitar el link
// por token. Reusa ClinicReview + la MISMA moderación (status published, el
// admin puede ocultar). Multi-tenant: SIEMPRE filtra por los patientId de la
// sesión (ctx.links); nunca confía en ids del cliente.

/** "Juan" + "Pérez García" → "Juan Pérez García" para mostrar al paciente. */
function doctorDisplayName(firstName?: string | null, lastName?: string | null): string {
  return `${(firstName ?? "").trim()} ${(lastName ?? "").trim()}`.replace(/\s+/g, " ").trim() || "tu doctor";
}

/**
 * Citas COMPLETED/CHECKED_OUT del paciente (de SUS expedientes vinculados),
 * separadas en `pending` (sin reseña enviada) y `done` (ya calificadas). Dos
 * queries (citas + reseñas por appointmentId), sin N+1.
 */
export async function getPatientReviewables(
  links: { patientId: string; clinicId: string }[],
): Promise<PatientReviewablesResponse> {
  const patientIds = Array.from(new Set(links.map((l) => l.patientId).filter(Boolean)));
  if (patientIds.length === 0) return { pending: [], done: [] };

  const appts = await prisma.appointment.findMany({
    where: { patientId: { in: patientIds }, status: { in: ["COMPLETED", "CHECKED_OUT"] } },
    orderBy: { startsAt: "desc" },
    take: 60,
    select: {
      id: true,
      clinicId: true,
      type: true,
      startsAt: true,
      doctor: { select: { firstName: true, lastName: true } },
      clinic: { select: { name: true, slug: true } },
    },
  });
  if (appts.length === 0) return { pending: [], done: [] };

  const reviews = await prisma.clinicReview.findMany({
    where: { appointmentId: { in: appts.map((a) => a.id) } },
    select: { appointmentId: true, rating: true, comment: true, status: true, submittedAt: true },
  });
  const byAppt = new Map(reviews.map((r) => [r.appointmentId, r]));

  const pending: PatientReviewItemDTO[] = [];
  const done: PatientReviewItemDTO[] = [];
  for (const a of appts) {
    const r = byAppt.get(a.id);
    // "Calificada" = enviada por el paciente (deja de ser pending y tiene fecha
    // de envío). Una invitación pending sin enviar sigue siendo "por calificar".
    const submitted = !!r && r.status !== REVIEW_STATUS.PENDING && r.submittedAt != null;
    const item: PatientReviewItemDTO = {
      appointmentId: a.id,
      clinicId: a.clinicId,
      clinicName: a.clinic?.name ?? "",
      clinicSlug: a.clinic?.slug ?? "",
      doctorName: doctorDisplayName(a.doctor?.firstName, a.doctor?.lastName),
      type: a.type,
      date: a.startsAt.toISOString(),
      rating: r?.rating ?? null,
      comment: r?.comment ?? null,
      status: (r?.status as ReviewStatus | undefined) ?? null,
    };
    (submitted ? done : pending).push(item);
  }
  return { pending, done };
}

/**
 * El paciente autenticado publica la reseña de UNA de sus citas completadas.
 *   · Si ya existe la invitación pending (creada al cerrar la cita) → la publica
 *     con guarda de status (pending → published), igual que el flujo por token.
 *   · Si no hay fila (p. ej. cita cerrada sin canal de contacto) → la crea ya
 *     publicada, generando token/tokenExpiresAt para respetar el NOT NULL del
 *     esquema (queda inerte: la reseña ya es published).
 * Verificada por construcción: solo cita COMPLETED/CHECKED_OUT de un patientId
 * de la sesión. Idempotente: appointmentId @unique + guardas → 1 reseña/cita.
 */
export async function submitPatientReview(
  links: { patientId: string; clinicId: string }[],
  appointmentIdInput: unknown,
  ratingInput: unknown,
  commentInput: unknown,
): Promise<{ ok: true; status: ReviewStatus }> {
  const appointmentId = typeof appointmentIdInput === "string" ? appointmentIdInput.trim() : "";
  if (!appointmentId) throw new ReviewError("Cita no válida.", 400);

  const rating = clampRating(ratingInput);
  if (rating == null) throw new ReviewError("Selecciona una calificación de 1 a 5 estrellas.", 400);

  const patientIds = Array.from(new Set(links.map((l) => l.patientId).filter(Boolean)));
  if (patientIds.length === 0) throw new ReviewError("Cita no encontrada.", 404);

  // Ownership + completada: la cita debe ser de un expediente del paciente
  // autenticado y estar cerrada. Esto es lo que "verifica" la reseña.
  const appt = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      patientId: { in: patientIds },
      status: { in: ["COMPLETED", "CHECKED_OUT"] },
    },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      patient: { select: { firstName: true, lastName: true } },
    },
  });
  if (!appt) throw new ReviewError("Cita no encontrada o aún no completada.", 404);

  const comment = sanitizePlainText(commentInput, REVIEW_MAX_COMMENT_CHARS) || null;

  const existing = await prisma.clinicReview.findUnique({
    where: { appointmentId: appt.id },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status !== REVIEW_STATUS.PENDING) {
      throw new ReviewError("Ya calificaste esta visita. ¡Gracias!", 409);
    }
    const res = await prisma.clinicReview.updateMany({
      where: { id: existing.id, status: REVIEW_STATUS.PENDING },
      data: { rating, comment, status: REVIEW_STATUS.PUBLISHED, submittedAt: new Date() },
    });
    if (res.count === 0) throw new ReviewError("Ya calificaste esta visita. ¡Gracias!", 409);
    return { ok: true, status: REVIEW_STATUS.PUBLISHED };
  }

  const token = crypto.randomBytes(24).toString("base64url");
  const tokenExpiresAt = new Date(Date.now() + REVIEW_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const authorName = buildAuthorName(appt.patient?.firstName ?? "", appt.patient?.lastName ?? "");
  try {
    await prisma.clinicReview.create({
      data: {
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        appointmentId: appt.id,
        authorName,
        rating,
        comment,
        status: REVIEW_STATUS.PUBLISHED,
        submittedAt: new Date(),
        token,
        tokenExpiresAt,
      },
    });
  } catch (e: unknown) {
    // Carrera con la invitación automática: la fila apareció entre el read y el
    // create (appointmentId @unique). Reintenta el flip pending → published.
    if ((e as { code?: string })?.code === "P2002") {
      const res = await prisma.clinicReview.updateMany({
        where: { appointmentId: appt.id, status: REVIEW_STATUS.PENDING },
        data: { rating, comment, status: REVIEW_STATUS.PUBLISHED, submittedAt: new Date() },
      });
      if (res.count === 0) throw new ReviewError("Ya calificaste esta visita. ¡Gracias!", 409);
      return { ok: true, status: REVIEW_STATUS.PUBLISHED };
    }
    throw e;
  }
  return { ok: true, status: REVIEW_STATUS.PUBLISHED };
}
