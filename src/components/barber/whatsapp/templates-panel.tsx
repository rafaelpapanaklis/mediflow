"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { apiCall, Banner, Btn, Chip, ErrorText, useSaving } from "../team/admin-ui";
import type { BarberWaKind } from "@/lib/barber/whatsapp-core";
import { useWaT } from "./ui";
import s from "./whatsapp.module.css";

export interface TemplateRow {
  kind: BarberWaKind;
  name: string;
  category: string;
  status: string;
  reason: string | null;
  optional: boolean;
}

/**
 * Plantillas de la barbería DENTRO de su propia cuenta de WhatsApp.
 *
 * El estado se lee de Meta EN VIVO (no se guarda en ningún lado): así nunca
 * se queda desfasado, que es justo lo que le pasa al dental cuando se pierde
 * el webhook de revisión.
 *
 * Las de PROMOCIÓN son opcionales y se activan con una casilla explícita:
 * cuestan ~4x que un recordatorio y el cliente puede bloquearlas.
 */
export function TemplatesPanel({
  initial,
  reason,
  canEdit,
  onChanged,
}: {
  initial: TemplateRow[];
  reason: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const t = useWaT();
  const { saving, error, run } = useSaving();
  const [includeMarketing, setIncludeMarketing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function provision() {
    setNote(null);
    void run(async () => {
      const result = await apiCall<{
        ok: boolean;
        reason?: string;
        created: string[];
        failed: { name: string; error: string }[];
      }>("/api/barber/whatsapp/templates", {
        method: "POST",
        json: { includeMarketing },
      });
      if (result.failed.length > 0) {
        setNote(t("templates.failed", { names: result.failed.map((f) => f.name).join(", ") }));
      } else {
        setNote(
          result.created.length > 0
            ? t("templates.created", { count: result.created.length })
            : t("templates.noneNeeded"),
        );
      }
      onChanged();
    });
  }

  return (
    <div className={s.cards}>
      <section className={[s.card, s.cardWide].join(" ")}>
        <h2 className={s.cardTitle}>{t("templates.title")}</h2>
        <p className={s.cardLead}>{t("templates.lead")}</p>

        {reason ? (
          <Banner tone="danger" icon={<AlertTriangle size={16} />}>
            {reason}
          </Banner>
        ) : null}

        <div className={s.tplList}>
          {initial.map((row) => (
            <div key={row.name} className={s.tplRow}>
              <div style={{ minWidth: 0 }}>
                <div className={s.tplName}>{t(`templates.kind.${row.kind}`)}</div>
                <div className={s.tplMeta}>
                  {row.name} · {t(`templates.category.${row.category}`)}
                </div>
                {row.reason ? <p className={s.tplReason}>{row.reason}</p> : null}
              </div>
              <Chip
                tone={
                  row.status === "APPROVED"
                    ? "brand"
                    : row.status === "REJECTED"
                      ? "danger"
                      : row.status === "PENDING"
                        ? "warn"
                        : "muted"
                }
              >
                {t(`templates.status.${row.status}`) || row.status}
              </Chip>
            </div>
          ))}
        </div>

        {canEdit ? (
          <>
            <label
              style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={includeMarketing}
                onChange={(e) => setIncludeMarketing(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                {t("templates.includeMarketing")}
                <span className={s.tplMeta} style={{ display: "block" }}>
                  {t("templates.marketingWarn")}
                </span>
              </span>
            </label>

            <div className={s.rowActions}>
              <Btn variant="primary" onClick={provision} disabled={saving}>
                <RefreshCw size={15} />
                {saving ? t("templates.provisioning") : t("templates.provision")}
              </Btn>
              {note ? <span className={s.tplMeta}>{note}</span> : null}
            </div>
          </>
        ) : null}

        <ErrorText>{error}</ErrorText>
      </section>
    </div>
  );
}
