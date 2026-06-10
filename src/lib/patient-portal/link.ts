// Vinculación cuenta ↔ Patient. Implementa A3.
//
// REGLA DE SEGURIDAD (robo de expediente): NUNCA vincular por teléfono solo.
// Solo se vincula: (a) por email VERIFICADO idéntico, o (b) el Patient que la
// propia sesión crea al reservar.
import { prisma } from "@/lib/prisma";

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
  const existingLink = await prisma.patientAccountLink.findFirst({
    where: { accountId, clinicId },
    orderBy: { createdAt: "asc" },
    select: { patientId: true, patient: { select: { deletedAt: true } } },
  });
  if (existingLink && existingLink.patient && !existingLink.patient.deletedAt) {
    return { patientId: existingLink.patientId, created: false };
  }

  // 2. Patient existente en la clínica con el email VERIFICADO de la cuenta.
  //    (NUNCA buscar por teléfono: permitiría adoptar el expediente de otro.)
  const byEmail = await prisma.patient.findFirst({
    where: {
      clinicId,
      email: { equals: accountEmail, mode: "insensitive" },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (byEmail) {
    await createLinkIgnoringDuplicate(accountId, byEmail.id, clinicId);
    return { patientId: byEmail.id, created: false };
  }

  // 3. Crear Patient nuevo. Transacción CORTA con el mismo row-lock y formato
  //    de patientNumber que /api/public/book (serializa creates por clínica).
  const patient = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM clinics WHERE id = ${clinicId} FOR UPDATE`;
    const count = await tx.patient.count({ where: { clinicId } });
    const patientNumber = `P${String(count + 1).padStart(4, "0")}`;
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
  });

  await createLinkIgnoringDuplicate(accountId, patient.id, clinicId);
  return { patientId: patient.id, created: true };
}
