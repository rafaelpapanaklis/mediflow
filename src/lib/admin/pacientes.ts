/**
 * Nivel "PACIENTES" del admin (base de datos GLOBAL de personas).
 *
 * Una PERSONA = el conjunto de expedientes `Patient` (de una o varias clínicas)
 * + opcionalmente una `PatientAccount` (cuenta DaleControl) que comparten una
 * misma identidad. La identidad se calcula así, idéntica en lista y detalle:
 *   - 'e:' + lower(trim(email))                  si tiene email
 *   - 'p:' + últimos 10 dígitos del teléfono     si no hay email pero sí teléfono (≥10 dígitos)
 *   - 'id:' + Patient.id                         si no hay ni email ni teléfono (queda solo)
 *
 * Solo lectura, a nivel plataforma: cruza PII de TODAS las clínicas, por lo que
 * SOLO debe consumirse desde rutas /admin (el guard `isAdminAuthed` vive en el
 * layout de /admin). NO expone datos clínicos (SOAP/notas): solo identidad,
 * clínicas y citas (fecha/estado).
 *
 * Rendimiento: el agrupado por persona y la PAGINACIÓN se hacen en la BD (un
 * solo `$queryRaw` con GROUP BY + window count + LIMIT/OFFSET). El enriquecido
 * (citas y cuenta) usa un número CONSTANTE de queries acotadas a la página
 * actual (sin N+1). SIN cambios de schema: todo se computa al vuelo.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const APPT_DETAIL_CAP = 500;

// ───────────────────────── Tipos públicos ─────────────────────────

/** Fila de la lista /admin/pacientes (una por persona). */
export interface PacienteRow {
  id: string; // base64url(person_key) — identificador estable para la URL del detalle
  name: string;
  email: string | null;
  phone: string | null;
  hasAccount: boolean; // tiene cuenta DaleControl (registrada o vinculada)
  accountVerified: boolean; // email de la cuenta verificado
  clinicsCount: number;
  appointmentsCount: number;
  lastAppointment: string | null; // ISO
}

/** Página de resultados de la lista. */
export interface PacientesPage {
  rows: PacienteRow[];
  total: number; // total de personas que coinciden con la búsqueda
  page: number;
  pageSize: number;
  totalPages: number;
  search: string;
}

/** Clínica donde la persona tiene expediente/citas. */
export interface PacienteClinicBrief {
  id: string;
  name: string;
  slug: string | null;
  patientNumber: string | null; // folio(s) del expediente en esa clínica
  appointmentsCount: number;
  lastAppointment: string | null; // ISO
  firstSeen: string | null; // ISO — alta del expediente en esa clínica
}

/** Cita dentro del detalle (sin datos clínicos: solo clínica + fecha + estado). */
export interface PacienteAppointment {
  id: string;
  clinicId: string;
  clinicName: string;
  date: string; // ISO (startsAt)
  status: string; // AppointmentStatus
  type: string | null;
}

/** Estado de la cuenta DaleControl de la persona. */
export interface PacienteAccountInfo {
  hasAccount: boolean;
  verified: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string | null; // ISO
}

/** Detalle completo de /admin/pacientes/[id]. */
export interface PacienteDetalle {
  id: string; // base64url(person_key)
  name: string;
  email: string | null;
  phone: string | null;
  identityType: "email" | "phone" | "single"; // cómo se agrupó la identidad
  account: PacienteAccountInfo;
  clinicsCount: number;
  appointmentsCount: number;
  firstSeen: string | null; // ISO — alta más antigua entre sus expedientes
  lastAppointment: string | null; // ISO
  clinics: PacienteClinicBrief[];
  appointments: PacienteAppointment[];
  appointmentsTruncated: boolean; // true si hay más citas de las listadas (cap)
}

// ───────────────────────── Codificación de la clave ─────────────────────────

/** Codifica la person_key para la URL (oculta el PII crudo del path/logs). */
export function encodePersonKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

/** Decodifica la person_key desde el parámetro de ruta. */
export function decodePersonKey(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

// ───────────────────────── Lista paginada ─────────────────────────

// Forma cruda de cada persona devuelta por el GROUP BY en la BD.
interface RawPersonRow {
  person_key: string;
  name: string | null;
  email: string | null;
  email_norm: string | null;
  phone: string | null;
  first_seen: Date | null;
  clinic_count: number;
  patient_count: number;
  patient_ids: string[];
  total_count: number;
}

export async function getPacientesPage(
  opts: { search?: string; page?: number; pageSize?: number } = {},
): Promise<PacientesPage> {
  const search = (opts.search || "").trim();
  const pageSize =
    opts.pageSize && opts.pageSize > 0 ? Math.min(opts.pageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const page = opts.page && opts.page > 0 ? Math.floor(opts.page) : 1;
  const offset = (page - 1) * pageSize;

  const like = `%${search}%`;
  const digits = search.replace(/\D/g, "");
  const digitsLike = `%${digits}%`;

  // Búsqueda por nombre/email/teléfono sobre los valores ya agregados de la
  // persona. Parametrizado vía Prisma.sql (sin inyección).
  const searchClause = search
    ? Prisma.sql`WHERE (name ILIKE ${like} OR email ILIKE ${like}${
        digits ? Prisma.sql` OR phone_digits LIKE ${digitsLike}` : Prisma.empty
      })`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<RawPersonRow[]>(Prisma.sql`
    WITH ppl AS (
      SELECT
        CASE
          WHEN p.email IS NOT NULL AND btrim(p.email) <> ''
            THEN 'e:' || lower(btrim(p.email))
          WHEN length(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')) >= 10
            THEN 'p:' || right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10)
          ELSE 'id:' || p.id
        END AS person_key,
        p.id AS patient_id,
        p."clinicId" AS clinic_id,
        nullif(btrim(concat_ws(' ', p."firstName", p."lastName")), '') AS full_name,
        p.email AS email_raw,
        lower(btrim(p.email)) AS email_norm,
        p.phone AS phone_raw,
        regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') AS phone_digits_row,
        p."createdAt" AS created_at
      FROM patients p
      WHERE p."deletedAt" IS NULL
    ),
    grouped AS (
      SELECT
        person_key,
        (array_agg(full_name ORDER BY created_at DESC) FILTER (WHERE full_name IS NOT NULL))[1] AS name,
        (array_agg(email_raw ORDER BY created_at DESC) FILTER (WHERE email_raw IS NOT NULL))[1] AS email,
        max(email_norm) AS email_norm,
        (array_agg(phone_raw ORDER BY created_at DESC) FILTER (WHERE phone_raw IS NOT NULL))[1] AS phone,
        max(phone_digits_row) AS phone_digits,
        min(created_at) AS first_seen,
        count(DISTINCT clinic_id)::int AS clinic_count,
        count(DISTINCT patient_id)::int AS patient_count,
        array_agg(DISTINCT patient_id) AS patient_ids
      FROM ppl
      GROUP BY person_key
    )
    SELECT
      person_key, name, email, email_norm, phone, first_seen,
      clinic_count, patient_count, patient_ids,
      (count(*) OVER())::int AS total_count
    FROM grouped
    ${searchClause}
    ORDER BY first_seen DESC NULLS LAST, person_key ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  if (rows.length === 0) {
    return { rows: [], total: 0, page, pageSize, totalPages: 0, search };
  }

  // ── Enriquecido acotado a la página actual (sin N+1) ──
  const allIds: string[] = [];
  const keyByPatientId: Record<string, string> = {};
  const emailNormByKey: Record<string, string | null> = {};
  rows.forEach((r) => {
    emailNormByKey[r.person_key] = r.email_norm;
    (r.patient_ids || []).forEach((pid) => {
      allIds.push(pid);
      keyByPatientId[pid] = r.person_key;
    });
  });

  // Citas: un solo groupBy por patientId, doblado por persona.
  const apptCountByKey: Record<string, number> = {};
  const lastApptByKey: Record<string, Date> = {};
  if (allIds.length > 0) {
    const apptAgg = await prisma.appointment.groupBy({
      by: ["patientId"],
      where: { patientId: { in: allIds } },
      _count: { _all: true },
      _max: { startsAt: true },
    });
    apptAgg.forEach((a) => {
      const key = keyByPatientId[a.patientId];
      if (!key) return;
      apptCountByKey[key] = (apptCountByKey[key] || 0) + (a._count?._all || 0);
      const m = a._max?.startsAt || null;
      if (m && (!lastApptByKey[key] || m.getTime() > lastApptByKey[key].getTime())) {
        lastApptByKey[key] = m;
      }
    });
  }

  // Cuenta DaleControl: por vínculo explícito (PatientAccountLink)…
  const accountVerifiedByKey: Record<string, boolean> = {};
  if (allIds.length > 0) {
    const links = await prisma.patientAccountLink.findMany({
      where: { patientId: { in: allIds } },
      select: { patientId: true, account: { select: { emailVerified: true } } },
    });
    links.forEach((l) => {
      const key = keyByPatientId[l.patientId];
      if (!key) return;
      accountVerifiedByKey[key] = (accountVerifiedByKey[key] || false) || !!l.account?.emailVerified;
    });
  }

  // …y por coincidencia de email (cubre cuentas registradas aún sin vincular).
  const emailNorms = Array.from(
    new Set(Object.values(emailNormByKey).filter((e): e is string => !!e)),
  );
  if (emailNorms.length > 0) {
    const accts = await prisma.patientAccount.findMany({
      where: { email: { in: emailNorms } },
      select: { email: true, emailVerified: true },
    });
    const verifiedByEmail: Record<string, boolean> = {};
    accts.forEach((a) => {
      verifiedByEmail[a.email] = a.emailVerified;
    });
    rows.forEach((r) => {
      if (r.email_norm && r.email_norm in verifiedByEmail) {
        accountVerifiedByKey[r.person_key] =
          (accountVerifiedByKey[r.person_key] || false) || verifiedByEmail[r.email_norm];
      }
    });
  }

  const hasAccountKeys: Record<string, boolean> = {};
  Object.keys(accountVerifiedByKey).forEach((k) => {
    hasAccountKeys[k] = true;
  });

  const pacientes: PacienteRow[] = rows.map((r) => ({
    id: encodePersonKey(r.person_key),
    name: r.name || r.email || r.phone || "Sin nombre",
    email: r.email,
    phone: r.phone,
    hasAccount: !!hasAccountKeys[r.person_key],
    accountVerified: !!accountVerifiedByKey[r.person_key],
    clinicsCount: r.clinic_count,
    appointmentsCount: apptCountByKey[r.person_key] || 0,
    lastAppointment: lastApptByKey[r.person_key]
      ? lastApptByKey[r.person_key].toISOString()
      : null,
  }));

  const total = rows[0].total_count;
  return {
    rows: pacientes,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    search,
  };
}

// ───────────────────────── Detalle de una persona ─────────────────────────

export async function getPacienteDetalle(encoded: string): Promise<PacienteDetalle | null> {
  let key: string;
  try {
    key = decodePersonKey(encoded);
  } catch {
    return null;
  }
  if (!key) return null;

  // Resolver los Patient.id de esta persona reinvirtiendo la clave (misma
  // normalización que en la lista). Una micro-query para los ids; el resto, ya
  // acotado, con Prisma tipado.
  let patientIds: string[] = [];
  let identityType: "email" | "phone" | "single" = "single";

  if (key.startsWith("e:")) {
    identityType = "email";
    const emailNorm = key.slice(2);
    const idRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM patients
      WHERE "deletedAt" IS NULL AND lower(btrim(email)) = ${emailNorm}
    `);
    patientIds = idRows.map((r) => r.id);
  } else if (key.startsWith("p:")) {
    identityType = "phone";
    const phoneDigits = key.slice(2);
    const idRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM patients
      WHERE "deletedAt" IS NULL
        AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phoneDigits}
    `);
    patientIds = idRows.map((r) => r.id);
  } else if (key.startsWith("id:")) {
    identityType = "single";
    patientIds = [key.slice(3)];
  } else {
    return null;
  }

  if (patientIds.length === 0) return null;

  const patients = await prisma.patient.findMany({
    where: { id: { in: patientIds }, deletedAt: null },
    select: {
      id: true,
      clinicId: true,
      patientNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      clinic: { select: { id: true, name: true, slug: true } },
    },
  });
  if (patients.length === 0) return null;

  // Representativos: el expediente más reciente con dato no vacío.
  patients.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  const ids = patients.map((p) => p.id);

  const repNameRow = patients.find((p) => p.firstName || p.lastName);
  const repName = repNameRow
    ? `${repNameRow.firstName || ""} ${repNameRow.lastName || ""}`.trim()
    : "";
  const repEmail = patients.find((p) => p.email)?.email || null;
  const repPhone = patients.find((p) => p.phone)?.phone || null;

  // Citas: total real (count) + agregados por clínica (groupBy) + listado acotado.
  const apptCount = await prisma.appointment.count({ where: { patientId: { in: ids } } });

  const clinicAgg = await prisma.appointment.groupBy({
    by: ["clinicId"],
    where: { patientId: { in: ids } },
    _count: { _all: true },
    _max: { startsAt: true },
  });
  const clinicAggMap: Record<string, { count: number; last: Date | null }> = {};
  let lastAppointment: Date | null = null;
  clinicAgg.forEach((c) => {
    const last = c._max?.startsAt || null;
    clinicAggMap[c.clinicId] = { count: c._count?._all || 0, last };
    if (last && (!lastAppointment || last.getTime() > lastAppointment.getTime())) {
      lastAppointment = last;
    }
  });

  const apptRows = await prisma.appointment.findMany({
    where: { patientId: { in: ids } },
    orderBy: { startsAt: "desc" },
    take: APPT_DETAIL_CAP,
    select: { id: true, clinicId: true, startsAt: true, status: true, type: true },
  });

  // Mapa de nombre de clínica (desde los expedientes; completa los que falten).
  const clinicMap: Record<string, { name: string; slug: string | null }> = {};
  patients.forEach((p) => {
    if (p.clinic) clinicMap[p.clinic.id] = { name: p.clinic.name, slug: p.clinic.slug ?? null };
  });
  const missingClinicIds = Array.from(
    new Set(apptRows.map((a) => a.clinicId).filter((cid) => !clinicMap[cid])),
  );
  if (missingClinicIds.length > 0) {
    const extra = await prisma.clinic.findMany({
      where: { id: { in: missingClinicIds } },
      select: { id: true, name: true, slug: true },
    });
    extra.forEach((c) => {
      clinicMap[c.id] = { name: c.name, slug: c.slug ?? null };
    });
  }

  const appointments: PacienteAppointment[] = apptRows.map((a) => ({
    id: a.id,
    clinicId: a.clinicId,
    clinicName: clinicMap[a.clinicId]?.name || "—",
    date: a.startsAt.toISOString(),
    status: a.status,
    type: a.type ?? null,
  }));

  // Clínicas agrupadas por clinicId (puede haber 2 expedientes en la misma).
  const clinicGroups: Record<string, PacienteClinicBrief> = {};
  patients.forEach((p) => {
    const cid = p.clinicId;
    const created = p.createdAt ? p.createdAt.toISOString() : null;
    if (!clinicGroups[cid]) {
      clinicGroups[cid] = {
        id: cid,
        name: p.clinic?.name || clinicMap[cid]?.name || "—",
        slug: p.clinic?.slug ?? clinicMap[cid]?.slug ?? null,
        patientNumber: p.patientNumber || null,
        appointmentsCount: clinicAggMap[cid]?.count || 0,
        lastAppointment: clinicAggMap[cid]?.last ? clinicAggMap[cid].last!.toISOString() : null,
        firstSeen: created,
      };
    } else {
      const g = clinicGroups[cid];
      if (p.patientNumber && (!g.patientNumber || g.patientNumber.indexOf(p.patientNumber) < 0)) {
        g.patientNumber = g.patientNumber ? `${g.patientNumber}, ${p.patientNumber}` : p.patientNumber;
      }
      if (created && (!g.firstSeen || created < g.firstSeen)) g.firstSeen = created;
    }
  });
  const clinics = Object.keys(clinicGroups)
    .map((k) => clinicGroups[k])
    .sort((a, b) => (b.lastAppointment || "").localeCompare(a.lastAppointment || ""));

  // Cuenta DaleControl: vínculo explícito primero; si no, por email.
  const links = await prisma.patientAccountLink.findMany({
    where: { patientId: { in: ids } },
    select: {
      account: {
        select: { id: true, name: true, email: true, phone: true, emailVerified: true, createdAt: true },
      },
    },
  });
  let account = links.map((l) => l.account).find(Boolean) || null;
  if (!account && repEmail) {
    account = await prisma.patientAccount.findFirst({
      where: { email: repEmail.toLowerCase().trim() },
      select: { id: true, name: true, email: true, phone: true, emailVerified: true, createdAt: true },
    });
  }
  const accountInfo: PacienteAccountInfo = account
    ? {
        hasAccount: true,
        verified: account.emailVerified,
        name: account.name,
        email: account.email,
        phone: account.phone ?? null,
        createdAt: account.createdAt ? account.createdAt.toISOString() : null,
      }
    : { hasAccount: false, verified: false, name: null, email: null, phone: null, createdAt: null };

  let firstSeen: Date | null = null;
  patients.forEach((p) => {
    if (p.createdAt && (!firstSeen || p.createdAt.getTime() < firstSeen.getTime())) {
      firstSeen = p.createdAt;
    }
  });

  return {
    id: encoded,
    name: repName || repEmail || repPhone || "Sin nombre",
    email: repEmail,
    phone: repPhone,
    identityType,
    account: accountInfo,
    clinicsCount: clinics.length,
    appointmentsCount: apptCount,
    firstSeen: firstSeen ? (firstSeen as Date).toISOString() : null,
    lastAppointment: lastAppointment ? (lastAppointment as Date).toISOString() : null,
    clinics,
    appointments,
    appointmentsTruncated: apptCount > apptRows.length,
  };
}
