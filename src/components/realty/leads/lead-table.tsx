"use client";

import Link from "next/link";
import type { TFunction } from "@/i18n/t";
import { REALTY_LEAD_STAGE_UI } from "@/lib/realty/types";
import type { RealtyLeadCardDTO } from "@/lib/realty/leads";
import {
  budgetRange,
  contactHeat,
  heatLabel,
  prettyPhone,
  shortDate,
  sourceLabel,
  type RealtyTone,
} from "./lead-ui";
import { Chip, HeatBadge } from "./lead-bits";

/**
 * Vista de tabla — la alterna del tablero.
 *
 * No es un lujo: el tablero sirve para MOVER y la tabla para BUSCAR. Con 300
 * prospectos, "¿quién lleva más tiempo sin contacto?" se contesta de un
 * vistazo aquí y no arrastrando columnas.
 */
export function LeadTable({
  leads,
  t,
  now,
  locale,
}: {
  leads: RealtyLeadCardDTO[];
  t: TFunction;
  now: number;
  locale: string;
}) {
  if (leads.length === 0) {
    return (
      <div className="lead-panel">
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)" }}>{t("table.empty")}</p>
      </div>
    );
  }

  return (
    <div className="lead-table-wrap">
      <table className="lead-table">
        <thead>
          <tr>
            <th scope="col">{t("table.name")}</th>
            <th scope="col">{t("table.stage")}</th>
            <th scope="col">{t("table.lastContact")}</th>
            <th scope="col">{t("table.budget")}</th>
            <th scope="col">{t("table.wants")}</th>
            <th scope="col">{t("table.property")}</th>
            <th scope="col">{t("table.agent")}</th>
            <th scope="col">{t("table.source")}</th>
            <th scope="col">{t("table.created")}</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const heat = contactHeat(lead, now);
            const ui = REALTY_LEAD_STAGE_UI[lead.stage];
            return (
              <tr key={lead.id}>
                <td>
                  <Link
                    href={`/inmobiliaria/prospectos/${lead.id}`}
                    style={{ color: "var(--text-1)", fontWeight: 600, textDecoration: "none" }}
                  >
                    {lead.contactName}
                  </Link>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                    {prettyPhone(lead.contactPhone) ?? t("card.noPhone")}
                  </div>
                </td>
                <td>
                  <Chip tone={ui.tone as RealtyTone}>{t(`stages.${lead.stage}`)}</Chip>
                </td>
                <td>
                  <HeatBadge
                    heat={heat.heat}
                    label={heatLabel(heat, t)}
                    never={heat.neverContacted && heat.heat !== "NEUTRO"}
                    neverLabel={t("heat.neverShort")}
                  />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {budgetRange(lead.budgetMin, lead.budgetMax, "—")}
                </td>
                <td style={{ color: "var(--text-2)", maxWidth: 200 }}>
                  <span className="lead-truncate" style={{ display: "block" }}>
                    {lead.wants ?? "—"}
                  </span>
                </td>
                <td style={{ color: "var(--text-2)", maxWidth: 180 }}>
                  <span className="lead-truncate" style={{ display: "block" }}>
                    {lead.propertyTitle ?? "—"}
                  </span>
                </td>
                <td style={{ color: lead.assignedUserName ? "var(--text-2)" : "var(--text-4)" }}>
                  {lead.assignedUserName ?? t("card.noAgent")}
                </td>
                <td style={{ color: "var(--text-3)" }}>
                  {sourceLabel(lead.source, lead.portal) ?? "—"}
                </td>
                <td style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>
                  {shortDate(lead.createdAt, locale)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
