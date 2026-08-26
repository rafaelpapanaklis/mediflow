export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/reportes — los números del negocio.
//
// Reemplaza el placeholder de la Ola 0 sin tocar el layout, el sidebar ni
// el contrato: el item del menú ya existía.
//
// 🔴 LA REJA DE ESTA PANTALLA NO ES COMO LAS DEMÁS. El item de menú pide
// SOLO `properties.view`, no tiene featureKey y está en TODOS los modos —
// y así debe ser: un asesor tiene que poder ver su embudo y un rentista su
// rendimiento. Pero con esa sola llave, un AGENT llegaría al resumen fiscal
// con el dinero completo de la cartera. Por eso aquí el permiso abre la
// PUERTA y cada bloque comprueba el SUYO (getReportAccess), y el servidor
// ni siquiera CONSULTA lo que el usuario no puede ver: esconder una
// pestaña no es control de acceso.
//
// i18n CONVENCIÓN B: aquí se RECORTA el sub-árbol y el cliente llama a
// makeRealtyT SIN prefijo. Este diccionario no se cuelga del barril de
// realty a propósito (ver la nota dentro de reports.json): ese archivo lo
// tocan varias terminales a la vez y sería un choque garantizado.
// ═══════════════════════════════════════════════════════════════════════

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { RealtyAreaDenied } from "@/components/realty/rentals/area-denied";
import {
  accountTimezone,
  getOperationsReport,
  getOwnerActivityReport,
  getPropertyEconomics,
  getReportAccess,
  getReportPickers,
  getTaxSummary,
  resolveRange,
} from "@/lib/realty/reports";
import {
  ReportsClient,
  type ReportTab,
} from "@/components/realty/reports/reports-client";
import reportsDict from "@/i18n/dictionaries/realty/reports.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "reportes";

export const metadata: Metadata = { title: "Reportes — DaleControl Inmuebles" };

const TABS: ReportTab[] = ["propietario", "cartera", "rentabilidad", "fiscal", "operacion"];

function pickTab(raw: unknown, fallback: ReportTab): ReportTab {
  return TABS.includes(raw as ReportTab) ? (raw as ReportTab) : fallback;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: {
    tab?: string;
    propertyId?: string;
    ownerId?: string;
    from?: string;
    to?: string;
    year?: string;
  };
}) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (reportsDict as unknown as Record<string, Dictionary>)[locale];

  const access = getReportAccess(ctx);
  if (!access.base) {
    return <RealtyAreaDenied kind="permission" title={(dict.title as string) ?? "Reportes"} />;
  }

  // La pestaña por omisión es la primera que este usuario SÍ puede ver: un
  // rentista sin prospectos no debe aterrizar en una pantalla vacía.
  const firstAllowed: ReportTab = access.activity
    ? "propietario"
    : access.portfolio
      ? "cartera"
      : access.tax
        ? "fiscal"
        : "operacion";
  const tab = pickTab(searchParams?.tab, firstAllowed);

  const range = resolveRange(ctx, searchParams?.from, searchParams?.to);
  const tz = accountTimezone(ctx);
  const currentYear = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(new Date()),
  );
  const yearRaw = Number(searchParams?.year);
  const year = Number.isInteger(yearRaw) && yearRaw > 2000 && yearRaw <= currentYear + 1
    ? yearRaw
    : currentYear;

  const propertyId = searchParams?.propertyId?.trim() || null;
  const ownerId = searchParams?.ownerId?.trim() || null;

  // Solo se consulta lo que la pestaña activa pinta Y el usuario puede ver.
  // Un reporte fiscal de un año entero sobre una cartera grande no es
  // barato: cargarlo para enseñar la pestaña de al lado sería regalar
  // segundos de espera en cada clic.
  const needsEconomics =
    (tab === "cartera" && access.portfolio) ||
    (tab === "rentabilidad" && access.profitability);

  const [pickers, ownerReport, portfolio, tax, operations] = await Promise.all([
    getReportPickers(ctx),
    tab === "propietario" && access.activity && propertyId
      ? getOwnerActivityReport(ctx, { propertyId, from: range.from, to: range.to })
      : Promise.resolve(null),
    needsEconomics
      ? getPropertyEconomics(ctx, { from: range.from, to: range.to, ownerId })
      : Promise.resolve(null),
    tab === "fiscal" && access.tax
      ? getTaxSummary(ctx, { year, ownerId })
      : Promise.resolve(null),
    tab === "operacion"
      ? getOperationsReport(ctx, { from: range.from, to: range.to })
      : Promise.resolve(null),
  ]);

  // El botón de WhatsApp solo se pinta si de verdad hay a quién mandarle:
  // un botón que siempre falla enseña a la gente a no confiar en el panel.
  let ownerHasPhone = false;
  if (ownerReport?.ownerId) {
    const owner = await prisma.realtyPropertyOwner.findFirst({
      where: { id: ownerReport.ownerId, accountId: ctx.accountId },
      select: { phone: true },
    });
    ownerHasPhone = Boolean(owner?.phone && owner.phone.trim() !== "");
  }

  return (
    <ReportsClient
      dict={dict}
      tab={tab}
      access={access}
      pickers={pickers}
      from={range.from}
      to={range.to}
      year={year}
      propertyId={propertyId}
      ownerId={ownerId}
      ownerReport={ownerReport}
      portfolio={portfolio}
      tax={tax}
      operations={operations}
      ownerHasPhone={ownerHasPhone}
      planHasWhatsapp={ctx.plan.features.whatsapp === true}
    />
  );
}
