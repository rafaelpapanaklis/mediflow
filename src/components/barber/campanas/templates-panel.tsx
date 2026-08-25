"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { apiCall, Banner, Btn, ErrorText, TextArea, TextInput, useSaving } from "../team/admin-ui";
import { useCampT } from "./ui";
import type {
  AudienceDef,
  CampaignAudienceId,
  CampaignConfigView,
  CampaignLimits,
} from "./types";
import s from "./campanas.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Los textos con los que la barbería le habla a sus clientes.
//
// QUÉ SE EDITA: la PROMOCIÓN, que es la variable {{3}} de las dos
// plantillas de marketing que Meta ya aprobó. El saludo y el nombre de la
// barbería viven en el cuerpo aprobado y no se tocan desde aquí — una
// plantilla nueva pasa por revisión de Meta, no por este formulario.
// ═══════════════════════════════════════════════════════════════════════

interface TemplatesPayload {
  cooldownDays: number;
  cooldownMin: number;
  cooldownMax: number;
  persisted: boolean;
  promoMax: number;
  tokens: string[];
  audiences: {
    id: CampaignAudienceId;
    templateName: string;
    templateBody: string;
    repeatAfterDays: number;
    promo: string;
    defaultPromo: string;
  }[];
}

export function TemplatesPanel({
  audiences,
  config,
  limits,
  canEdit,
}: {
  audiences: AudienceDef[];
  config: CampaignConfigView;
  limits: CampaignLimits;
  canEdit: boolean;
}) {
  const t = useCampT();
  const { saving, error, setError, run } = useSaving();
  const [data, setData] = useState<TemplatesPayload | null>(null);
  const [promos, setPromos] = useState<Record<string, string>>({ ...config.templates });
  const [cooldown, setCooldown] = useState(String(config.cooldownDays));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const payload = await apiCall<TemplatesPayload>("/api/barber/campaigns/templates");
        if (!alive) return;
        setData(payload);
        setPromos(Object.fromEntries(payload.audiences.map((a) => [a.id, a.promo])));
        setCooldown(String(payload.cooldownDays));
      } catch {
        // El servidor ya mandó la config en el primer render: si esta
        // relectura falla, la pantalla sigue usable con lo que llegó.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows =
    data?.audiences ??
    audiences.map((a) => ({
      id: a.id,
      templateName: "",
      templateBody: "",
      repeatAfterDays: a.repeatAfterDays,
      promo: config.templates[a.id] ?? "",
      defaultPromo: config.templates[a.id] ?? "",
    }));

  const persisted = data?.persisted ?? config.persisted;

  function save() {
    setSaved(false);
    setError(null);
    void run(async () => {
      const payload = await apiCall<TemplatesPayload>("/api/barber/campaigns/templates", {
        method: "PUT",
        json: { cooldownDays: Number(cooldown), templates: promos },
      });
      setData(payload);
      setPromos(Object.fromEntries(payload.audiences.map((a) => [a.id, a.promo])));
      setCooldown(String(payload.cooldownDays));
      setSaved(true);
    });
  }

  return (
    <div className={s.templates}>
      <header className={s.sectionHead}>
        <h2 className={s.sectionTitle}>{t("templates.title")}</h2>
        <p className={s.sectionLead}>{t("templates.lead")}</p>
      </header>

      {/* Que no se pueda guardar NO es un error del usuario: es que falta
          correr el SQL. Se dice tal cual, con el nombre del archivo. */}
      {!persisted ? <Banner tone="danger">{t("templates.sqlPending")}</Banner> : null}

      <div className={s.cooldown}>
        <label className={s.promoLabel} htmlFor="camp-cooldown">
          {t("templates.cooldown")}
        </label>
        <TextInput
          id="camp-cooldown"
          type="number"
          inputMode="numeric"
          min={data?.cooldownMin ?? 3}
          max={data?.cooldownMax ?? 180}
          value={cooldown}
          disabled={!canEdit}
          onChange={(e) => setCooldown(e.target.value)}
        />
        <p className={s.promoHelp}>{t("templates.cooldownHelp")}</p>
      </div>

      <ul className={s.templateList}>
        {rows.map((row) => (
          <li key={row.id} className={s.templateCard}>
            <div className={s.templateHead}>
              <div>
                <span className={s.templateName}>{t(`audiences.${row.id}.name`)}</span>
                <span className={s.templateMeta}>
                  {t("templates.repeatAfter", { days: row.repeatAfterDays })}
                </span>
              </div>
              <Btn
                size="sm"
                variant="ghost"
                disabled={!canEdit}
                onClick={() => setPromos((p) => ({ ...p, [row.id]: row.defaultPromo }))}
              >
                <RotateCcw size={14} />
                {t("templates.restore")}
              </Btn>
            </div>

            {row.templateBody ? (
              <p className={s.templateBody}>
                {row.templateBody.replace("{{3}}", promos[row.id] ?? row.promo)}
              </p>
            ) : null}

            <TextArea
              rows={2}
              maxLength={data?.promoMax ?? limits.promoMax}
              value={promos[row.id] ?? ""}
              disabled={!canEdit}
              onChange={(e) => setPromos((p) => ({ ...p, [row.id]: e.target.value }))}
            />
            {row.templateName ? (
              <span className={s.templateApproved}>
                {t("templates.approved")} · {row.templateName}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <ErrorText>{error}</ErrorText>
      {saved ? <Banner>{t("templates.saved")}</Banner> : null}

      {canEdit ? (
        <div className={s.sendRow}>
          <Btn variant="primary" onClick={save} disabled={saving}>
            <Save size={15} />
            {t("templates.save")}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
