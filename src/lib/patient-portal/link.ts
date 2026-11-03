// Vinculación cuenta ↔ Patient. Implementa A3.
//
// REGLA DE SEGURIDAD (robo de expediente): NUNCA vincular por teléfono solo.
// Solo se vincula: (a) por email VERIFICADO idéntico, o (b) el Patient que la
// propia sesión crea al reservar.
import { prisma } from "@/lib/prisma";
import { nextPatientNumber, withPatientNumberRetry } from "@/lib/patients/next-patient-number";

/**
 * Auto-vincula todos los Patient (no borrados) cuyo email coincida exacto
 * (case-insensitive) con el email YA VERIFICADO de la cuenta. Se llama al
 * verificar el email y en cada login (por si aparecieron expedientes nuevos).
 * Idempotente (skipDuplicates). Devuelve cuántos vínculos nuevos creó.
 */
export async function autoLinkPatientsByEmail(
  accountId: string,
  verifiedEmail: string,
): Promise<number> {
  try {
    const patients = await prisma.patient.findMany({
      where: {
        email: { equals: verifiedEmail, mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true, clinicId: true },
    });
    if (patients.length === 0) return 0;

    const result = await prisma.patientAccountLink.createMany({
      data: patients.map((p) => ({
        accountId,
        patientId: p.id,
        clinicId: p.clinicId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  } catch (err) {
    // Best-effort: el auto-link nunca debe romper verify/login.
    console.error("[patient-portal/link] autoLinkPatientsByEmail failed:", err);
    return 0;
  }
}

/**
 * Crea el link cuenta↔paciente ignorando duplicados (P2002): idempotente
 * ante carreras entre verify/login/booking simultáneos.
 */
async function createLinkIgnoringDuplicate(
  accountId: string,
  patientId: string,
  clinicId: string,
): Promise<void> {
  try {
    await prisma.patientAccountLink.create({
      data: { accountId, patientId, clinicId },
    });
  } catch (err: any) {
    if (err && err.code === "P2002") return; // ya existía — OK
    throw err;
  }
}

export interface ResolveBookingPatientArgs {
  accountId: string;
  /** Email de la cuenta (ya verificado — solo cuentas verificadas tienen sesión). */
  accountEmail: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  phone: string; // ya limpio (solo dígitos)
  email?: string | null; // email del form (opcional)
  primaryDoctorId?: string | null;
}

/**
 * Resuelve el Patient a usar en una reserva con sesión iniciada:
 *  1. Si la cuenta ya tiene link en esa clínica → usa ese Patient.
 *  2. Si existe Patient en la clínica con email == accountEmail (insensitive,
 *     no borrado) → vincula y úsalo.
 *  3. Si no → CREA Patient nuevo (patientNumber con el mismo row-lock de
 *     /api/public/book: SELECT 1 FROM clinics WHERE id=$ FOR UPDATE dentro de
 *     una transacción corta) con email = accountEmail, y vincula.
 * PROHIBIDO: adoptar un Patient encontrado solo por teléfono (robo de expediente).
 */
export async function resolveBookingPatient(
  args: ResolveBookingPatientArgs,
): Promise<{ patientId: string; created: boolean }> {
  const { accountId, accountEmail, clinicId, firstName, lastName, phone, primaryDoctorId } = args;

  // 1. Link existente de la cuenta en esa clínica (validando que el Patient siga vivo).
  //    nº7 (auditoría «cloudflare»): un enlace cuyo expediente ya no tiene el
  //    email de la cuenta no cuenta (la clínica le cambió el email al paciente).
  //    El email se compara con `mismoEmailDePortal` (sin mayúsculas NI espacios),
  //    el mismo criterio que el guard (revisión t12, dm2): con un `equals` en SQL,
  //    un paciente importado con «ana@x.com » no encontraba su enlace y la reserva
  //    le creaba un expediente duplicado.
  const enlaces = await prisma.patientAccountLink.findMany({
    where: { accountId, clinicId },
    orderBy: { createdAt: "asc" },
    select: { patientId: true, patient: { select: { deletedAt: true, email: true } } },
  });
  const existingLink = enlaces.find(
    (l) => l.patient && !l.patient.deletedAt && mismoEmailDePortal(l.patient.email, accountEmail),
  );
  if (existingLink) {
    return { patientId: existingLink.patientId, created: false };
  }

  // 2. Patient existente en la clínica con el email VERIFICADO de la cuenta.
  //    (NUNCA buscar por teléfono: permitiría adoptar el expediente de otro.)
  //    El `contains` solo pre-filtra (el email guardado puede traer espacios);
  //    decide `mismoEmailDePortal`, igual que en el paso 1.
  const candidatos = await prisma.patient.findMany({
    where: {
      clinicId,
      email: { contains: accountEmail.trim(), mode: "insensitive" },
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
    take: 20,
  });
  const byEmail = candidatos.find((p) => mismoEmailDePortal(p.email, accountEmail));
  if (byEmail) {
    await createLinkIgnoringDuplicate(accountId, byEmail.id, clinicId);
    return { patientId: byEmail.id, created: false };
  }

  // 3. Crear Patient nuevo. Transacción CORTA con el mismo row-lock y formato
  //    de patientNumber que /api/public/book (serializa creates por clínica).
  // El retry envuelve al $transaction (no al revés): una tx abortada por P2002
  // ya no admite queries, así que cada intento abre transacción nueva.
  const patient = await withPatientNumberRetry(() => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM clinics WHERE id = ${clinicId} FOR UPDATE`;
    const patientNumber = await nextPatientNumber(clinicId, tx);
    return tx.patient.create({
      data: {
        clinicId,
        patientNumber,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        email: accountEmail,
        primaryDoctorId: primaryDoctorId ?? null,
      },
    });
  }));

  await createLinkIgnoringDuplicate(accountId, patient.id, clinicId);
  return { patientId: patient.id, created: true };
}

/** Mismo criterio de igualdad que el auto-link: sin mayúsculas ni espacios. */
export function mismoEmailDePortal(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  return x !== "" && x === (b ?? "").trim().toLowerCase();
}

/**
 * Seguridad (auditoría «cloudflare», nº7): un enlace cuenta↔expediente solo se
 * justifica porque el email de la cuenta ERA el del paciente. Cuando la clínica
 * cambia o corrige el email del paciente (editar la ficha, rectificación ARCO),
 * se borran los enlaces de las cuentas cuyo email ya no es el del paciente.
 * Antes no se revocaban nunca: quien tuvo acceso con un email equivocado seguía
 * viendo recetas, documentos e historial después de la corrección.
 *
 * `db` puede ser la transacción del update (así se borra en el mismo paso).
 * Devuelve cuántos enlaces borró.
 */
export async function revocarEnlacesDeOtroEmail(args: { patientId: string; clinicId: string }, db: any = prisma): Promise<number> {
  const { patientId, clinicId } = args;
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  const paciente = await db.patient.findFirst({ where: { id: patientId, clinicId }, select: { email: true } });
  if (!paciente) return 0;
  const enlaces: Array<{ id: string; account: { email: string } | null }> = await db.patientAccountLink.findMany({
    where: { patientId, clinicId },
    select: { id: true, account: { select: { email: true } } },
  });
  const sobran = enlaces.filter((l) => !mismoEmailDePortal(l.account?.email, paciente.email)).map((l) => l.id);
  if (sobran.length === 0) return 0;
  const r = await db.patientAccountLink.deleteMany({ where: { id: { in: sobran }, patientId, clinicId } });
  return r.count;
}
