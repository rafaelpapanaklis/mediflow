export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/rentas/[id] — un contrato completo.
//
// El contrato SIEMPRE se busca con el accountId de la sesión: uno de otra
// cuenta se ve exactamente igual que uno que no existe (notFound), sin
// filtrar si existía o no.
// ═══════════════════════════════════════════════════════════════════════

import { notFound, redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict, getRealtyT } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { getLeaseDetail, getStorageState } from "@/lib/realty/leases";
import { isCdmxProperty } from "@/lib/realty/inpc";
import { prisma } from "@/lib/prisma";
import {
  LeaseDetailClient,
  type LeaseDetailData,
} from "@/components/realty/rentals/lease-detail-client";
import { RealtyAreaDenied } from "@/components/realty/rentals/area-denied";

const AREA = "rentas";

export default async function Page({ params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const t = getRealtyT(ctx.account.locale);
  const dict = (getRealtyDict(ctx.account.locale).realty as Dictionary).rentals as Dictionary;

  if (ctx.plan.features.rentals !== true) {
    return <RealtyAreaDenied kind="plan" title={t("realty.shell.nav.rentas")} />;
  }
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "leases.manage")) {
    return <RealtyAreaDenied kind="permission" title={t("realty.shell.nav.rentas")} />;
  }

  const detail = await getLeaseDetail(ctx, params.id);
  if (!detail) notFound();

  const [properties, contacts, storage] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, title: true, city: true, state: true, rentPrice: true },
      orderBy: { title: "asc" },
      take: 500,
    }),
    prisma.realtyContact.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    getStorageState(ctx),
  ]);

  const lease: LeaseDetailData = {
    id: detail.id,
    propertyId: detail.propertyId,
    propertyTitle: detail.propertyTitle,
    propertyCity: detail.propertyCity,
    tenantName: detail.tenantName,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    rentAmount: detail.rentAmount,
    currency: detail.currency,
    paymentDay: detail.paymentDay,
    depositAmount: detail.depositAmount,
    increaseRule: detail.increaseRule,
    increasePct: detail.increasePct,
    status: detail.status,
    signedDocUrl: detail.signedDocUrl,
    notes: detail.notes,
    daysToEnd: detail.daysToEnd,
    balance: detail.balance,
    overdueCount: detail.overdueCount,
    chargeCount: detail.chargeCount,
    cdmx: detail.cdmx,
    parties: detail.parties.map((p) => ({
      id: p.id,
      role: p.role,
      contactName: p.contactName,
      contactPhone: p.contactPhone,
      contactEmail: p.contactEmail,
      screeningStatus: p.screeningStatus,
    })),
    charges: detail.charges.map((c) => ({
      id: c.id,
      periodMonth: c.periodMonth,
      periodLabel: c.periodLabel,
      dueAt: c.dueAt,
      amount: c.amount,
      paid: c.paid,
      balance: c.balance,
      status: c.status,
      daysLate: c.daysLate,
    })),
    payments: detail.payments.map((p) => ({
      id: p.id,
      chargeId: p.chargeId,
      amount: p.amount,
      method: p.method,
      paidAt: p.paidAt,
      reference: p.reference,
      receiptFolio: p.receiptFolio,
      receiptUrl: p.receiptUrl,
    })),
    deposits: detail.deposits.map((d) => ({
      id: d.id,
      amount: d.amount,
      status: d.status,
      resolvedAt: d.resolvedAt,
      note: d.note,
    })),
  };

  return (
    <LeaseDetailClient
      dict={dict}
      lease={lease}
      timezone={ctx.account.timezone}
      storageUsedBytes={storage.usedBytes}
      storageQuotaMb={ctx.plan.storageQuotaMb}
      canEdit={hasRealtyPermission(permUser, "leases.manage")}
      canCollect={hasRealtyPermission(permUser, "payments.manage")}
      properties={properties.map((p) => ({
        id: p.id,
        title: p.title,
        city: p.city,
        rentPrice: p.rentPrice === null ? null : Number(p.rentPrice),
        cdmx: isCdmxProperty({ city: p.city, state: p.state }),
      }))}
      contacts={contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
    />
  );
}
