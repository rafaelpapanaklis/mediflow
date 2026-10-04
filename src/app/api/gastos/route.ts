import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { money } from "@/lib/caja";
import { MX_OFFSET_MS } from "@/lib/analytics/query";
import { expenseWindowEnd } from "@/lib/finanzas-periodo";
import { isMissingTable, listarGastosDelPeriodo, serializeGasto } from "@/lib/gastos-periodo.server";
import { borrarGasto, buscarGastoVivo, copiaDeGasto } from "@/lib/gastos-borrado.server";
import { logMutation } from "@/lib/audit";
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// GASTOS — CRUD del módulo Finanzas (tabla expenses, ver sql/expenses.sql).
// clinicId y createdById SIEMPRE de la sesión (jamás del body/query).
// La tabla puede NO existir aún (el SQL se aplica a mano): el GET degrada
// con { gastos: [], tablaFaltante: true } en vez de tirar 500.
// Categorías sugeridas en UI: Renta, Insumos, Nómina, Servicios, Marketing,
// Otro — pero se acepta cualquier string no vacío.
// Permiso: analytics.view para leer (dirección financiera = solo admin/owner,
// igual que /api/finanzas y el gate de la página); expenses.edit para crear,
// editar y borrar.
// ws1-t2 (auditoría de dinero F11): crear, editar y borrar dejan su fila en la
// bitácora (logMutation, entidad "expense") con monto, categoría, fecha y
// nota; borrar es LÓGICO en cuanto se pegue sql/ws1-t2-gastos-borrado-logico.sql
// (lib/gastos-borrado.server). Un gasto borrado deja de contar, pero no se pierde.
// ═══════════════════════════════════════════════════════════════════

/** Inicio del día natural de México (réplica de caja.ts, que no lo exporta). */
function startOfTodayMx(now: Date): Date {
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  return new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth(), mx.getUTCDate()) + MX_OFFSET_MS);
}

/** Día 1 del mes de México (con delta de meses), expresado como instante UTC. */
function startOfMonthMx(now: Date, monthDelta = 0): Date {
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  return new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth() + monthDelta, 1) + MX_OFFSET_MS);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Misma resolución de periodo que /api/finanzas (default "mes"). */
function resolveWindow(sp: URLSearchParams): { from: Date; to: Date } | { error: string } {
  const now = new Date();
  const period = sp.get("period") ?? "mes";
  if (period === "hoy") return { from: startOfTodayMx(now), to: now };
  if (period === "mes_anterior") {
    const currentStart = startOfMonthMx(now, 0);
    return { from: startOfMonthMx(now, -1), to: new Date(currentStart.getTime() - 1) };
  }
  if (period === "custom") {
    const fromRaw = sp.get("from") ?? "";
    const toRaw = sp.get("to") ?? "";
    if (!DATE_ONLY_RE.test(fromRaw) || !DATE_ONLY_RE.test(toRaw)) {
      return { error: "period=custom requiere from y to en formato YYYY-MM-DD." };
    }
    const from = new Date(`${fromRaw}T00:00:00.000-06:00`);
    const to = new Date(`${toRaw}T23:59:59.999-06:00`);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
      return { error: "Rango de fechas inválido (from debe ser <= to)." };
    }
    return { from, to };
  }
  return { from: startOfMonthMx(now, 0), to: now };
}

const TABLA_FALTANTE_MSG = "La tabla expenses no existe aún. Aplica sql/expenses.sql en Supabase.";

const createSchema = z.object({
  date:     z.string().trim().optional(),
  category: z.string().trim().min(1, "La categoría es requerida.").max(100),
  amount:   z.number().finite().positive("El monto debe ser mayor a 0."),
  note:     z.string().trim().max(500).optional().nullable(),
});

/** Edición: los mismos campos, todos opcionales (lo que no viene no cambia). */
const updateSchema = z.object({
  date:     z.string().trim().min(1).optional(),
  category: z.string().trim().min(1, "La categoría es requerida.").max(100).optional(),
  amount:   z.number().finite().positive("El monto debe ser mayor a 0.").optional(),
  note:     z.string().trim().max(500).optional().nullable(),
});

/** "YYYY-MM-DD" = día natural de México (-06:00); ISO con hora se respeta; vacío = ahora. */
function parseExpenseDate(raw?: string): Date | null {
  if (!raw) return new Date();
  const iso = DATE_ONLY_RE.test(raw) ? `${raw}T00:00:00.000-06:00` : raw;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// ── GET /api/gastos?period=hoy|mes|mes_anterior|custom[&from&to] ──────────
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "analytics.view");
  if (denied) return denied;

  const win = resolveWindow(new URL(req.url).searchParams);
  if ("error" in win) return NextResponse.json({ error: win.error }, { status: 400 });
  // «Este mes» llega al FIN del mes para los gastos (misma ventana que usa
  // /api/finanzas para la tarjeta y la utilidad): un gasto con fecha futura
  // del mes en curso se lista en cuanto se registra.
  const expenseTo = expenseWindowEnd(new URL(req.url).searchParams.get("period"), new Date(), win.to);

  try {
    // La consulta vive en @/lib/gastos-periodo.server (movida tal cual): la lee
    // también Sabina, así que lista y respuestas del chat cuadran siempre.
    const { gastos, tablaFaltante } = await listarGastosDelPeriodo({
      clinicId: ctx.clinicId, from: win.from, expenseTo,
    });
    return NextResponse.json(tablaFaltante ? { gastos: [], tablaFaltante: true } : { gastos });
  } catch (err: any) {
    console.error("[gastos] GET error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al listar gastos." }, { status: 500 });
  }
}

// ── POST /api/gastos — registra un gasto de la clínica de la sesión ───────
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // ws1-t4: "analytics.view" (para leer) por poco protegía esto — termina en
  // ".view" y READONLY lo recibe por construcción (permissions.ts), así que
  // solo-lectura podía crear gastos. "expenses.edit" no lo tiene.
  const denied = denyIfMissingPermission(ctx, "expenses.edit");
  if (denied) return denied;
  const { clinicId, userId } = ctx;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }
  const { category, amount, note } = parsed.data;
  const date = parseExpenseDate(parsed.data.date);
  if (!date) return NextResponse.json({ error: "Fecha inválida (usa YYYY-MM-DD o ISO)." }, { status: 400 });

  try {
    const gasto = await prisma.expense.create({
      data: {
        clinicId,                 // SIEMPRE de la sesión, nunca del body.
        date,
        category,
        amount: money(amount),    // 2 decimales — evita ruido de flotantes en BD.
        note:   note || null,
        createdById: userId,
      },
      // ws1-t4: select explícito — Expense gana "purchaseId" (columna nueva,
      // ligada a InventoryPurchase) y este alta manual no lo necesita ni lo
      // toca. Fijar el select aquí evita que este INSERT ... RETURNING
      // reviente con P2022 mientras sql/inventario-compras-t4.sql no se
      // pegue: "registrar gasto a mano" sigue funcionando igual.
      select: { id: true, date: true, category: true, amount: true, note: true },
    });
    await logMutation({
      req, clinicId, userId,
      entityType: "expense", entityId: gasto.id, action: "create",
      after: copiaDeGasto(gasto),
      texto: `Registró el gasto «${gasto.category}» de ${montoParaTexto(gasto.amount)}`,
    });
    return NextResponse.json({ gasto: serializeGasto(gasto) }, { status: 201 });
  } catch (err: any) {
    if (isMissingTable(err)) return NextResponse.json({ error: TABLA_FALTANTE_MSG }, { status: 503 });
    console.error("[gastos] POST error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al registrar el gasto." }, { status: 500 });
  }
}

// ── DELETE /api/gastos?id=<expenseId> ──────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // ws1-t4: mismo interruptor que crear — ver la nota en POST.
  const denied = denyIfMissingPermission(ctx, "expenses.edit");
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta el id del gasto." }, { status: 400 });

  try {
    // Multi-tenant guard: el gasto DEBE existir, estar vivo Y pertenecer a la
    // clínica de la sesión antes de borrar.
    const existing = await buscarGastoVivo(id, ctx.clinicId);
    if (!existing) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });

    // Lógico con el SQL pegado; físico sin él. En los dos casos la bitácora
    // guarda la copia del gasto (monto, categoría, fecha y nota).
    const { count, logico } = await borrarGasto({ id: existing.id, clinicId: ctx.clinicId, userId: ctx.userId });
    if (count === 0) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId,
      entityType: "expense", entityId: existing.id, action: logico ? "soft_delete" : "delete",
      before: copiaDeGasto(existing),
      texto: `Borró el gasto «${existing.category}» de ${montoParaTexto(existing.amount)}`,
    });
    return NextResponse.json({ ok: true, borradoLogico: logico });
  } catch (err: any) {
    if (isMissingTable(err)) return NextResponse.json({ error: TABLA_FALTANTE_MSG }, { status: 503 });
    console.error("[gastos] DELETE error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al eliminar el gasto." }, { status: 500 });
  }
}

// ── PATCH /api/gastos?id=<expenseId> — corrige un gasto (ws1-t2) ─────────────
// Lo que no viene en el cuerpo no cambia. Antes y después van a la bitácora.
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "expenses.edit");
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta el id del gasto." }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const data: { date?: Date; category?: string; amount?: number; note?: string | null } = {};
  if (parsed.data.date !== undefined) {
    const d = parseExpenseDate(parsed.data.date);
    if (!d) return NextResponse.json({ error: "Fecha inválida (usa YYYY-MM-DD o ISO)." }, { status: 400 });
    data.date = d;
  }
  if (parsed.data.category !== undefined) data.category = parsed.data.category;
  if (parsed.data.amount !== undefined) data.amount = money(parsed.data.amount);
  if (parsed.data.note !== undefined) data.note = parsed.data.note || null;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nada que cambiar." }, { status: 400 });

  try {
    const existing = await buscarGastoVivo(id, ctx.clinicId);
    if (!existing) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    // Mismo {id, clinicId} en la escritura: nunca se toca un gasto de otra clínica.
    const { count } = await prisma.expense.updateMany({ where: { id: existing.id, clinicId: ctx.clinicId }, data });
    if (count === 0) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    const despues = { ...existing, ...data };
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId,
      entityType: "expense", entityId: existing.id, action: "update",
      before: copiaDeGasto(existing),
      after: copiaDeGasto(despues),
      texto: `Corrigió el gasto «${despues.category}»: ${montoParaTexto(existing.amount)} → ${montoParaTexto(despues.amount)}`,
    });
    return NextResponse.json({ gasto: serializeGasto(despues) });
  } catch (err: any) {
    if (isMissingTable(err)) return NextResponse.json({ error: TABLA_FALTANTE_MSG }, { status: 503 });
    console.error("[gastos] PATCH error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al corregir el gasto." }, { status: 500 });
  }
}
