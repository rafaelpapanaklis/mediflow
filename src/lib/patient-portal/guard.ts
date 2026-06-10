// Guard server-side del portal del paciente. Implementa A1.
// Lee la cookie `patient_session` via cookies() de next/headers, valida la
// sesión en DB (sha256(token), expiresAt > ahora) y devuelve el contexto.
// Lo usan: el layout de /paciente/(panel), TODOS los /api/paciente/* y el
// endpoint público de booking (/api/public/book) para auto-vincular.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PATIENT_SESSION_COOKIE, type PatientPortalContext } from "./types";
import { sha256 } from "./crypto";

/**
 * Devuelve el contexto de la sesión del paciente o null si no hay sesión
 * válida. NUNCA lanza. Carga account (id, name, email, phone) + links
 * (patientId, clinicId) — los links son la fuente de verdad multi-tenant.
 */
export async function getPatientPortalContext(): Promise<PatientPortalContext | null> {
  try {
    const token = cookies().get(PATIENT_SESSION_COOKIE)?.value;
    if (!token) return null;

    const tokenHash = sha256(token);
    const session = await prisma.patientAccountSession.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        account: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            links: { select: { patientId: true, clinicId: true } },
          },
        },
      },
    });

    if (!session) return null;

    if (session.expiresAt.getTime() <= Date.now()) {
      // Sesión expirada: limpieza best-effort de la fila.
      try {
        await prisma.patientAccountSession.deleteMany({ where: { tokenHash } });
      } catch {
        /* best-effort */
      }
      return null;
    }

    const { links, ...account } = session.account;
    return { account, links };
  } catch (err) {
    console.error("[paciente/guard] getPatientPortalContext error:", err);
    return null;
  }
}

/** Respuesta 401 estándar del portal. */
export function pacienteUnauthorized(): NextResponse {
  return NextResponse.json({ error: "No autenticado" }, { status: 401 });
}
