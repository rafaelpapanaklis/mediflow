"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Banner, EmptyState } from "../team/admin-ui";
import { apiCall } from "../team/admin-ui";
import { formatDay, formatUsd, useCampT } from "./ui";
import type { HistoryPayload } from "./types";
import s from "./campanas.module.css";

// ═══════════════════════════════════════════════════════════════════════
// El recibo: a quién se le mandó, cuándo, cuánto costó y QUIÉN VOLVIÓ.
//
// La última columna es la razón de existir de esta pestaña. Sin ella el
// dueño no sabe si la campaña sirvió — y entonces no hay motivo para volver
// a gastar en la siguiente.
//
// "Volvió" = tuvo una visita DESPUÉS de recibir el mensaje. No es una
// atribución fina (no se puede saber si volvió POR el mensaje), y por eso
// la pantalla lo dice con esas palabras y no habla de "conversión".
// ═══════════════════════════════════════════════════════════════════════

export function ResultsPanel({ locale }: { locale: string }) {
  const t = useCampT();
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const payload = await apiCall<HistoryPayload>("/api/barber/campaigns/history");
        if (alive) setData(payload);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : t("errors.generic"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [t]);

  if (loading) return <p className={s.loading}>{t("list.loading")}</p>;
  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!data || data.rows.length === 0) {
    return <EmptyState icon={<TrendingUp size={22} />} title={t("results.empty")} />;
  }

  const rate =
    data.totals.delivered > 0
      ? Math.round((data.totals.returned / data.totals.delivered) * 100)
      : 0;

  return (
    <div className={s.results}>
      <header className={s.sectionHead}>
        <h2 className={s.sectionTitle}>{t("results.title")}</h2>
        <p className={s.sectionLead}>{t("results.lead", { days: data.windowDays })}</p>
      </header>

      <div className={s.totals}>
        <Stat label={t("results.columns.sent")} value={String(data.totals.messages)} />
        <Stat label={t("results.columns.cost")} value={formatUsd(data.totals.costUsd)} />
        <Stat
          label={t("results.columns.returned")}
          value={String(data.totals.returned)}
          hint={t("results.returnRate", { pct: rate })}
          strong
        />
      </div>

      <p className={s.skipNote}>{t("results.returnedHelp")}</p>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">{t("results.columns.day")}</th>
              <th scope="col">{t("results.columns.campaign")}</th>
              <th scope="col" className={s.num}>
                {t("results.columns.sent")}
              </th>
              <th scope="col" className={s.num}>
                {t("results.columns.failed")}
              </th>
              <th scope="col" className={s.num}>
                {t("results.columns.cost")}
              </th>
              <th scope="col" className={s.num}>
                {t("results.columns.returned")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.day}|${row.templateName}`}>
                <td>{formatDay(`${row.day}T12:00:00.000Z`, locale)}</td>
                <td className={s.tplCell}>{row.templateName}</td>
                <td className={s.num}>{row.messages}</td>
                <td className={s.num}>{row.failed || ""}</td>
                <td className={s.num}>{formatUsd(row.costUsd)}</td>
                <td className={[s.num, s.returned].join(" ")}>{row.returned}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                {t("results.totals")}
              </th>
              <td className={s.num}>{data.totals.messages}</td>
              <td className={s.num}>{data.totals.failed || ""}</td>
              <td className={s.num}>{formatUsd(data.totals.costUsd)}</td>
              <td className={[s.num, s.returned].join(" ")}>{data.totals.returned}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className={[s.stat, strong ? s.statStrong : ""].filter(Boolean).join(" ")}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
      {hint ? <span className={s.statHint}>{hint}</span> : null}
    </div>
  );
}
