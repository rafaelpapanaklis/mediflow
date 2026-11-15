"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquareReply } from "lucide-react";
import { Banner, Btn, ErrorText, Field, SwitchRow, TextArea, apiCall, useSaving } from "../team/admin-ui";
import {
  BARBER_WA_ACK_DEFAULT_TEXT,
  BARBER_WA_ACK_TEXT_MAX,
  barberWaAckText,
  cleanBarberWaAckText,
  type BarberWaAckSettings,
} from "@/lib/barber/wa-acuse-core";
import { useWaT } from "./ui";
import s from "./whatsapp.module.css";

/**
 * «Contestar en automático cuando un cliente responde a un recordatorio».
 *
 * APAGADO por defecto (decisión de Rafael, 15-nov-2026, #7). Encendido, y
 * solo si nadie —ni la barbería ni el bot— atendió el mensaje, el cliente
 * recibe UNA vez por conversación al día el texto de aquí abajo. Las reglas
 * viven en src/lib/barber/wa-acuse-core.ts; esta tarjeta solo las cuenta.
 */
export function AcusePanel({
  initial,
  storageReady,
  canEdit,
}: {
  initial: BarberWaAckSettings;
  /** false = falta pegar sql/barber_wa_acuse.sql: se ve, no se guarda. */
  storageReady: boolean;
  canEdit: boolean;
}) {
  const t = useWaT();
  const { saving, error, run } = useSaving();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [message, setMessage] = useState(initial.message ?? "");
  const [saved, setSaved] = useState<BarberWaAckSettings>(initial);
  const [justSaved, setJustSaved] = useState(false);

  const draft: BarberWaAckSettings = { enabled, message: cleanBarberWaAckText(message) };
  const dirty = draft.enabled !== saved.enabled || draft.message !== saved.message;
  const locked = !canEdit || !storageReady;

  function save() {
    setJustSaved(false);
    void run(async () => {
      const res = await apiCall<{ ok: true; settings: BarberWaAckSettings }>("/api/barber/whatsapp/acuse", {
        method: "PATCH",
        json: draft,
      });
      setSaved(res.settings);
      setEnabled(res.settings.enabled);
      setMessage(res.settings.message ?? "");
      setJustSaved(true);
    });
  }

  return (
    <div className={s.cards}>
      <section className={[s.card, s.cardWide].join(" ")}>
        <h2 className={s.cardTitle}>
          <MessageSquareReply size={15} style={{ verticalAlign: "-2px", marginInlineEnd: 6 }} aria-hidden="true" />
          {t("acuse.title")}
        </h2>
        <p className={s.cardLead}>{t("acuse.lead")}</p>

        {!storageReady ? (
          <Banner tone="danger" icon={<AlertTriangle size={16} />}>
            {t("acuse.storageMissing")}
          </Banner>
        ) : null}

        <SwitchRow
          title={t("acuse.switch")}
          hint={enabled ? t("acuse.switchOn") : t("acuse.switchOff")}
          checked={enabled}
          onChange={(next) => {
            setEnabled(next);
            setJustSaved(false);
          }}
          disabled={locked || saving}
        />

        <Field label={t("acuse.textLabel")} hint={t("acuse.textHint", { max: BARBER_WA_ACK_TEXT_MAX })} full>
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              maxLength={BARBER_WA_ACK_TEXT_MAX}
              placeholder={BARBER_WA_ACK_DEFAULT_TEXT}
              value={message}
              disabled={locked || saving}
              onChange={(e) => {
                setMessage(e.target.value);
                setJustSaved(false);
              }}
            />
          )}
        </Field>

        <ul className={s.cardLead} style={{ margin: 0, paddingInlineStart: 18 }}>
          <li>{t("acuse.rules.onlyUnanswered")}</li>
          <li>{t("acuse.rules.oncePerDay")}</li>
          <li>{t("acuse.rules.quota")}</li>
        </ul>

        <p className={s.tplMeta}>
          {t("acuse.preview")}: «{barberWaAckText(draft)}»
        </p>

        {canEdit ? (
          <div className={s.rowActions}>
            <Btn onClick={save} disabled={locked || saving || !dirty}>
              {saving ? t("acuse.saving") : t("acuse.save")}
            </Btn>
            {justSaved && !dirty ? (
              <span className={s.tplMeta}>
                <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginInlineEnd: 4 }} aria-hidden="true" />
                {t("acuse.saved")}
              </span>
            ) : null}
          </div>
        ) : (
          <p className={s.tplMeta}>{t("acuse.readOnly")}</p>
        )}

        <ErrorText>{error}</ErrorText>
      </section>
    </div>
  );
}
