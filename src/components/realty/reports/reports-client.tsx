"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/reportes — la carcasa.
//
// Cinco pestañas y un solo estado: la URL. Cambiar de inmueble, de
// propietario, de año o de fechas empuja searchParams y el servidor vuelve
// a consultar. Sin fetch en el cliente, sin estados de carga a mano y —lo
// que de verdad importa— con una liga que se puede copiar, guardar en
// favoritos y mandar por WhatsApp: un reporte que solo existe dentro de un
// useState no se puede compartir, y compartir es todo el punto de esta
// pantalla.
//
// Solo se pinta la pestaña que el usuario puede ver. Y la que puede ver la
// decide el SERVIDOR (getReportAccess): esconder una pestaña no es control
// de acceso, así que el servidor tampoco carga los datos que no tocan.
//
// i18n CONVENCIÓN B: el servidor baja el sub-árbol YA recortado y aquí
// makeRealtyT va SIN prefijo. Cruzar las dos convenciones es el bug que
// pinta la llave cruda en pantalla.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import type {
  OperationsReport,
  OwnerReportSchedule,
  PortfolioReport,
  ReportAccess,
  ReportPickers,
  TaxSummary,
} from "@/lib/realty/reports";
import type { OwnerActivityReport } from "@/lib/realty/owner-report";
import { Card, EmptyState, Tabs } from "../rentals/ui";
import { OwnerReportPanel } from "./owner-report-panel";
import { PortfolioPanel } from "./portfolio-panel";
import { TaxPanel } from "./tax-panel";
import { OperationsPanel } from "./operations-panel";
import "../rentals/rentals.css";
import "./reports.css";

export type ReportTab = "propietario" | "cartera" | "fiscal" | "rentabilidad" | "operacion";

export interface ReportsClientProps {
  dict: Dictionary;
  tab: ReportTab;
  access: ReportAccess;
  pickers: ReportPickers;
  from: string;
  to: string;
  year: number;
  propertyId: string | null;
  ownerId: string | null;
  ownerReport: OwnerActivityReport | null;
  portfolio: PortfolioReport | null;
  tax: TaxSummary | null;
  operations: OperationsReport | null;
  /** Por dónde le llega al propietario y si le sale solo. null = sin inmueble. */
  schedule: OwnerReportSchedule | null;
}

export function ReportsClient(props: ReportsClientProps) {
  const {
    dict,
    tab,
    access,
    pickers,
    from,
    to,
    year,
    propertyId,
    ownerId,
    ownerReport,
    portfolio,
    tax,
    operations,
    schedule,
  } = props;

  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const router = useRouter();
  const search = useSearchParams();

  /**
   * Empuja searchParams conservando lo que ya había. Un `null` BORRA la
   * llave: sin eso, quitar el filtro de propietario dejaba `ownerId=` vacío
   * en la URL y el servidor lo leía como un id que no existe.
   */
  const navigate = useCallback(
    (params: Record<string, string | null>) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      for (const [k, v] of Object.entries(params)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.push(`/inmobiliaria/reportes?${next.toString()}`);
    },
    [router, search],
  );

  const tabs: Array<{ key: ReportTab; label: string; show: boolean }> = [
    { key: "propietario", label: t("tabs.propietario"), show: access.activity },
    { key: "cartera", label: t("tabs.cartera"), show: access.portfolio },
    { key: "rentabilidad", label: t("tabs.rentabilidad"), show: access.profitability },
    { key: "fiscal", label: t("tabs.fiscal"), show: access.tax },
    {
      key: "operacion",
      label: t("tabs.operacion"),
      show: access.funnel || access.collections || access.commissions,
    },
  ];
  const visible = tabs.filter((x) => x.show);

  return (
    <div className="rnt">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{t("title")}</h1>
            <p className="rnt-head__sub">{t("subtitle")}</p>
          </div>
        </div>
        {visible.length > 0 ? (
          <Tabs
            tabs={visible.map((x) => ({ key: x.key, label: x.label }))}
            value={tab}
            onChange={(key) => navigate({ tab: key })}
            label={t("title")}
          />
        ) : null}
      </header>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title={t("acceso.sinPermisoTitulo")}
            body={`${t("acceso.sinPermisoBloque")} ${t("acceso.pideloA")}`}
          />
        </Card>
      ) : null}

      {tab === "propietario" && access.activity ? (
        <OwnerReportPanel
          t={t}
          report={ownerReport}
          properties={pickers.properties}
          selectedId={propertyId}
          from={from}
          to={to}
          schedule={schedule}
          // El permiso de MANDAR sale del servidor, igual que la ruta que
          // ese botón llama: dos criterios distintos acaban en un botón que
          // se pinta y una ruta que contesta 403.
          canWhatsapp={access.sendWhatsapp && (schedule?.ownerHasPhone ?? false)}
          onNavigate={navigate}
        />
      ) : null}

      {tab === "cartera" && access.portfolio && portfolio ? (
        <PortfolioPanel
          t={t}
          variant="cartera"
          report={portfolio}
          owners={pickers.owners}
          ownerId={ownerId}
          from={from}
          to={to}
          onNavigate={navigate}
        />
      ) : null}

      {tab === "rentabilidad" && access.profitability && portfolio ? (
        <PortfolioPanel
          t={t}
          variant="rentabilidad"
          report={portfolio}
          owners={pickers.owners}
          ownerId={ownerId}
          from={from}
          to={to}
          onNavigate={navigate}
        />
      ) : null}

      {tab === "fiscal" && access.tax && tax ? (
        <TaxPanel
          t={t}
          report={tax}
          owners={pickers.owners}
          years={pickers.years}
          onNavigate={navigate}
        />
      ) : null}

      {tab === "operacion" && operations ? (
        <OperationsPanel
          t={t}
          report={operations}
          from={from}
          to={to}
          onNavigate={navigate}
        />
      ) : null}
    </div>
  );
}
