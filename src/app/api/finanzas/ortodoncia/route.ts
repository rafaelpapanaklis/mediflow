import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { resolveFinanzasWindow } from "@/lib/finanzas-periodo";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { loadOrthoCases } from "@/lib/orthodontics/tablero-data";
import { cargarFiltroSinPrueba } from "@/lib/patients/paciente-de-prueba-db";
import { produccionPorDoctor, totalesDePagos } from "@/lib/orthodontics/produccion";
import {
  cargarCambiosDeDoctor,
  cargarNombresDeDoctores,
  cargarPagosDeCasos,
} from "@/lib/orthodontics/produccion-db";
import {
  BLOQUE_ORTODONCIA_INACTIVO,
  carteraDeOrtodoncia,
  conteoDeCasos,
  filasPorDoctor,
  type BloqueOrtodonciaFinanzas,
} from "@/lib/orthodontics/finanzas-ortodoncia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// FINANZAS · bloque «Ortodoncia» (ws1-t5, ronda 6 — fila 90 de la revisión de
// lógica de uso). Solo LEE.
//
// GET /api/finanzas/ortodoncia?period=hoy|mes|mes_anterior|custom[&from&to]
// — la MISMA ventana que /api/finanzas (`resolveFinanzasWindow`).
//
// Mismo permiso que Finanzas (`analytics.view`). `clinicId` de la sesión. Si
// la clínica no tiene el módulo ni casos, contesta `{ activo: false }` y la
// pantalla no pinta nada. Si tuvo el módulo y ya no lo paga pero tiene casos,
// SÍ contesta (decisión 3: la lectura de sus casos se conserva), con
// `moduloVigente: false`.
//
// Las consultas van EN FILA, no en paralelo: `loadOrthoCases` ya lanza las
// suyas, y esta ruta se pide a la vez que /api/finanzas y /api/gastos.
// ═══════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "analytics.view");
  if (denied) return denied;
  const { clinicId } = ctx;
  if (!clinicId) return NextResponse.json(BLOQUE_ORTODONCIA_INACTIVO);

  const win = resolveFinanzasWindow(new URL(req.url).searchParams);
  if ("error" in win) return NextResponse.json({ error: win.error }, { status: 400 });

  try {
    const moduloVigente = await hasActiveOrthodonticsModule(clinicId);
    if (!moduloVigente) {
      const hayCasos = await prisma.orthodonticTreatmentPlan.count({ where: { clinicId, deletedAt: null } });
      if (hayCasos === 0) return NextResponse.json(BLOQUE_ORTODONCIA_INACTIVO);
    }

    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
    const zonaHoraria = clinic?.timezone || "America/Mexico_City";
    const ahora = new Date();
    const viewer = { userId: ctx.userId, role: ctx.role, clinicId };

    // ws1-t11 (11d): los casos de «Pacientes de prueba / no contactar» no cuentan.
    const sinPrueba = await cargarFiltroSinPrueba(clinicId);
    const cargados = await loadOrthoCases(clinicId, zonaHoraria, viewer, ahora);
    const { invoiceIdByPlanId } = cargados;
    const cases = cargados.cases.filter((c) => sinPrueba.cuenta(c.patientId));

    // `to` es inclusivo en Finanzas; el cargador usa [desde, hasta).
    const rango = { desde: win.from, hasta: new Date(win.to.getTime() + 1) };
    const pagos = await cargarPagosDeCasos(
      clinicId,
      cases.map((c) => ({ planId: c.planId, invoiceId: invoiceIdByPlanId.get(c.planId) ?? null, treatingDoctorId: c.treatingDoctorId })),
      rango,
    );
    const cambios = pagos.length > 0
      ? await cargarCambiosDeDoctor(clinicId, Array.from(new Set(pagos.map((p) => p.planId))), rango.desde)
      : [];
    const nombres = new Map<string, string>();
    for (const c of cases) if (c.treatingDoctorId && c.treatingDoctorName) nombres.set(c.treatingDoctorId, c.treatingDoctorName);
    const sinNombre = cambios.flatMap((c) => [c.de, c.a]).filter((id): id is string => !!id && !nombres.has(id));
    if (sinNombre.length > 0) {
      for (const [id, nombre] of await cargarNombresDeDoctores(clinicId, sinNombre)) nombres.set(id, nombre);
    }

    const produccion = produccionPorDoctor({
      pagos,
      doctorActualPorCaso: new Map(cases.map((c) => [c.planId, c.treatingDoctorId])),
      cambios,
      nombres,
      zonaHoraria,
    });

    const cuerpo: BloqueOrtodonciaFinanzas = {
      activo: true,
      moduloVigente,
      periodo: totalesDePagos(pagos),
      porDoctor: filasPorDoctor(cases, produccion),
      casos: conteoDeCasos(cases),
      cartera: carteraDeOrtodoncia(cases, hoyEnZona(ahora, zonaHoraria)),
    };
    return NextResponse.json(cuerpo);
  } catch (err: any) {
    console.error("[finanzas/ortodoncia] GET error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al calcular el bloque de ortodoncia." }, { status: 500 });
  }
}
