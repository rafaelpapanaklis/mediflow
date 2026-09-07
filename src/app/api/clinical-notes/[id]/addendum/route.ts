import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

/**
 * POST /api/clinical-notes/[id]/addendum — ADENDA a una nota firmada.
 *
 * POR QUÉ EXISTE (hallazgo 25). El PATCH de al lado rechaza toda edición de una
 * nota SIGNED, y hace bien: la NOM-024 exige que una nota firmada sea
 * inalterable. Pero el doctor que se dio cuenta de que anotó la pieza
 * equivocada necesita ALGÚN camino, y el que la norma sí contempla no es
 * reescribir: es añadir una nota de corrección fechada y firmada aparte, que
 * queda junto a la original sin tocarla.
 *
 * QUÉ SE ESCRIBE Y QUÉ NO. Esta ruta solo puede EMPUJAR un elemento al final de
 * `specialtyData.addenda`. No toca —ni puede tocar— `subjective`, `objective`,
 * `assessment`, `plan`, `vitals`, `status`, `signedAt`, el odontograma ni los
 * procedimientos: se reconstruye `specialtyData` a partir del que ya estaba y
 * lo único que cambia es esa lista. Lo firmado sigue diciendo exactamente lo
 * que decía cuando se firmó.
 *
 * TAMPOCO HAY MARCHA ATRÁS: no existe PATCH ni DELETE de adendas. Una
 * corrección que se pudiera borrar no corrige nada.
 */

const BodySchema = z.object({
  text: z.string().trim().min(1, "La adenda no puede ir vacía").max(4000),
});

interface Params { params: { id: string } }

/**
 * `type` y no `interface` a propósito: Prisma exige que lo que se escribe en
 * una columna Json encaje en `InputJsonValue`, que lleva índice de cadena.
 * TypeScript le da índice implícito a un alias de tipo, pero no a una
 * interfaz — con `interface` esto no compila.
 */
export type StoredAddendum = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: string;
};

/** Las adendas ya guardadas, saneadas. Cualquier cosa que no tenga la forma
 *  esperada se descarta al LEER, nunca se reescribe encima de la original.
 *  Sin `export`: un route.ts de App Router solo debe exportar sus handlers y
 *  la config de ruta (los `export type` sí se borran al compilar). */
function readAddenda(specialtyData: unknown): StoredAddendum[] {
  const raw = (specialtyData as Record<string, unknown> | null)?.addenda;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is StoredAddendum =>
      !!a && typeof a === "object" &&
      typeof (a as StoredAddendum).text === "string" &&
      typeof (a as StoredAddendum).createdAt === "string")
    .map((a) => ({
      id: String(a.id ?? ""),
      text: a.text,
      authorId: String(a.authorId ?? ""),
      authorName: String(a.authorName ?? ""),
      createdAt: a.createdAt,
    }));
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  const dbUser = ctx?.user ?? null;
  if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Mismo interruptor que el PATCH y el DELETE hermanos: quien no puede
  // escribir en el expediente tampoco escribe adendas.
  const denied = denyIfMissingPermission(dbUser, "medicalRecord.edit");
  if (denied) return denied;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: dbUser.clinicId },
    select: { id: true, doctorId: true, patientId: true, specialtyData: true },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Visibilidad por paciente ANTES de mirar el estado de la nota, para no
  // filtrar ni su existencia ni si está firmada. Igual que el PATCH.
  if (existing.patientId) {
    const visDenied = await assertPatientVisible(existing.patientId, {
      userId: dbUser.id,
      role: dbUser.role,
      clinicId: dbUser.clinicId,
    });
    if (visDenied) return visDenied;
  }

  const currentSpec = (existing.specialtyData ?? {}) as Record<string, unknown>;
  if (currentSpec.status !== "SIGNED") {
    // Una nota en borrador se corrige editándola; meterle una adenda dejaría
    // una corrección de algo que todavía nadie firmó.
    return NextResponse.json(
      { error: "Solo una nota firmada admite adendas. Esta sigue en borrador: edítala." },
      { status: 400 },
    );
  }

  const isOwner = existing.doctorId === dbUser.id;
  const isAdmin = dbUser.role === "ADMIN" || dbUser.role === "SUPER_ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const before = readAddenda(currentSpec);
  const addendum: StoredAddendum = {
    id: crypto.randomUUID(),
    text: parsed.data.text,
    // NOM-004: el autor SIEMPRE identificable. El nombre se congela aquí para
    // que la adenda siga diciendo quién la escribió aunque esa persona cambie
    // de nombre o deje la clínica.
    authorId: dbUser.id,
    authorName: [dbUser.firstName, dbUser.lastName].filter(Boolean).join(" ").trim() || dbUser.email,
    createdAt: new Date().toISOString(),
  };
  const addenda = [...before, addendum];

  const updated = await prisma.medicalRecord.update({
    where: { id: params.id },
    // Lo firmado entra tal cual y sale tal cual; `addenda` es la única clave
    // que cambia de valor.
    data: { specialtyData: { ...currentSpec, addenda } },
    select: { id: true, patientId: true, specialtyData: true, updatedAt: true },
  });

  await logMutation({
    req,
    clinicId: dbUser.clinicId,
    userId: dbUser.id,
    entityType: "record",
    entityId: params.id,
    action: "update",
    before: { addenda: before },
    after: { addenda },
  });

  revalidateAfter("clinicalNotes");
  revalidatePatientProfile(updated.patientId);
  return NextResponse.json({ addendum, addenda, note: updated }, { status: 201 });
}
