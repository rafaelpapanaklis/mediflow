"use client";

// Configuración → WhatsApp → Plantillas (M-09).
//
// Aquí la clínica registra el NOMBRE EXACTO con el que Meta le aprobó cada
// plantilla. La pantalla existe porque el modelo de negocio no deja otra
// opción: la cuenta de WhatsApp es de la clínica y Meta le cobra a ELLA cada
// plantilla, así que DaleControl no puede darlas de alta por ella. Lo que sí
// puede es dictarle el texto EXACTO que debe registrar —los datos se sustituyen
// por posición, no por nombre— y decirle sin rodeos quién paga.

import { useState } from "react";
import Link from "next/link";
import {
  MessageCircle, ArrowLeft, CreditCard, ExternalLink, Copy, Check, AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useT } from "@/i18n/i18n-provider";
import {
  WA_TEMPLATE_SPECS,
  type WaTemplateMap,
} from "@/lib/whatsapp/template-config";
import s from "../whatsapp.module.css";
import p from "./plantillas.module.css";

const META_BILLING_URL = "https://business.facebook.com/billing_hub/payment_settings";
const META_TEMPLATES_URL = "https://business.facebook.com/wa/manage/message-templates/";

interface Props {
  canEdit: boolean;
  connected: boolean;
  templates: WaTemplateMap;
  billingOk: boolean;
}

type FormState = Record<string, { name: string; lang: string }>;

function toForm(templates: WaTemplateMap): FormState {
  const out: FormState = {};
  for (const spec of WA_TEMPLATE_SPECS) {
    const cur = templates[spec.kind];
    // El idioma se pre-rellena con es_MX porque es el de la inmensa mayoría de
    // las clínicas; el nombre NO se pre-rellena con el sugerido, que sería
    // mentir sobre lo que la clínica tiene aprobado en Meta.
    out[spec.kind] = { name: cur?.name ?? "", lang: cur?.lang ?? "es_MX" };
  }
  return out;
}

export function TemplatesClient({ canEdit, connected, templates, billingOk }: Props) {
  const t = useT();
  const [form, setForm] = useState<FormState>(() => toForm(templates));
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setField(kind: string, field: "name" | "lang", value: string) {
    setForm((f) => ({ ...f, [kind]: { ...f[kind], [field]: value } }));
    setFieldErrors((e) => (e[kind] ? { ...e, [kind]: "" } : e));
  }

  async function copyBody(kind: string, body: string) {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 2000);
    } catch {
      // clipboard bloqueado (http, permisos): el texto se ve igual en pantalla
      // y se puede seleccionar a mano.
      toast.error(t("inbox.whatsapp.tplCopyFailed"));
    }
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});
    try {
      const res = await fetch("/api/whatsapp/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El servidor dice QUÉ campo está mal: se pinta junto a su input en vez
        // de un toast genérico que obliga a adivinar.
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          const map: Record<string, string> = {};
          for (const e of data.errors) map[e.kind] = e.message;
          setFieldErrors(map);
          toast.error(t("inbox.whatsapp.tplSaveInvalid"));
          return;
        }
        throw new Error(data.error ?? "error");
      }
      toast.success(t("inbox.whatsapp.tplSaved"));
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.headerId}>
          <div className={s.headerIcon}>
            <MessageCircle size={20} />
          </div>
          <div>
            <h1 className={s.title}>{t("inbox.whatsapp.tplTitle")}</h1>
            <p className={s.subtitle}>{t("inbox.whatsapp.tplSubtitle")}</p>
          </div>
        </div>
        <div className={s.headerActions}>
          <Link href="/dashboard/whatsapp" className={p.backLink}>
            <ArrowLeft size={15} /> {t("inbox.whatsapp.tplBack")}
          </Link>
        </div>
      </div>

      {/* Por qué existe esta pantalla. Va arriba del todo: sin entender la
          ventana de 24 h, registrar plantillas parece burocracia inútil. */}
      <div className={p.explain}>
        <AlertTriangle size={17} className={p.explainIcon} />
        <div>
          <div className={p.explainTitle}>{t("inbox.whatsapp.tplWhyTitle")}</div>
          <p className={p.explainBody}>{t("inbox.whatsapp.tplWhyBody")}</p>
        </div>
      </div>

      {!connected && (
        <div className={p.warnRow}>
          <BadgeNew tone="danger" dot>
            {t("inbox.whatsapp.disconnected")}
          </BadgeNew>
          <span className={p.warnText}>{t("inbox.whatsapp.tplNotConnected")}</span>
        </div>
      )}

      <div className={p.grid}>
        <div className={p.col}>
          {WA_TEMPLATE_SPECS.map((spec) => {
            const value = form[spec.kind];
            const err = fieldErrors[spec.kind];
            const registered = Boolean(templates[spec.kind]);
            return (
              <CardNew
                key={spec.kind}
                title={t(spec.labelKey)}
                sub={t("inbox.whatsapp.tplCardSub")}
                action={
                  <BadgeNew tone={registered ? "success" : "warning"}>
                    {t(registered ? "inbox.whatsapp.tplRegistered" : "inbox.whatsapp.tplMissing")}
                  </BadgeNew>
                }
              >
                {/* 1) El texto EXACTO a dar de alta en Meta. */}
                <div className={p.blockLabel}>{t("inbox.whatsapp.tplExactText")}</div>
                <div className={p.bodyBox}>
                  <pre className={p.bodyPre}>{spec.body}</pre>
                  <button
                    type="button"
                    className={p.copyBtn}
                    onClick={() => copyBody(spec.kind, spec.body)}
                  >
                    {copied === spec.kind ? <Check size={13} /> : <Copy size={13} />}
                    {t(copied === spec.kind ? "inbox.whatsapp.tplCopied" : "inbox.whatsapp.tplCopy")}
                  </button>
                </div>

                {/* 2) Qué es cada variable: si las registra en otro orden, el
                       mensaje sale con los datos cambiados de sitio. */}
                <ul className={p.varList}>
                  {spec.variableKeys.map((k, i) => (
                    <li key={k} className={p.varItem}>
                      <span className={p.varNum}>{`{{${i + 1}}}`}</span>
                      <span>{t(k)}</span>
                    </li>
                  ))}
                </ul>

                {/* 3) Cómo la aprobó Meta. */}
                <div className={p.fields}>
                  <div className="field-new">
                    <label className="field-new__label">
                      {t("inbox.whatsapp.tplNameLabel")} <span className="req">*</span>
                    </label>
                    <input
                      className="input-new mono"
                      placeholder={spec.suggestedName}
                      value={value?.name ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => setField(spec.kind, "name", e.target.value)}
                    />
                    <p className={s.hint}>{t("inbox.whatsapp.tplNameHint")}</p>
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">
                      {t("inbox.whatsapp.tplLangLabel")} <span className="req">*</span>
                    </label>
                    <input
                      className="input-new mono"
                      placeholder="es_MX"
                      value={value?.lang ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => setField(spec.kind, "lang", e.target.value)}
                    />
                    <p className={s.hint}>{t("inbox.whatsapp.tplLangHint")}</p>
                  </div>
                </div>

                {err && <p className={p.fieldError}>{err}</p>}
              </CardNew>
            );
          })}

          {canEdit && (
            <div className={p.actions}>
              <ButtonNew variant="primary" onClick={save} disabled={saving}>
                {saving ? t("inbox.whatsapp.saving") : t("inbox.whatsapp.tplSave")}
              </ButtonNew>
            </div>
          )}
        </div>

        <div className={p.col}>
          {/* Quién paga. Sin esto, la primera factura de Meta es una sorpresa. */}
          <CardNew title={t("inbox.whatsapp.tplBillingTitle")}>
            <div className={p.billingRow}>
              <CreditCard size={16} className={s.billingIcon} />
              <p className={s.billingBody}>{t("inbox.whatsapp.tplBillingBody")}</p>
            </div>
            <div className={p.billingState}>
              <BadgeNew tone={billingOk ? "success" : "neutral"} dot>
                {t(billingOk ? "inbox.whatsapp.tplBillingOk" : "inbox.whatsapp.tplBillingUnknown")}
              </BadgeNew>
              <span className={p.billingStateHint}>
                {t(billingOk ? "inbox.whatsapp.tplBillingOkHint" : "inbox.whatsapp.tplBillingUnknownHint")}
              </span>
            </div>
            <a className={s.billingCta} href={META_BILLING_URL} target="_blank" rel="noopener noreferrer">
              {t("inbox.whatsapp.tplBillingCta")} <ExternalLink size={12} />
            </a>
          </CardNew>

          <CardNew title={t("inbox.whatsapp.tplHowTitle")}>
            <ol className={p.steps}>
              <li>{t("inbox.whatsapp.tplHow1")}</li>
              <li>{t("inbox.whatsapp.tplHow2")}</li>
              <li>{t("inbox.whatsapp.tplHow3")}</li>
              <li>{t("inbox.whatsapp.tplHow4")}</li>
            </ol>
            <a className={s.billingCta} href={META_TEMPLATES_URL} target="_blank" rel="noopener noreferrer">
              {t("inbox.whatsapp.tplHowCta")} <ExternalLink size={12} />
            </a>
          </CardNew>
        </div>
      </div>
    </div>
  );
}
