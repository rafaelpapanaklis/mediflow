import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, listCortes, moneyErrorResponse } from "@/lib/barber/cash";
import { DEFAULT_BARBER_TZ, isValidPeriodKey, periodKeyFor } from "@/lib/barber/commissions";
import { cortesCsv, type CortesCsvLabels } from "@/lib/barber/caja-csv";
import { getBarberT } from "@/i18n/dictionaries/barber";

export const dynamic = "force-dynamic";

const CSV_KEYS: Array<keyof CortesCsvLabels> = [
  "opened", "closed", "openedBy", "closedBy", "opening", "cashCharged", "cashIn", "cashExpenses", "withdrawals",
  "cashPayouts", "cashRefunds", "expected", "counted", "difference", "leftForNext", "income", "card", "transfer",
  "online", "tips", "tickets", "expensesAll", "notes",
];

// GET /api/barber/cash-sessions/cortes?period=YYYY-MM[&format=csv] → los
// cortes de ese mes (sede de la sesión) con su resumen; con format=csv, la
// hoja para Excel. cash.view.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
    const raw = req.nextUrl.searchParams.get("period");
    const period = isValidPeriodKey(raw) ? (raw as string) : periodKeyFor(new Date(), tz);
    const rows = await listCortes(ctx, period);
    if (req.nextUrl.searchParams.get("format") === "csv") {
      const t = getBarberT(ctx.barbershop.locale);
      const L = Object.fromEntries(CSV_KEYS.map((k) => [k, t(`barber.caja.csv.cortes.${k}`)])) as unknown as CortesCsvLabels;
      return new NextResponse(cortesCsv(rows, L, tz), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="cortes-${period}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ period, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
