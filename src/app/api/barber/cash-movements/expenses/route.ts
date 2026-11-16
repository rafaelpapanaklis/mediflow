import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { DEFAULT_BARBER_TZ } from "@/lib/barber/commissions";
import { listExpenses } from "@/lib/barber/caja-movimientos";
import { CASH_EXPENSE_CATEGORIES } from "@/lib/barber/caja-movimientos-core";
import { gastosCsv } from "@/lib/barber/caja-csv";
import { getBarberT } from "@/i18n/dictionaries/barber";

export const dynamic = "force-dynamic";

// GET /api/barber/cash-movements/expenses?period=YYYY-MM&category=RENT[&format=csv]
// → TODOS los gastos del mes de la sede de la sesión (con caja o fuera de
// caja: renta, luz), con el total por categoría; con format=csv, la hoja.
// cash.view. Sin sql/barber_caja_completa.sql → 409 CAJA_SQL_PENDING.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const sp = req.nextUrl.searchParams;
    const data = await listExpenses(ctx, { periodKey: sp.get("period"), category: sp.get("category") });
    if (sp.get("format") === "csv") {
      const t = getBarberT(ctx.barbershop.locale);
      const c = (k: string) => t(`barber.caja.csv.gastos.${k}`);
      const csv = gastosCsv(
        data.items,
        {
          date: c("date"),
          category: c("category"),
          amount: c("amount"),
          method: c("method"),
          note: c("note"),
          who: c("who"),
          inRegister: c("inRegister"),
          yes: c("yes"),
          no: c("no"),
          voided: c("voided"),
          categoryOf: (cat) =>
            !cat ? t("barber.caja.mov.cat.none") : (CASH_EXPENSE_CATEGORIES as readonly string[]).includes(cat) ? t(`barber.caja.mov.cat.${cat}`) : cat,
          methodOf: (m) => t(`barber.caja.mov.method.${m}`),
        },
        ctx.barbershop.timezone || DEFAULT_BARBER_TZ,
      );
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="gastos-${data.periodKey}${data.category ? `-${data.category.toLowerCase()}` : ""}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
