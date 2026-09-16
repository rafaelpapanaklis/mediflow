"use client";

import {
  MessageCircle, ArrowLeft, CreditCard, ExternalLink, Copy, Check, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw, Sparkles,
} from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { WA_TEMPLATE_SPECS, type WaTemplateMap } from "@/lib/whatsapp/template-config";
import { templateUiState, type WaTemplateUiState } from "@/lib/whatsapp/templates-catalog";
import { RaizWhatsApp } from "./raiz";
import { Boton, BotonEnlace, Cabecera, Campo, Etiqueta, Nota, Tarjeta, type Tono } from "./piezas";
import s from "./whatsapp-rediseno.module.css";

// Mismos destinos externos que la pantalla de siempre (templates-client.tsx).
const META_BILLING_URL = "https://business.facebook.com/billing_hub/payment_settings";
const META_TEMPLATES_URL = "https://business.facebook.com/wa/manage/message-templates/";

const UTILITY_SPECS = WA_TEMPLATE_SPECS.filter((spec) => !spec.optional);
const MARKETING_SPECS = WA_TEMPLATE_SPECS.filter((spec) => spec.optional);

/** Tono de la etiqueta por estado. Mismo criterio en todas las filas. */
const STATE_TONE: Record<WaTemplateUiState, Tono> = {
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

type FormState = Record<string, { name: string; lang: string }>;

/**
 * Todo lo que la vista necesita, tal cual lo tiene `TemplatesClient`: el estado
 * y los manejadores (crear en Meta, guardar nombres a mano, copiar) viven allí
 * y aquí solo se pintan. Mismas llamadas a la API en los dos caminos.
 */
export type PlantillasVM = {
  t: TFunction;
  canEdit: boolean;
  connected: boolean;
  hasWaba: boolean;
  billingOk: boolean;
  current: WaTemplateMap;
  form: FormState;
  saving: boolean;
  creating: boolean;
  blocked: string | null;
  copied: string | null;
  advanced: boolean;
  setAdvanced: (v: boolean) => void;
  fieldErrors: Record<string, string>;
  marketingOn: boolean;
  missingUtility: number;
  setField: (kind: string, field: "name" | "lang", value: string) => void;
  copyBody: (kind: string, body: string) => Promise<void>;
  provision: (withMarketing: boolean) => Promise<void>;
  save: () => Promise<void>;
};

export function PlantillasRediseno({ vm }: { vm: PlantillasVM }) {
  const {
    t, canEdit, connected, hasWaba, billingOk, current, form, saving, creating, blocked, copied,
    advanced, setAdvanced, fieldErrors, marketingOn, missingUtility, setField, copyBody, provision, save,
  } = vm;

  /** Una fila: tipo de mensaje, estado y el texto que recibe el paciente. */
  function fila(spec: (typeof WA_TEMPLATE_SPECS)[number]) {
    const cfg = current[spec.kind];
    const state = templateUiState(cfg);
    return (
      <div key={spec.kind} className={s.plantilla}>
        <div className={s.plantillaCabeza}>
          <span className={s.plantillaTitulo}>{t(spec.labelKey)}</span>
          <Etiqueta tono={STATE_TONE[state]} punto>
            {t(STATE_LABEL[state])}
          </Etiqueta>
        </div>
        <p className={s.plantillaTexto}>{spec.body}</p>
        {state === "rejected" && (
          <p className={s.plantillaMotivo}>{cfg?.reason ? cfg.reason : t("inbox.whatsapp.tplRejectedNoReason")}</p>
        )}
        {state === "pending" && <p className={`${s.pista} ${s.arriba}`}>{t("inbox.whatsapp.tplStateReviewHint")}</p>}
      </div>
    );
  }

  return (
    <RaizWhatsApp>
      <Cabecera
        icono={<MessageCircle size={20} />}
        titulo={t("inbox.whatsapp.tplTitle")}
        sub={t("inbox.whatsapp.tplSubtitle")}
        acciones={
          <BotonEnlace href="/dashboard/whatsapp" icono={<ArrowLeft size={15} />}>
            {t("inbox.whatsapp.tplBack")}
          </BotonEnlace>
        }
      />

      <div className={s.apilado}>
        {/* Por qué existe esta pantalla. Va arriba del todo: sin entender la
            ventana de 24 h, las plantillas parecen burocracia inútil. */}
        <Nota tono="alerta" icono={<AlertTriangle size={17} />} titulo={t("inbox.whatsapp.tplWhyTitle")}>
          <p className={s.notaCuerpo}>{t("inbox.whatsapp.tplWhyBody")}</p>
        </Nota>

        {/* Sin método de pago en la cuenta de Meta NO sale ningún recordatorio,
            por muy aprobadas que estén las plantillas. */}
        {!billingOk && (
          <Nota tono="alerta" icono={<CreditCard size={17} />} titulo={t("inbox.whatsapp.tplBillingWarnTitle")}>
            <p className={s.notaCuerpo}>
              {t("inbox.whatsapp.tplBillingWarnBody")}{" "}
              <a href={META_BILLING_URL} target="_blank" rel="noopener noreferrer">
                {t("inbox.whatsapp.tplBillingCta")}
              </a>
            </p>
          </Nota>
        )}

        {!connected && (
          <div className={s.avisoFila}>
            <Etiqueta tono="danger" punto>
              {t("inbox.whatsapp.disconnected")}
            </Etiqueta>
            <span className={s.parrafo}>{t("inbox.whatsapp.tplNotConnected")}</span>
          </div>
        )}

        <div className={s.rejillaPrincipal}>
          <div className={s.columna}>
            <Tarjeta titulo={t("inbox.whatsapp.tplStatusTitle")} sub={t("inbox.whatsapp.tplStatusSub")}>
              {blocked && <div className={s.bloqueado}>{blocked}</div>}

              {connected && !hasWaba && <div className={s.bloqueado}>{t("inbox.whatsapp.tplNoWaba")}</div>}

              {canEdit && (
                <div className={s.accionPrincipal}>
                  <Boton variante="principal" onClick={() => provision(false)} disabled={creating || !connected || !hasWaba}>
                    {creating
                      ? t("inbox.whatsapp.tplCreating")
                      : missingUtility > 0
                        ? t("inbox.whatsapp.tplCreateCta")
                        : t("inbox.whatsapp.tplRefreshCta")}
                  </Boton>
                  {missingUtility === 0 && !creating && <RefreshCw size={14} className={s.notaIcono} aria-hidden />}
                </div>
              )}
              <p className={s.pista} style={{ marginBottom: 14 }}>{t("inbox.whatsapp.tplCreateHint")}</p>

              <div className={s.apilado} style={{ gap: 10 }}>{UTILITY_SPECS.map(fila)}</div>
            </Tarjeta>

            {/* MARKETING aparte: cuesta más y el paciente puede silenciarla sin
                perder los recordatorios. Se activa a mano, nunca sola. */}
            <Tarjeta
              titulo={t("inbox.whatsapp.tplMarketingTitle")}
              sub={t("inbox.whatsapp.tplMarketingSub")}
              accion={
                <Etiqueta tono={marketingOn ? "success" : "neutral"}>
                  {t(marketingOn ? "inbox.whatsapp.tplMarketingOn" : "inbox.whatsapp.tplMarketingOff")}
                </Etiqueta>
              }
            >
              <p className={s.parrafo} style={{ marginBottom: 14 }}>{t("inbox.whatsapp.tplMarketingWarn")}</p>
              <div className={s.apilado} style={{ gap: 10 }}>{MARKETING_SPECS.map(fila)}</div>
              {canEdit && !marketingOn && (
                <div className={`${s.accionesFormulario} ${s.accionesDerecha} ${s.arribaMas}`}>
                  <Boton icono={<Sparkles size={14} />} onClick={() => provision(true)} disabled={creating || !connected || !hasWaba}>
                    {t("inbox.whatsapp.tplMarketingCta")}
                  </Boton>
                </div>
              )}
            </Tarjeta>

            {/* Avanzado: la clínica que YA tiene sus plantillas aprobadas puede
                apuntar aquí sus nombres. Se abre con el mismo clic que hoy. */}
            <Tarjeta titulo={t("inbox.whatsapp.tplAdvancedTitle")}>
              <button type="button" className={s.desplegar} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
                {advanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                {t("inbox.whatsapp.tplAdvancedToggle")}
              </button>

              {advanced && (
                <>
                  <p className={s.parrafo} style={{ margin: "10px 0 14px" }}>{t("inbox.whatsapp.tplAdvancedIntro")}</p>
                  {WA_TEMPLATE_SPECS.map((spec, idx) => {
                    const value = form[spec.kind];
                    const err = fieldErrors[spec.kind];
                    return (
                      <div key={spec.kind} className={idx === 0 ? undefined : s.avanzado}>
                        <div className={s.avanzadoNombre}>{t(spec.labelKey)}</div>

                        <div className={s.cejaTexto}>{t("inbox.whatsapp.tplExactText")}</div>
                        <div className={s.textoExacto}>
                          {/* El texto se copia EXACTO: se respetan los saltos de línea. */}
                          <pre>{spec.body}</pre>
                          <button type="button" className={`${s.boton} ${s.botonPeq} ${s.arriba}`} onClick={() => copyBody(spec.kind, spec.body)}>
                            {copied === spec.kind ? <Check size={13} /> : <Copy size={13} />}
                            {t(copied === spec.kind ? "inbox.whatsapp.tplCopied" : "inbox.whatsapp.tplCopy")}
                          </button>
                        </div>

                        {/* Qué es cada variable: registrarlas en otro orden entrega
                            el mensaje con los datos cambiados de sitio. */}
                        <ul className={s.variables}>
                          {spec.variableKeys.map((k, i) => (
                            <li key={k} className={s.variable}>
                              <span className={s.variableNum}>{`{{${i + 1}}}`}</span>
                              <span>{t(k)}</span>
                            </li>
                          ))}
                        </ul>

                        <div className={s.camposPar}>
                          <Campo etiqueta={t("inbox.whatsapp.tplNameLabel")} pista={t("inbox.whatsapp.tplNameHint")}>
                            <input
                              className={s.entrada}
                              placeholder={spec.name}
                              value={value?.name ?? ""}
                              disabled={!canEdit}
                              onChange={(e) => setField(spec.kind, "name", e.target.value)}
                            />
                          </Campo>
                          <Campo etiqueta={t("inbox.whatsapp.tplLangLabel")} pista={t("inbox.whatsapp.tplLangHint")}>
                            <input
                              className={s.entrada}
                              placeholder="es_MX"
                              value={value?.lang ?? ""}
                              disabled={!canEdit}
                              onChange={(e) => setField(spec.kind, "lang", e.target.value)}
                            />
                          </Campo>
                        </div>

                        {err && <p className={s.errorCampo}>{err}</p>}
                      </div>
                    );
                  })}

                  {canEdit && (
                    <div className={`${s.accionesFormulario} ${s.accionesDerecha} ${s.arribaMas}`}>
                      <Boton onClick={save} disabled={saving}>
                        {saving ? t("inbox.whatsapp.saving") : t("inbox.whatsapp.tplSave")}
                      </Boton>
                    </div>
                  )}
                </>
              )}
            </Tarjeta>
          </div>

          <div className={s.columna}>
            {/* Quién paga. Sin esto, la primera factura de Meta es una sorpresa. */}
            <Tarjeta titulo={t("inbox.whatsapp.tplBillingTitle")}>
              <div className={s.necesidad}>
                <CreditCard size={16} className={s.notaIcono} />
                <p className={s.parrafo}>{t("inbox.whatsapp.tplBillingBody")}</p>
              </div>
              <div className={s.estadoFacturacion}>
                <Etiqueta tono={billingOk ? "success" : "neutral"} punto>
                  {t(billingOk ? "inbox.whatsapp.tplBillingOk" : "inbox.whatsapp.tplBillingUnknown")}
                </Etiqueta>
                <span className={s.pista}>
                  {t(billingOk ? "inbox.whatsapp.tplBillingOkHint" : "inbox.whatsapp.tplBillingUnknownHint")}
                </span>
              </div>
              <a className={s.enlace} href={META_BILLING_URL} target="_blank" rel="noopener noreferrer">
                {t("inbox.whatsapp.tplBillingCta")} <ExternalLink size={12} />
              </a>
            </Tarjeta>

            <Tarjeta titulo={t("inbox.whatsapp.tplHowTitle")}>
              <ol className={s.listaNumerada}>
                <li>{t("inbox.whatsapp.tplHow1")}</li>
                <li>{t("inbox.whatsapp.tplHow2")}</li>
                <li>{t("inbox.whatsapp.tplHow3")}</li>
                <li>{t("inbox.whatsapp.tplHow4")}</li>
              </ol>
              <a className={s.enlace} href={META_TEMPLATES_URL} target="_blank" rel="noopener noreferrer">
                {t("inbox.whatsapp.tplHowCta")} <ExternalLink size={12} />
              </a>
            </Tarjeta>
          </div>
        </div>
      </div>
    </RaizWhatsApp>
  );
}
