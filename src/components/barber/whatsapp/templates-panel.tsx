"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { apiCall, Banner, Btn, Chip, ErrorText, useSaving } from "../team/admin-ui";
import type { BarberWaKind } from "@/lib/barber/whatsapp-core";
import { useWaT } from "./ui";
import {
  barberTemplateRejection,
  barberTemplateRejectionKey,
  explainBarberTemplateFailure,
  type BarberTemplateFailure,
} from "@/lib/barber/wa-plantillas-core";

/** Lo que se enseña de una plantilla que Meta no dejó dar de alta. */
interface ShownFailure {
  kind: BarberWaKind;
  key: string;
  raw: string;
}
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
  // Por nombre de plantilla: por qué no se pudo dar de alta en el último intento.
  const [failures, setFailures] = useState<Record<string, ShownFailure>>({});

  function provision() {
    setNote(null);
    void run(async () => {
      const result = await apiCall<{
        ok: boolean;
        reason?: string;
        created: string[];
        failed: Array<BarberTemplateFailure & { error: string; kind: BarberWaKind }>;
      }>("/api/barber/whatsapp/templates", {
        method: "POST",
        json: { includeMarketing },
      });
      const next: Record<string, ShownFailure> = {};
      for (const f of result.failed) {
        const ex = explainBarberTemplateFailure(f);
        next[f.name] = { kind: f.kind, key: `templates.failure.${ex.key}`, raw: ex.raw || f.error };
      }
      setFailures(next);
      if (!result.ok && result.reason) {
        setNote(result.reason);
      } else if (result.failed.length > 0) {
        setNote(
          t("templates.failed", {
            names: result.failed.map((f) => t(`templates.kind.${f.kind}`)).join(", "),
          }),
        );
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
                {(() => {
                  // Solo un rechazo real, traducido (nunca «NONE» en crudo).
                  const code = barberTemplateRejection(row.status, row.reason);
                  return code ? (
                    <p className={s.tplReason}>{t(barberTemplateRejectionKey(code), { code })}</p>
                  ) : null;
                })()}
                {/* No se pudo dar de alta: por qué, entendible, y lo que dijo Meta en pequeño. */}
                {row.status === "MISSING" && failures[row.name] ? (
                  <>
                    <p className={s.tplReason} role="alert">
                      {t(failures[row.name].key)}
                    </p>
                    {failures[row.name].raw ? (
                      <p className={s.tplMeta} style={{ margin: "2px 0 0", overflowWrap: "anywhere" }}>
                        {t("templates.failure.metaSaid")}: {failures[row.name].raw}
                      </p>
                    ) : null}
                  </>
                ) : null}
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
              {note && Object.keys(failures).length === 0 ? <span className={s.tplMeta}>{note}</span> : null}
            </div>
            {/* El aviso queda JUNTO al botón, a la vista, con el motivo de cada una. */}
            {Object.keys(failures).length > 0 ? (
              <Banner tone="danger" icon={<AlertTriangle size={16} />}>
                <div>
                  <strong>{note}</strong>
                  <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                    {Object.entries(failures).map(([name, f]) => (
                      <li key={name}>
                        {t(`templates.kind.${f.kind}`)}: {t(f.key)}
                      </li>
                    ))}
                  </ul>
                </div>
              </Banner>
            ) : null}
          </>
        ) : null}

        <ErrorText>{error}</ErrorText>
      </section>
    </div>
  );
}
