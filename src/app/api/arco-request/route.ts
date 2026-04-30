import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * /api/arco-request — Endpoint AUTENTICADO para que el staff de la clínica
 * registre y EJECUTE las solicitudes ARCO de un paciente bajo LFPDPPP.
 *
 * (El endpoint público /api/arco/request sigue siendo el canal de entrada
 *  para solicitudes que llegan desde el aviso de privacidad, sin auth.)
 *
 * GET ?patientId=X — devuelve solicitudes ARCO del paciente.
 * POST { patientId, action, payload, reason } — registra la solicitud y
 *   la ejecuta:
 *     - access:        prepara el export (cliente debe llamar /api/patients/[id]/export)
 *     - rectification: aplica los campos del payload sobre el patient
 *     - cancellation:  soft delete + anonimiza PII (NOM-024 conserva
 *                      historia clínica 5 años, no hace hard delete)
 *     - opposition:    registra oposición a uso específico (marketing,
 *                      terceros, etc.) en resolvedNotes
 *
 * Multi-tenant: clinicId siempre del ctx, nunca del body.
 */

const PATIENT_ID = z.string().min(1, "patientId requerido");
const REASON     = z.string().min(10, "Razón debe tener al menos 10 caracteres").max(4000);

const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("access"),
    patientId: PATIENT_ID,
    reason: REASON,
  }),
  z.object({
    action: z.literal("rectification"),
    patientId: PATIENT_ID,
    reason: REASON,
    payload: z.object({
      firstName: z.string().min(1).max(100).optional(),
      lastName:  z.string().min(1).max(100).optional(),
      email:     z.string().email().optional(),
      phone:     z.string().max(40).optional(),
      address:   z.string().max(500).optional(),
      curp:      z.string().max(18).optional(),
      rfcPaciente: z.string().max(13).optional(),
      dob:       z.string().datetime().optional(),
    }).strict(),
  }),
  z.object({
    action: z.literal("cancellation"),
    patientId: PATIENT_ID,
    reason: REASON,
  }),
  z.object({
    action: z.literal("opposition"),
    patientId: PATIENT_ID,
    reason: REASON,
    payload: z.object({
      scope: z.enum(["marketing", "third_party_sharing", "research", "all"]),
      notes: z.string().max(2000).optional(),
    }),
  }),
]);

const ACTION_TO_TYPE = {
  access:        "ACCESS",
  rectification: "RECTIFICATION",
  cancellation:  "CANCELLATION",
  opposition:    "OPPOSITION",
} as const;

function eta20BizDays(): string {
  // LFPDPPP art. 32 — 20 días hábiles.
  return new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId requerido" }, { status: 400 });

  // Verifica que el paciente sea de la clínica del ctx.
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const requests = await prisma.arcoRequest.findMany({
    where: { patientId, clinicId: ctx.clinicId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: "Solo administradores pueden ejecutar acciones ARCO" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Body inválido" },
      { status: 400 },
    );
  }

  // Multi-tenant guard
  const patient = await prisma.patient.findFirst({
    where: { id: parsed.data.patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Crea el registro ARCO ANTES de ejecutar la acción para que quede
  // trazabilidad incluso si la mutación falla parcialmente.
  const arco = await prisma.arcoRequest.create({
    data: {
      clinicId:  ctx.clinicId,
      patientId: patient.id,
      type:      ACTION_TO_TYPE[parsed.data.action],
      reason:    parsed.data.reason,
      email:     patient.email ?? "no-email-on-file@example.com",
      status:    "IN_PROGRESS",
    },
  });

  let resolutionNotes = "";
  let result: Record<string, unknown> = {};

  try {
    switch (parsed.data.action) {
      case "access": {
        // El cliente debe llamar GET /api/patients/[id]/export para
        // obtener el dump. Solo dejamos constancia y dirigimos.
        resolutionNotes = `Solicitud de acceso registrada. Export disponible en GET /api/patients/${patient.id}/export.`;
        result = { exportEndpoint: `/api/patients/${patient.id}/export` };
        break;
      }

      case "rectification": {
        const before: Record<string, unknown> = {};
        const updates: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(parsed.data.payload)) {
          before[k] = (patient as any)[k] ?? null;
          updates[k] = k === "dob" && typeof v === "string" ? new Date(v) : v;
        }

        await prisma.patient.update({
          where: { id: patient.id },
          data:  updates,
        });

        await logMutation({
          req,
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          entityType: "patient",
          entityId: patient.id,
          action: "update",
          before,
          after: updates,
        });

        resolutionNotes = `Rectificación aplicada en ${Object.keys(updates).length} campo(s).`;
        result = { fieldsUpdated: Object.keys(updates) };
        break;
      }

      case "cancellation": {
        // NOM-024 obliga a retener historia clínica 5 años → soft delete +
        // anonimización del PII. NUNCA hard delete.
        const before = {
          firstName: patient.firstName,
          lastName:  patient.lastName,
          email:     patient.email,
          phone:     patient.phone,
          curp:      patient.curp,
          rfcPaciente: patient.rfcPaciente,
          address:   patient.address,
        };

        const ANON = "[ANONIMIZADO]";
        await prisma.patient.update({
          where: { id: patient.id },
          data: {
            firstName:        ANON,
            lastName:         ANON,
            email:            null,
            phone:            null,
            address:          null,
            curp:             null,
            passportNo:       null,
            rfcPaciente:      null,
            regimenFiscalPac: null,
            cpPaciente:       null,
            razonSocialPac:   null,
            allergies:          [],
            chronicConditions:  [],
            currentMedications: [],
            tags:               [],
            notes:              null,
            deletedAt:    new Date(),
            anonymizedAt: new Date(),
            status:       "ARCHIVED",
          },
        });

        await logMutation({
          req,
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          entityType: "patient",
          entityId: patient.id,
          action: "delete",
          before,
        });

        resolutionNotes = "Cancelación ejecutada: PII anonimizado, paciente archivado. Historia clínica conservada por 5 años (NOM-024).";
        result = { anonymizedAt: new Date().toISOString() };
        break;
      }

      case "opposition": {
        const { scope, notes } = parsed.data.payload;
        resolutionNotes = `Oposición registrada (scope: ${scope})${notes ? `. Notas: ${notes}` : ""}.`;
        result = { scope };
        break;
      }
    }

    const updated = await prisma.arcoRequest.update({
      where: { id: arco.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedNotes: resolutionNotes,
      },
    });

    return NextResponse.json({
      ok: true,
      arco: updated,
      result,
      etaIso: eta20BizDays(),
    }, { status: 201 });
  } catch (err: any) {
    await prisma.arcoRequest.update({
      where: { id: arco.id },
      data: {
        status: "REJECTED",
        resolvedAt: new Date(),
        resolvedNotes: `Error al ejecutar acción: ${String(err?.message ?? err).slice(0, 500)}`,
      },
    }).catch(() => {});
    return NextResponse.json({ error: "Error al ejecutar acción ARCO" }, { status: 500 });
  }
}
