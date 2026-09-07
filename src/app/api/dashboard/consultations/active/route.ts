import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible, type VisibilityViewer } from "@/lib/patient-visibility";

export const dynamic = "force-dynamic";

/**
 * GET/POST/DELETE /api/dashboard/consultations/active — la consulta que el
 * usuario tiene abierta ahora mismo.
 *
 * POR QUÉ EXISTE (hallazgo 26). `active-consult-provider.tsx` lleva desde
 * siempre llamando a esta ruta, y la ruta NO existía: bajo
 * `src/app/api/dashboard/` solo había activity, chat-unread, home/*, route.ts,
 * search y sidebar-counts. O sea que "Iniciar consulta" hacía 404 SIEMPRE, y
 * con él la barra de contexto del paciente, el aviso del sidebar, el de la
 * topbar, la paleta de comandos y el modal de cierre. Quitar la funcionalidad
 * habría obligado a tocar esos seis componentes, que son de otras casillas;
 * crear la ruta la deja funcionando y no toca a nadie más.
 *
 * DÓNDE VIVE EL ESTADO: en dos cookies, no en la base. Una consulta activa es
 * estado de INTERFAZ del usuario (qué paciente tengo delante y desde cuándo),
 * no un acto clínico: el acto clínico es la nota SOAP y la cita, que ya tienen
 * sus tablas. Así no hace falta migración ni SQL.
 *
 *   · `activeConsultId`    — legible por JS, porque el provider la mira antes
 *     de pedir nada (evita un fetch en cada montaje del panel). Solo lleva un
 *     id aleatorio: ni nombre, ni expediente, ni PHI.
 *   · `activeConsultState` — httpOnly. Lleva `{id, patientId, startedAt}`.
 *
 * NO va firmada, y no hace falta: en cada lectura se vuelve a resolver el
 * paciente contra `clinicId` de la SESIÓN y contra `assertPatientVisible`. Una
 * cookie forjada con el paciente de otra clínica no devuelve nada; una forjada
 * con un paciente que este usuario ya puede ver no le da nada que no tuviera.
 * Al cambiar de sede, la cookie vieja deja de resolver y se limpia sola.
 */

const ID_COOKIE = "activeConsultId";
const STATE_COOKIE = "activeConsultState";
/** Una jornada larga. Pasada, la cookie caduca y la consulta se da por cerrada. */
const MAX_AGE_SECONDS = 60 * 60 * 12;

interface StoredConsult {
  id: string;
  patientId: string;
  startedAt: string;
}

function readStored(): StoredConsult | null {
  try {
    const raw = cookies().get(STATE_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsult>;
    if (!parsed?.id || !parsed?.patientId || !parsed?.startedAt) return null;
    return { id: parsed.id, patientId: parsed.patientId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

function writeCookies(res: NextResponse, stored: StoredConsult) {
  const base = {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: MAX_AGE_SECONDS,
  };
  res.cookies.set(STATE_COOKIE, JSON.stringify(stored), { ...base, httpOnly: true });
  res.cookies.set(ID_COOKIE, stored.id, { ...base, httpOnly: false });
}

function clearCookies(res: NextResponse) {
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(ID_COOKIE, "", { path: "/", maxAge: 0 });
}

function computeAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

function mapGender(g: string | null | undefined): "F" | "M" | "O" | undefined {
  if (!g) return undefined;
  const u = g.toUpperCase();
  if (u === "F" || u === "FEMALE" || u === "FEMENINO") return "F";
  if (u === "M" || u === "MALE" || u === "MASCULINO") return "M";
  return "O";
}

function cleanArray(arr: string[] | null | undefined): string[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  const out = arr.map((s) => s.trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

/**
 * Resuelve la cookie a la forma que consume el provider. Devuelve null cuando
 * el paciente ya no pertenece a la clínica activa o el usuario dejó de poder
 * verlo — es lo que hace que un cambio de sede no arrastre la consulta.
 *
 * Mismas claves de paciente y misma derivación (edad, sexo, alertas) que
 * src/app/api/dashboard/home/doctor/route.ts, para que la barra de contexto
 * pinte lo mismo que el hero del inicio.
 */
async function hydrate(stored: StoredConsult, viewer: VisibilityViewer) {
  const visDenied = await assertPatientVisible(stored.patientId, viewer);
  if (visDenied) return null;

  const patient = await prisma.patient.findFirst({
    where: { id: stored.patientId, clinicId: viewer.clinicId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
      gender: true,
      allergies: true,
      currentMedications: true,
      chronicConditions: true,
    },
  });
  if (!patient) return null;

  return {
    id: stored.id,
    patientId: patient.id,
    patientName: [patient.firstName, patient.lastName].filter(Boolean).join(" ").trim(),
    patientAge: patient.dob ? computeAge(patient.dob) : undefined,
    patientGender: mapGender(patient.gender),
    patientAlerts: {
      allergies: cleanArray(patient.allergies),
      medications: cleanArray(patient.currentMedications),
      conditions: cleanArray(patient.chronicConditions),
    },
    startedAt: stored.startedAt,
  };
}

/** El expediente que se lee aquí trae alergias y medicación: es PHI. */
async function requireViewer(): Promise<{
  error: NextResponse | null;
  viewer: VisibilityViewer | null;
}> {
  const ctx = await getAuthContext();
  if (!ctx?.user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }), viewer: null };
  }
  const denied = denyIfMissingPermission(ctx.user, "patients.view");
  if (denied) return { error: denied, viewer: null };
  return {
    error: null,
    viewer: { userId: ctx.user.id, role: ctx.user.role, clinicId: ctx.user.clinicId },
  };
}

export async function GET() {
  const auth = await requireViewer();
  if (auth.error) return auth.error;

  const stored = readStored();
  if (!stored) return NextResponse.json({ consult: null });

  const consult = await hydrate(stored, auth.viewer);
  if (!consult) {
    // Cookie huérfana (cambio de sede, paciente archivado, acceso retirado):
    // se limpia para que el provider no vuelva a pedirla en cada montaje.
    const res = NextResponse.json({ consult: null });
    clearCookies(res);
    return res;
  }
  return NextResponse.json({ consult });
}

export async function POST(req: NextRequest) {
  const auth = await requireViewer();
  if (auth.error) return auth.error;
  const viewer = auth.viewer;

  const body = (await req.json().catch(() => null)) as { patientId?: unknown } | null;
  const patientId = typeof body?.patientId === "string" ? body.patientId.trim() : "";
  if (!patientId) {
    return NextResponse.json({ error: "patientId_required" }, { status: 400 });
  }

  // Ya hay una consulta abierta con OTRO paciente → 409 con la consulta viva,
  // que es exactamente lo que el provider espera para repintar la barra.
  const stored = readStored();
  if (stored && stored.patientId !== patientId) {
    const current = await hydrate(stored, viewer);
    if (current) {
      return NextResponse.json({ consult: current }, { status: 409 });
    }
  }

  // Mismo paciente → idempotente: se conserva startedAt para no reiniciar el
  // cronómetro si el doctor vuelve a pulsar "Iniciar consulta".
  const next: StoredConsult = {
    id: stored?.patientId === patientId ? stored.id : crypto.randomUUID(),
    patientId,
    startedAt: stored?.patientId === patientId ? stored.startedAt : new Date().toISOString(),
  };

  const consult = await hydrate(next, viewer);
  if (!consult) {
    // 404 uniforme (no distingue "no existe" de "no puedes verlo"), igual que
    // el resto de asserts de visibilidad.
    return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  }

  const res = NextResponse.json({ consult });
  writeCookies(res, next);
  return res;
}

export async function DELETE() {
  const auth = await requireViewer();
  if (auth.error) return auth.error;

  const res = NextResponse.json({ ok: true });
  clearCookies(res);
  return res;
}
