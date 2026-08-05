// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/affiliate-support/tickets — bandeja global de tickets de AFILIADOS.
//   GET ?status=&category=&priority=&affiliateId=&q=&metrics=1
//     → { tickets } (+ { metrics } si metrics=1)
//
// Espejo de /api/admin/support/tickets (clínicas) pero contra las tablas
// propias affiliate_support_*. El service hace la lógica; aquí sólo: guard
// admin, validar filtros, delegar.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  AFFILIATE_SUPPORT_CATEGORIES,
  AFFILIATE_SUPPORT_PRIORITIES,
  AFFILIATE_SUPPORT_STATUSES,
  AffiliateSupportError,
  type AdminAffiliateTicketSummary,
  type AffiliateSupportAdminMetrics,
} from "@/lib/affiliate-support/types";
import {
  listAdminAffiliateTickets,
  getAffiliateSupportAdminMetrics,
} from "@/lib/affiliate-support/service";

export const dynamic = "force-dynamic";

/** Lo que consume soporte-afiliados-client.tsx (import type, sin Prisma). */
export interface AdminAffiliateTicketsResponse {
  tickets: AdminAffiliateTicketSummary[];
  metrics?: AffiliateSupportAdminMetrics | null;
  /** true = faltan las tablas affiliate_support_* en Supabase. */
  sqlPending?: boolean;
  sqlPendingMessage?: string;
}

// NO se exporta: un route.ts de App Router sólo admite handlers, `dynamic` y
// tipos. Exportar una const suelta rompe el build ("not a valid Route export").
const SQL_PENDING_MESSAGE =
  "Falta aplicar el SQL de soporte de afiliados en Supabase (affiliate_support_tickets / affiliate_support_messages).";

/**
 * Drift de esquema: tabla (P2021/42P01) o columna (P2022/42703) que no existe
 * porque el .sql se aplica A MANO en Supabase después del deploy. Mismo criterio
 * que las rutas de clinic-layout. NO es un 500: la bandeja se dibuja vacía con
 * un aviso accionable.
 */
function isSchemaDrift(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022" || code === "42P01" || code === "42703";
}

/** Filtro válido o undefined (un valor basura se ignora, no rompe la bandeja). */
function pick(value: string | null, allowed: readonly string[]): string | undefined {
  return value && allowed.includes(value) ? value : undefined;
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const rawStatus = sp.get("status");
  // "OPEN" es un pseudo-valor (= todos los abiertos) que el service SÍ entiende
  // y traduce a un `IN` en la consulta. Se le pasa tal cual en vez de filtrar
  // aquí el resultado: la lista viene acotada por `take`, así que post-filtrar
  // escondería tickets abiertos detrás de los cerrados más recientes.
  const filters = {
    status: rawStatus === "OPEN" ? "OPEN" : pick(rawStatus, AFFILIATE_SUPPORT_STATUSES),
    category: pick(sp.get("category"), AFFILIATE_SUPPORT_CATEGORIES),
    priority: pick(sp.get("priority"), AFFILIATE_SUPPORT_PRIORITIES),
    affiliateId: sp.get("affiliateId") || undefined,
    q: sp.get("q") || undefined,
  };
  const wantsMetrics = sp.get("metrics") === "1";

  try {
    // Las métricas van con su propio catch: si fallaran, la bandeja se sigue
    // viendo (los KPIs quedan en "—") en vez de caerse entera.
    const metricsPromise: Promise<AffiliateSupportAdminMetrics | null> = wantsMetrics
      ? getAffiliateSupportAdminMetrics().catch(() => null)
      : Promise.resolve(null);
    const [rows, metrics] = await Promise.all([listAdminAffiliateTickets(filters), metricsPromise]);
    const tickets = rows ?? [];

    const payload: AdminAffiliateTicketsResponse = wantsMetrics ? { tickets, metrics } : { tickets };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof AffiliateSupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isSchemaDrift(err)) {
      console.warn("[admin/affiliate-support/tickets] SQL pendiente:", err);
      const payload: AdminAffiliateTicketsResponse = {
        tickets: [],
        metrics: null,
        sqlPending: true,
        sqlPendingMessage: SQL_PENDING_MESSAGE,
      };
      return NextResponse.json(payload);
    }
    console.error("GET /api/admin/affiliate-support/tickets error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
