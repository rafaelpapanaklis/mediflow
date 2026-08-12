"use client";

// Configuración → WhatsApp → Plantillas.
//
// ANTES esta pantalla le dictaba a la clínica el texto de cada plantilla y le
// pedía que lo diera de alta a mano en el administrador de Meta. Nadie lo hizo:
// `waTemplates` estaba vacío en todas las clínicas y, fuera de la ventana de
// 24 h, no salía ni un recordatorio.
//
// AHORA DaleControl las crea dentro de la cuenta de WhatsApp de la clínica con
// su propio token. Aquí solo se ve en qué estado las tiene Meta y se dispara el
// alta. Escribir nombres a mano queda como opción avanzada, para quien ya tenga
// las suyas aprobadas.

import { useState } from "react";
import Link from "next/link";
import {
  MessageCircle, ArrowLeft, CreditCard, ExternalLink, Copy, Check, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw, Sparkles,
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
import { templateUiState, type WaTemplateUiState } from "@/lib/whatsapp/templates-catalog";
import s from "../whatsapp.module.css";
import p from "./plantillas.module.css";

const META_BILLING_URL = "https://business.facebook.com/billing_hub/payment_settings";
const META_TEMPLATES_URL = "https://business.facebook.com/wa/manage/message-templates/";

interface Props {
  canEdit: boolean;
  connected: boolean;
  /** ¿La conexión trae el id de la cuenta (WABA)? Sin él no se pueden crear. */
  hasWaba: boolean;
  templates: WaTemplateMap;
  billingOk: boolean;
}

type FormState = Record<string, { name: string; lang: string }>;

const UTILITY_SPECS = WA_TEMPLATE_SPECS.filter((spec) => !spec.optional);
const MARKETING_SPECS = WA_TEMPLATE_SPECS.filter((spec) => spec.optional);

function toForm(templates: WaTemplateMap): FormState {
  const out: FormState = {};
  for (const spec of WA_TEMPLATE_SPECS) {
    const cur = templates[spec.kind];
    // El idioma se pre-rellena con es_MX porque es el de la inmensa mayoría de
    // las clínicas; el nombre NO se pre-rellena con el del catálogo, que sería
    // mentir sobre lo que la clínica tiene aprobado en Meta.
    out[spec.kind] = { name: cur?.name ?? "", lang: cur?.lang ?? "es_MX" };
  }
  return out;
}

/** Tono del badge por estado. Mismo criterio en todas las filas. */
const STATE_TONE: Record<WaTemplateUiState, "success" | "warning" | "danger" | "neutral"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
  missing: "neutral",
};

const STATE_LABEL: Record<WaTemplateUiState, string> = {
  approved: "inbox.whatsapp.tplStateReady",
  pending: "inbox.whatsapp.tplStateReview",
  rejected: "inbox.whatsapp.tplStateRejected",
  missing: "inbox.whatsapp.tplStateMissing",
};

export function TemplatesClient({ canEdit, connected, hasWaba, templates, billingOk }: Props) {
  const t = useT();
  // `templates` es el estado que sirvió el servidor; tras crear o guardar se
  // sustituye por lo que devuelve la API para no exigir un recargado a mano.
  const [current, setCurrent] = useState<WaTemplateMap>(templates);
  const [form, setForm] = useState<FormState>(() => toForm(templates));
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // La de marketing solo cuenta como activada si la clínica ya la tiene: así el
  // botón general no la vuelve a pedir por su cuenta ni la deja atrás cuando ya
  // existe y fue rechazada.
  const marketingOn = MARKETING_SPECS.some((spec) => Boolean(current[spec.kind]));
  const missingUtility = UTILITY_SPECS.filter(
    (spec) => templateUiState(current[spec.kind]) === "missing",
  ).length;

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

  /** Crea en Meta lo que falte. `withMarketing` activa la de reseñas. */
  async function provision(withMarketing: boolean) {
    setCreating(true);
    setBlocked(null);
    try {
      const res = await fetch("/api/whatsapp/templates/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeMarketing: withMarketing || marketingOn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "error");

      if (data.templates) {
        setCurrent(data.templates as WaTemplateMap);
        setForm(toForm(data.templates as WaTemplateMap));
      }
      if (!data.ok) {
        // Motivo de cuenta (sin WABA, token sin permisos): se queda fijo en
        // pantalla, no en un toast que se va antes de poder leerlo.
        setBlocked(typeof data.reason === "string" ? data.reason : t("common.genericError"));
        toast.error(t("inbox.whatsapp.tplCreateFailed"));
        return;
      }
      toast.success(t("inbox.whatsapp.tplCreateDone"));
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setCreating(false);
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
      if (data.templates) setCurrent(data.templates as WaTemplateMap);
      toast.success(t("inbox.whatsapp.tplSaved"));
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  /** Una fila: tipo de mensaje, estado y el texto que recibe el paciente. */
  function renderRow(spec: (typeof WA_TEMPLATE_SPECS)[number]) {
    const cfg = current[spec.kind];
    const state = templateUiState(cfg);
    return (
      <div key={spec.kind} className={p.row}>
        <div className={p.rowHead}>
          <span className={p.rowTitle}>{t(spec.labelKey)}</span>
          <BadgeNew tone={STATE_TONE[state]} dot>
            {t(STATE_LABEL[state])}
          </BadgeNew>
        </div>
        <p className={p.rowText}>{spec.body}</p>
        {state === "rejected" && (
          <p className={p.rowReason}>
            {cfg?.reason ? cfg.reason : t("inbox.whatsapp.tplRejectedNoReason")}
          </p>
        )}
        {state === "pending" && <p className={p.rowHint}>{t("inbox.whatsapp.tplStateReviewHint")}</p>}
      </div>
    );
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
          ventana de 24 h, las plantillas parecen burocracia inútil. */}
      <div className={p.explain}>
        <AlertTriangle size={17} className={p.explainIcon} />
        <div>
          <div className={p.explainTitle}>{t("inbox.whatsapp.tplWhyTitle")}</div>
          <p className={p.explainBody}>{t("inbox.whatsapp.tplWhyBody")}</p>
        </div>
      </div>

      {/* Sin método de pago en la cuenta de Meta NO sale ningún recordatorio,
          por muy aprobadas que estén las plantillas. Es lo primero que hay que
          leer si algo no llega. */}
      {!billingOk && (
        <div className={p.explain}>
          <CreditCard size={17} className={p.explainIcon} />
          <div>
            <div className={p.explainTitle}>{t("inbox.whatsapp.tplBillingWarnTitle")}</div>
            <p className={p.explainBody}>
              {t("inbox.whatsapp.tplBillingWarnBody")}{" "}
              <a href={META_BILLING_URL} target="_blank" rel="noopener noreferrer">
                {t("inbox.whatsapp.tplBillingCta")}
              </a>
            </p>
          </div>
        </div>
      )}

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
          <CardNew
            title={t("inbox.whatsapp.tplStatusTitle")}
            sub={t("inbox.whatsapp.tplStatusSub")}
          >
            {blocked && <div className={p.blockedBox}>{blocked}</div>}

            {connected && !hasWaba && (
              <div className={p.blockedBox}>{t("inbox.whatsapp.tplNoWaba")}</div>
            )}

            {canEdit && (
              <div className={p.mainActions}>
                <ButtonNew
                  variant="primary"
                  onClick={() => provision(false)}
                  disabled={creating || !connected || !hasWaba}
                >
                  {creating
                    ? t("inbox.whatsapp.tplCreating")
                    : missingUtility > 0
                      ? t("inbox.whatsapp.tplCreateCta")
                      : t("inbox.whatsapp.tplRefreshCta")}
                </ButtonNew>
                {missingUtility === 0 && !creating && (
                  <RefreshCw size={14} className={p.explainIcon} aria-hidden />
                )}
              </div>
            )}
            <p className={p.mainHint}>{t("inbox.whatsapp.tplCreateHint")}</p>

            <div className={p.rowList}>{UTILITY_SPECS.map(renderRow)}</div>
          </CardNew>

          {/* MARKETING aparte: cuesta más y el paciente puede silenciarla sin
              perder los recordatorios. Se activa a mano, nunca sola. */}
          <CardNew
            title={t("inbox.whatsapp.tplMarketingTitle")}
            sub={t("inbox.whatsapp.tplMarketingSub")}
            action={
              <BadgeNew tone={marketingOn ? "success" : "neutral"}>
                {t(marketingOn ? "inbox.whatsapp.tplMarketingOn" : "inbox.whatsapp.tplMarketingOff")}
              </BadgeNew>
            }
          >
            <p className={p.advIntro}>{t("inbox.whatsapp.tplMarketingWarn")}</p>
            <div className={p.rowList}>{MARKETING_SPECS.map(renderRow)}</div>
            {canEdit && !marketingOn && (
              <div className={p.actions} style={{ marginTop: 14 }}>
                <ButtonNew
                  variant="secondary"
                  onClick={() => provision(true)}
                  disabled={creating || !connected || !hasWaba}
                >
                  <Sparkles size={14} /> {t("inbox.whatsapp.tplMarketingCta")}
                </ButtonNew>
              </div>
            )}
          </CardNew>

          {/* Avanzado: la clínica que YA tiene sus plantillas aprobadas puede
              apuntar aquí sus nombres. No es el camino normal. */}
          <CardNew title={t("inbox.whatsapp.tplAdvancedTitle")}>
            <button
              type="button"
              className={p.advToggle}
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
            >
              {advanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              {t("inbox.whatsapp.tplAdvancedToggle")}
            </button>

            {advanced && (
              <>
                <p className={p.advIntro}>{t("inbox.whatsapp.tplAdvancedIntro")}</p>
                {WA_TEMPLATE_SPECS.map((spec) => {
                  const value = form[spec.kind];
                  const err = fieldErrors[spec.kind];
                  return (
                    <div key={spec.kind} className={p.advBlock}>
                      <div className={p.advName}>{t(spec.labelKey)}</div>

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

                      {/* Qué es cada variable: registrarlas en otro orden entrega
                          el mensaje con los datos cambiados de sitio. */}
                      <ul className={p.varList}>
                        {spec.variableKeys.map((k, i) => (
                          <li key={k} className={p.varItem}>
                            <span className={p.varNum}>{`{{${i + 1}}}`}</span>
                            <span>{t(k)}</span>
                          </li>
                        ))}
                      </ul>

                      <div className={p.fields}>
                        <div className="field-new">
                          <label className="field-new__label">
                            {t("inbox.whatsapp.tplNameLabel")}
                          </label>
                          <input
                            className="input-new mono"
                            placeholder={spec.name}
                            value={value?.name ?? ""}
                            disabled={!canEdit}
                            onChange={(e) => setField(spec.kind, "name", e.target.value)}
                          />
                          <p className={s.hint}>{t("inbox.whatsapp.tplNameHint")}</p>
                        </div>
                        <div className="field-new">
                          <label className="field-new__label">
                            {t("inbox.whatsapp.tplLangLabel")}
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
                    </div>
                  );
                })}

                {canEdit && (
                  <div className={p.actions} style={{ marginTop: 14 }}>
                    <ButtonNew variant="secondary" onClick={save} disabled={saving}>
                      {saving ? t("inbox.whatsapp.saving") : t("inbox.whatsapp.tplSave")}
                    </ButtonNew>
                  </div>
                )}
              </>
            )}
          </CardNew>
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
