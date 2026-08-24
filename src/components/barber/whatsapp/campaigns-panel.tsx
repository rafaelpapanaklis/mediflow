"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Cake, Send, UserRoundX } from "lucide-react";
import { apiCall, Banner, Btn, ErrorText, useSaving } from "../team/admin-ui";
import { useWaT } from "./ui";
import s from "./whatsapp.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Campañas de cumpleaños e "te extrañamos".
//
// SON DE MARKETING y por eso NUNCA se mandan solas: cuestan ~4x que un
// recordatorio de utilidad y el cliente puede bloquear ese tipo de mensajes
// en WhatsApp. La barbería ve a cuánta gente le va a escribir y CUÁNTO LE VA
// A COSTAR antes de apretar nada.
//
// Las listas salen de la ola de clientes (T2): cumpleañeros del mes y
// clientes que no han vuelto en los días que la barbería configuró.
// ═══════════════════════════════════════════════════════════════════════

type Kind = "birthday" | "winback";

interface Preview {
  kind: Kind;
  recipients: { clientId: string; name: string; phone: string }[];
  batchMax: number;
  templateName: string;
  templateStatus: string;
  estimatedUsd: number;
  unitUsd: number;
}

export function CampaignsPanel({ canSend }: { canSend: boolean }) {
  const t = useWaT();
  return (
    <div className={s.page}>
      <p className={s.cardLead}>{t("campaign.lead")}</p>
      <div className={s.campaignGrid}>
        <CampaignCard kind="birthday" canSend={canSend} icon={<Cake size={16} />} />
        <CampaignCard kind="winback" canSend={canSend} icon={<UserRoundX size={16} />} />
      </div>
    </div>
  );
}

function CampaignCard({
  kind,
  canSend,
  icon,
}: {
  kind: Kind;
  canSend: boolean;
  icon: React.ReactNode;
}) {
  const t = useWaT();
  const { saving, error, run } = useSaving();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [promo, setPromo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPreview(await apiCall<Preview>(`/api/barber/whatsapp/campaign?kind=${kind}`));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("errors.generic"));
    }
  }, [kind, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function send() {
    if (!preview) return;
    setNote(null);
    void run(async () => {
      const result = await apiCall<{ sent: number; failed: number; skipped: number }>(
        "/api/barber/whatsapp/campaign",
        {
          method: "POST",
          json: { kind, promo, clientIds: preview.recipients.map((r) => r.clientId) },
        },
      );
      setNote(t("campaign.sent", { sent: result.sent, failed: result.failed }));
      await load();
    });
  }

  const count = preview?.recipients.length ?? 0;
  const approved = preview?.templateStatus === "APPROVED";

  return (
    <section className={s.card}>
      <h3 className={s.cardTitle}>
        {icon} {t(`campaign.${kind}`)}
      </h3>

      {loadError ? <ErrorText>{loadError}</ErrorText> : null}

      <p className={s.cardLead}>{t("campaign.recipients", { count })}</p>

      {count > 0 ? (
        <div className={s.cost}>
          {t("campaign.estimated", {
            usd: (preview?.estimatedUsd ?? 0).toFixed(2),
            unit: (preview?.unitUsd ?? 0).toFixed(4),
          })}
        </div>
      ) : (
        <p className={s.tplMeta}>{t("campaign.none")}</p>
      )}

      {preview && !approved ? (
        <Banner tone="danger" icon={<AlertTriangle size={16} />}>
          {t("campaign.templateMissing")}
        </Banner>
      ) : null}

      {canSend && count > 0 && approved ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{t("campaign.promoLabel")}</span>
            <input
              className={s.composerInput}
              style={{ minHeight: 0 }}
              value={promo}
              maxLength={300}
              onChange={(e) => setPromo(e.target.value)}
              placeholder={t("campaign.promoPlaceholder")}
            />
            <span className={s.tplMeta}>{t("campaign.promoHint")}</span>
          </label>

          <div className={s.rowActions}>
            <Btn variant="primary" onClick={send} disabled={saving}>
              <Send size={15} />
              {saving
                ? t("campaign.sending")
                : t("campaign.send", { count: Math.min(count, preview?.batchMax ?? count) })}
            </Btn>
            {note ? <span className={s.tplMeta}>{note}</span> : null}
          </div>

          {count > (preview?.batchMax ?? count) ? (
            <p className={s.tplMeta}>{t("campaign.batch", { max: preview?.batchMax })}</p>
          ) : null}
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
    </section>
  );
}
