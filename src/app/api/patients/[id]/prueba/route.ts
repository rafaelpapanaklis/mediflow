// ws1-t11 (11d) — «Paciente de prueba / no contactar» de UN paciente.
//
//   GET → { activo, marcado, puedeEditar }
//         `activo` = el SQL ya está pegado (sql/ws1-t11-paciente-de-prueba.sql).
//   PUT { marcado: boolean } → guarda la marca y la deja en Movimientos.
//
// Quién la cambia: «Archivar/eliminar pacientes» (patients.delete; de fábrica
// dueño y administrador). Pesa como archivar: el paciente deja de recibir
// TODO mensaje y sale de los reportes, así que no lo decide cualquiera que
// edite datos. Verla, cualquiera que vea al paciente.
//
// Tenant: clinicId de la sesión; el paciente se busca por id + clínica + la
// visibilidad del usuario (un paciente que no ve, para él no existe → 404).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { columnaDePruebaExiste, esPacienteDePrueba, guardarMarcaDePrueba } from "@/lib/patients/paciente-de-prueba-db";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

async function pacienteVisible(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, id: string) {
  return prisma.patient.findFirst({
    where: { id, clinicId: ctx.clinicId, AND: patientVisibilityAnd(ctx) },
    select: { id: true },
  });
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "patients.view");
  if (denied) return denied;
  if (!(await pacienteVisible(ctx, params.id))) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }
  const activo = await columnaDePruebaExiste();
  const marcado = activo ? await esPacienteDePrueba(ctx.clinicId, params.id) : false;
  const puedeEditar = denyIfMissingPermission(ctx, "patients.delete") === null;
  return NextResponse.json({ activo, marcado, puedeEditar });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "patients.delete");
  if (denied) return denied;
  if (!(await pacienteVisible(ctx, params.id))) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { marcado?: unknown } | null;
  if (!body || typeof body.marcado !== "boolean") {
    return NextResponse.json({ error: "Cuerpo inválido: falta «marcado» (true o false)." }, { status: 400 });
  }

  const r = await guardarMarcaDePrueba(ctx.clinicId, params.id, body.marcado);
  if (!r.ok) {
    return r.error === "columna_faltante"
      ? NextResponse.json(
          { error: "Esta función todavía no está activa en tu clínica.", code: "columna_faltante" },
          { status: 409 },
        )
      : NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  if (r.antes !== body.marcado) {
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "patient",
      entityId: params.id,
      patientId: params.id,
      action: "update",
      before: { pacienteDePrueba: r.antes },
      after: { pacienteDePrueba: body.marcado },
      texto: body.marcado
        ? "Lo marcó como «Paciente de prueba / no contactar»"
        : "Le quitó la marca «Paciente de prueba / no contactar»",
    });
  }

  return NextResponse.json({ activo: true, marcado: body.marcado, puedeEditar: true });
}
