import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { createQuoteWithFolio, parseValidUntil } from "@/lib/quotes/service";
import { serializeQuote } from "@/lib/quotes/serialize";
import { normalizarCondiciones } from "@/lib/quotes/condiciones-pago";
import { guardarCondiciones, leerCondicionesDeVarios } from "@/lib/quotes/condiciones-pago-db";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { casosDesdePresupuestos } from "@/lib/quotes/ortodoncia.server";
import { aceptacionEncendida, leerAceptaciones } from "@/lib/quotes/aceptacion-db";
import { cobrosDePresupuestos } from "@/lib/quotes/cargos.server";
import { hasPermission } from "@/lib/auth/permissions";
import { diaDeVigencia, estaVencida } from "@/lib/quotes/vigencia";

export const dynamic = "force-dynamic";

/**
 * GET /api/quotes?patientId=...  — lista los presupuestos de un paciente.
 * Todo filtrado por la clínica de la sesión. Auto-expira los PRESENTED vencidos.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId requerido" }, { status: 400 });

  // Visibilidad por paciente: lee un solo paciente por id → 404 si no lo puede ver.
  const denied = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // La zona de la clínica: el día de vigencia (que se pinta) y el momento en
  // que vence salen de ella.
  const zona = (await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } }))?.timezone ?? null;

  // Vencimiento perezoso: PRESENTED cuyo día de vigencia ya terminó en la
  // clínica → EXPIRED. La base solo trae los que tienen el instante pasado
  // (un día de vigencia nunca termina antes de su instante guardado); de esos,
  // vencen los que `estaVencida` dice, no los que pasaron la medianoche UTC.
  const candidatos = await prisma.quote.findMany({
    where: { clinicId: ctx.clinicId, patientId, status: "PRESENTED", validUntil: { lt: new Date() } },
    select: { id: true, validUntil: true },
  });
  const vencidos = candidatos.filter((q) => estaVencida(q.validUntil, zona)).map((q) => q.id);
  if (vencidos.length > 0) {
    await prisma.quote.updateMany({
      where: { clinicId: ctx.clinicId, patientId, status: "PRESENTED", id: { in: vencidos } },
      data: { status: "EXPIRED" },
    });
  }

  const quotes = await prisma.quote.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Formas de pago de TODAS en UNA consulta (la regla de la casa: nunca una
  // consulta por fila). Sin el SQL aplicado devuelve un mapa vacío y cada
  // presupuesto sale con `condicionesPago: null`, como antes.
  const { porQuote, fallo } = await leerCondicionesDeVarios(prisma, quotes.map((q) => q.id));

  // `fallo` marca TODOS los presupuestos de la respuesta como «no se pudo leer
  // su forma de pago». Es de esta lista de donde el editor saca el presupuesto
  // que abre, así que es aquí donde la mentira «no tiene plan» se convertiría
  // en un borrado al guardar.
  // Presupuestos de ortodoncia aceptados, en una sede con el módulo: ofrecen
  // abrir el caso de ortodoncia en vez de un plan general (ws1-t5). Todo con
  // la clínica y los permisos de la sesión; sin módulo, mapa vacío.
  // Aceptación por concepto y cargos (ws1-t6). Sin el SQL: nada de esto y la
  // tarjeta se pinta como siempre. Dos consultas para todos, no una por fila.
  const porConcepto = await aceptacionEncendida();
  const cobros = porConcepto ? await cobrosDePresupuestos(ctx.clinicId, quotes) : new Map();
  // El caso de ortodoncia se decide con lo que el paciente ACEPTÓ: si de un
  // presupuesto mixto solo aceptó la resina, no hay caso que abrir.
  const aceptadas = porConcepto
    ? (await leerAceptaciones(prisma, ctx.clinicId, quotes.filter((q) => q.status === "ACCEPTED").map((q) => q.id))).porQuote
    : new Map();
  const paraCasos = quotes.map((q) => {
    const g = aceptadas.get(q.id);
    if (!g) return q;
    const si = new Set(g.renglones.filter((r: { aceptado: boolean }) => r.aceptado).map((r: { quoteItemId: string }) => r.quoteItemId));
    return { ...q, items: q.items.filter((it) => si.has(it.id)) };
  });
  const casos = await casosDesdePresupuestos(ctx, paraCasos);
  // La vigencia se pinta como DÍA en la zona de la clínica (`zona`, leída
  // arriba), el mismo que ve el paciente en la liga.
  const userPerm = { role: ctx.role, permissionsOverride: ctx.permissionsOverride ?? [] };
  const permisos = {
    aceptar: hasPermission(userPerm, "billing.edit"),
    cargar: hasPermission(userPerm, "billing.create"),
  };

  return NextResponse.json(
    quotes.map((q) => {
      const dto = serializeQuote(q, porQuote.get(q.id) ?? null, fallo);
      const caso = casos.get(q.id);
      const cobro = cobros.get(q.id);
      return {
        ...dto,
        validUntilDia: diaDeVigencia(q.validUntil, zona),
        ...(caso ? { casoOrtodoncia: caso } : {}),
        ...(porConcepto ? { porConcepto: true, permisos } : {}),
        ...(cobro ? { cobro } : {}),
      };
    }),
  );
}

/**
 * POST /api/quotes — crea un presupuesto DRAFT. Solo el presupuesto: NO crea
 * factura ni gasta folio MF. La factura nace cuando el paciente lo acepta y se
 * pulsa «Generar factura» (POST /api/quotes/[id]/invoice), ya PENDIENTE.
 * Body: { patientId, title?, items[], discountPct?, discountAmount?, validUntil?, notes? }
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: "billing.create", la MISMA key que POST /api/invoices.
  // Se puso cuando esta ruta además creaba una factura BORRADOR y quemaba
  // folio. Ya no factura, pero la llave se conserva a propósito: quitarla
  // ensancharía en silencio quién puede crear presupuestos, y eso lo decide
  // la clínica en sus permisos, no un arreglo.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.create");
  if (deniedPerm) return deniedPerm;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const patientId = typeof body.patientId === "string" ? body.patientId : "";
  if (!patientId) return NextResponse.json({ error: "patientId requerido" }, { status: 400 });

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Visibilidad: la respuesta (serializeQuote de createQuoteWithFolio) incluye el
  // nombre del paciente. Sin este assert, un usuario excluido crea un presupuesto
  // y recibe el nombre del paciente restringido en el eco de la respuesta.
  const denied = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const items = Array.isArray(body.items) ? (body.items as never[]) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Agrega al menos un concepto" }, { status: 400 });
  }

  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 160)
    : "Presupuesto";
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
  const validUntil = parseValidUntil(body.validUntil);

  const quote = await createQuoteWithFolio({
    clinicId: ctx.clinicId,
    patientId,
    createdById: ctx.userId,
    title,
    items,
    discountPct: body.discountPct == null ? null : Number(body.discountPct),
    discountAmount: body.discountAmount == null ? null : Number(body.discountAmount),
    validUntil,
    notes,
  });

  // Formas de pago. Se normalizan contra el TOTAL que acaba de calcular el
  // servidor, no contra el que mandó el cliente: así un enganche no puede
  // pasarse del presupuesto. Si la tabla no existe todavía, devuelve null y el
  // presupuesto queda igual de válido.
  const guardado = await guardarCondiciones(prisma, {
    quoteId: quote.id,
    clinicId: ctx.clinicId,
    condiciones: normalizarCondiciones(body.condicionesPago, Number(quote.total)),
  });

  await logAudit({
    patientId: quote.patientId,
    texto: `Creó el presupuesto ${quote.folio}`,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "create",
    changes: { folio: { before: null, after: quote.folio }, total: { before: null, after: Number(quote.total) } },
  });

  // 🔴 Aquí NO se crea factura. Hasta sep-2026 se creaba una en BORRADOR para
  // que saliera ya en «Facturación», y eso convertía cada presupuesto —aceptado
  // o no— en una factura con folio gastado: inflaba el «Cobrar ahora» y el
  // filtro «Con deuda» de la ficha, y un presupuesto rechazado dejaba su
  // factura viva. Pasarla a PENDIENTE habría sido peor: deuda exigible en
  // Caja, reportes y el portal del paciente por presupuestos que nadie aceptó.
  // La factura nace al aceptar, en POST /api/quotes/[id]/invoice.
  //
  // `invoice: null` se conserva en la respuesta: los editores leen ese campo
  // para insertar la factura en Facturación, y con null no insertan nada.
  return NextResponse.json({
    ...serializeQuote(quote, guardado.condiciones),
    invoice: null,
    // Ver el PATCH: si había un plan que guardar y la base falló, se dice.
    ...(guardado.fallo ? { condicionesPagoFallo: true } : {}),
  }, { status: 201 });
}
