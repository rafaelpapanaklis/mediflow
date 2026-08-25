"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircleOff, Undo2 } from "lucide-react";
import { apiCall, Banner, Btn, EmptyState, ErrorText, useSaving } from "../team/admin-ui";
import { formatDay, prettyPhone, useCampT } from "./ui";
import type { OptOutRow } from "./types";
import s from "./campanas.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Bajas: quién pidió que no le escriban.
//
// La baja se respeta en TODAS las listas por construcción — el motor la lee
// donde arma las audiencias, no cada pantalla por su lado. Aquí solo se ve
// y se revierte: que alguien se dé de baja por error es posible; que no se
// pueda arreglar, no.
// ═══════════════════════════════════════════════════════════════════════

export function OptOutsPanel({ locale, canEdit }: { locale: string; canEdit: boolean }) {
  const t = useCampT();
  const [rows, setRows] = useState<OptOutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { saving, error, run } = useSaving();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const payload = await apiCall<{ rows: OptOutRow[] }>("/api/barber/campaigns/optout");
      setRows(payload.rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function restore(row: OptOutRow) {
    setNote(null);
    void run(async () => {
      await apiCall("/api/barber/campaigns/optout", {
        method: "POST",
        json: { clientId: row.clientId, optOut: false },
      });
      setNote(t("optouts.restored", { name: row.name }));
      await load();
    });
  }

  const list = rows;

  return (
    <div className={s.optouts}>
      <header className={s.sectionHead}>
        <h2 className={s.sectionTitle}>{t("optouts.title")}</h2>
        <p className={s.sectionLead}>{t("optouts.lead")}</p>
      </header>

      {loadError ? <Banner tone="danger">{loadError}</Banner> : null}
      <ErrorText>{error}</ErrorText>
      {note ? <Banner>{note}</Banner> : null}

      {loading ? (
        <p className={s.loading}>{t("list.loading")}</p>
      ) : list.length === 0 ? (
        <EmptyState icon={<MessageCircleOff size={22} />} title={t("optouts.empty")} />
      ) : (
        <ul className={s.optoutList}>
          {list.map((row) => (
            <li key={row.clientId} className={s.optoutRow}>
              <div className={s.optoutMain}>
                <span className={s.targetName}>{row.name}</span>
                <span className={s.targetPhone}>{prettyPhone(row.phone)}</span>
              </div>
              <div className={s.optoutMeta}>
                <span>{t("optouts.since", { date: formatDay(row.optOut.at, locale) })}</span>
                <span className={s.optoutSource}>
                  {row.optOut.source === "client" ? t("optouts.bySelf") : t("optouts.byStaff")}
                </span>
              </div>
              {canEdit ? (
                <Btn size="sm" variant="ghost" disabled={saving} onClick={() => restore(row)}>
                  <Undo2 size={14} />
                  {t("optouts.restore")}
                </Btn>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
