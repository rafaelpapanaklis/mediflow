import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { money } from "@/lib/caja";
import { MX_OFFSET_MS } from "@/lib/analytics/query";
import { expenseWindowEnd } from "@/lib/finanzas-periodo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// GASTOS — CRUD del módulo Finanzas (tabla expenses, ver sql/expenses.sql).
// clinicId y createdById SIEMPRE de la sesión (jamás del body/query).
// La tabla puede NO existir aún (el SQL se aplica a mano): el GET degrada
// con { gastos: [], tablaFaltante: true } en vez de tirar 500.
// Categorías sugeridas en UI: Renta, Insumos, Nómina, Servicios, Marketing,
// Otro — pero se acepta cualquier string no vacío.
// Permiso: analytics.view (dirección financiera = solo admin/owner, igual
// que /api/finanzas y el gate de la página).
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

/** La tabla expenses puede no existir aún (sql/expenses.sql se corre a mano). */
// ws1-t4: purchaseId y la relación `purchase` (→ InventoryPurchase/
// InventoryProvider) son campos NUEVOS de un modelo VIEJO (Expense). Además
// de P2021/P2022 (columna faltante en la base), un `next dev` que ya tenía
// el singleton de Prisma cargado antes de `npx prisma generate` no lo
// reconstruye solo (medido en vivo por ws1-t5, ver su nota en
// lots.server.ts): con ese cliente viejo, pedir un campo que su DMMF no
// conoce tira `PrismaClientValidationError` (sin `.code`). Se trata igual.
function isMissingTable(e: any): boolean {
  if (e?.code === "P2021" || e?.code === "P2022") return true;
  return e instanceof Prisma.PrismaClientValidationError;
}

const TABLA_FALTANTE_MSG = "La tabla expenses no existe aún. Aplica sql/expenses.sql en Supabase.";

const createSchema = z.object({
  date:     z.string().trim().optional(),
  category: z.string().trim().min(1, "La categoría es requerida.").max(100),
  amount:   z.number().finite().positive("El monto debe ser mayor a 0."),
  note:     z.string().trim().max(500).optional().nullable(),
});

/** "YYYY-MM-DD" = día natural de México (-06:00); ISO con hora se respeta; vacío = ahora. */
function parseExpenseDate(raw?: string): Date | null {
  if (!raw) return new Date();
  const iso = DATE_ONLY_RE.test(raw) ? `${raw}T00:00:00.000-06:00` : raw;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function serializeGasto(g: {
  id: string; date: Date; category: string; amount: number; note: string | null;
  purchaseId?: string | null; purchase?: { provider: { name: string } | null } | null;
}) {
  return {
    id:         g.id,
    date:       g.date.toISOString(),
    category:   g.category,
    amount:     money(g.amount ?? 0),
    note:       g.note ?? null,
    // ws1-t4: si el gasto nació de una compra de inventario, lo dice —
    // purchaseId es columna NUEVA (sql/inventario-proveedores-compras-t4.sql).
    purchaseId:   g.purchaseId ?? null,
    providerName: g.purchase?.provider?.name ?? null,
  };
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
  const where = { clinicId: ctx.clinicId, date: { gte: win.from, lte: expenseTo } };
  const orderBy = { date: "desc" as const };

  try {
    try {
      // ws1-t4: purchaseId/purchase.provider — columna y tabla nuevas. Si el
      // SQL de compras aún no se pegó, esto truena con P2022/P2021 y cae al
      // select de siempre (catch de abajo), sin que Gastos deje de listar.
      const rows = await prisma.expense.findMany({
        where, orderBy,
        select: {
          id: true, date: true, category: true, amount: true, note: true, purchaseId: true,
          purchase: { select: { provider: { select: { name: true } } } },
        },
      });
      return NextResponse.json({ gastos: rows.map(serializeGasto) });
    } catch (inner: any) {
      if (!isMissingTable(inner)) throw inner;
      const rows = await prisma.expense.findMany({
        where, orderBy,
        select: { id: true, date: true, category: true, amount: true, note: true },
      });
      return NextResponse.json({ gastos: rows.map(serializeGasto) });
    }
  } catch (err: any) {
    if (isMissingTable(err)) return NextResponse.json({ gastos: [], tablaFaltante: true });
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
    // Multi-tenant guard: el gasto DEBE existir Y pertenecer a la clínica de
    // la sesión (findFirst por {id, clinicId}) antes de borrar.
    const existing = await prisma.expense.findFirst({
      where:  { id, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });

    await prisma.expense.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (isMissingTable(err)) return NextResponse.json({ error: TABLA_FALTANTE_MSG }, { status: 503 });
    console.error("[gastos] DELETE error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al eliminar el gasto." }, { status: 500 });
  }
}
