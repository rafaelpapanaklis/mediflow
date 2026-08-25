export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/cobranza — el tablero del mes, los recordatorios, la
// bandeja de mantenimiento y los gastos del inmueble.
//
// Mismas tres rejas que /rentas (modo → plan → permiso) y todas comprobadas
// AQUÍ, no solo escondiendo el item del menú.
//
// i18n CONVENCIÓN B: se recorta el sub-árbol y el cliente NO prefija.
// ═══════════════════════════════════════════════════════════════════════

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict, getRealtyT } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { prisma } from "@/lib/prisma";
import {
  buildRentNoticeQueue,
  getCollectionsBoard,
  listExpenses,
  listMaintenance,
} from "@/lib/realty/leases";
import { todayInTimezone } from "@/lib/realty/rent-charges";
import {
  CollectionsClient,
  type CollectionRowView,
  type NoticePreview,
} from "@/components/realty/rentals/collections-client";
import { RealtyAreaDenied } from "@/components/realty/rentals/area-denied";

const AREA = "cobranza";

export default async function Page({
  searchParams,
}: {
  searchParams?: { periodo?: string };
}) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const t = getRealtyT(ctx.account.locale);
  const dict = (getRealtyDict(ctx.account.locale).realty as Dictionary).rentals as Dictionary;

  if (ctx.plan.features.rentals !== true) {
    return <RealtyAreaDenied kind="plan" title={t("realty.shell.nav.cobranza")} />;
  }
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "payments.manage")) {
    return <RealtyAreaDenied kind="permission" title={t("realty.shell.nav.cobranza")} />;
  }

  const canMaintain =
    ctx.plan.features.maintenance === true && hasRealtyPermission(permUser, "maintenance.manage");
  const canExpenses = hasRealtyPermission(permUser, "expenses.manage");

  const today = todayInTimezone(ctx.account.timezone);
  const planHasWhatsapp = ctx.plan.features.whatsapp === true;

  const [board, notices, maintenance, expenses, properties] = await Promise.all([
    getCollectionsBoard(ctx, { periodMonth: searchParams?.periodo }),
    buildRentNoticeQueue({
      accountId: ctx.accountId,
      accountName: ctx.account.name,
      timezone: ctx.account.timezone,
      planHasWhatsapp,
      today,
    }),
    canMaintain ? listMaintenance(ctx, {}) : Promise.resolve([]),
    canExpenses
      ? listExpenses(ctx, {})
      : Promise.resolve({ rows: [], totalCents: 0, byKind: {} }),
    prisma.realtyProperty.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take: 500,
    }),
  ]);

  const rows: CollectionRowView[] = board.rows.map((r) => ({
    id: r.id,
    leaseId: r.leaseId,
    propertyId: r.propertyId,
    propertyTitle: r.propertyTitle,
    tenantName: r.tenantName,
    tenantPhone: r.tenantPhone,
    periodMonth: r.periodMonth,
    periodLabel: r.periodLabel,
    dueAt: r.dueAt,
    amount: r.amount,
    paid: r.paid,
    balance: r.balance,
    status: r.status,
    daysLate: r.daysLate,
    aging: r.aging,
    currency: r.currency,
  }));

  // Al navegador va SOLO lo que la pantalla pinta. El mensaje ya redactado y
  // el teléfono del inquilino se quedan en el servidor: esta vista es un
  // resumen de la cola, no la cola entera.
  const noticeRows: NoticePreview[] = notices.map((n) => ({
    key: n.key,
    contactName: n.contactName,
    propertyTitle: n.propertyTitle,
    periodLabel: n.periodLabel,
    step: n.step,
    tone: n.tone,
    balanceCents: n.balanceCents,
    currency: n.currency,
    channels: n.channels,
    hasEmail: Boolean(n.contactEmail),
  }));

  return (
    <CollectionsClient
      dict={dict}
      periodMonth={board.periodMonth}
      rows={rows}
      totals={board.totals}
      notices={noticeRows}
      maintenance={maintenance}
      expenses={{ rows: expenses.rows, totalCents: expenses.totalCents }}
      properties={properties}
      planHasWhatsapp={planHasWhatsapp}
      todayISO={today.toISOString().slice(0, 10)}
      canCollect={hasRealtyPermission(permUser, "payments.manage")}
      canMaintain={canMaintain}
      canExpenses={canExpenses}
    />
  );
}
