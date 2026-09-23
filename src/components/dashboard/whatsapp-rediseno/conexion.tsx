"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import {
  MessageCircle, CheckCircle, CheckCircle2, ExternalLink, Eye, EyeOff, Bot,
  Facebook, QrCode, Check, CreditCard, LifeBuoy, Info, RefreshCw, Mail, FileText, AlertTriangle,
} from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { RecentReminderDTO } from "@/lib/whatsapp/recent-reminders";
import { REMINDER_REASON_KEY } from "@/lib/whatsapp/reason-i18n";
import { REMINDER_VARS_HELP } from "@/lib/reminders/preview";
import { EmbeddedSignupButton } from "@/app/dashboard/whatsapp/embedded-signup-button";
import { RaizWhatsApp } from "./raiz";
import { Boton, BotonEnlace, Cabecera, Campo, Etiqueta, FilaInterruptor, Nota, Tarjeta, type Tono } from "./piezas";
import s from "./whatsapp-rediseno.module.css";

// Dónde agrega la clínica su método de pago para las plantillas de Meta.
// Mismo destino que la pantalla de siempre (whatsapp-client.tsx).
const META_BILLING_URL = "https://business.facebook.com/billing_hub/payment_settings";

/** Tono del chip por estado. "Enviado" = aceptado por WhatsApp, no entregado. */
const REMINDER_TONE: Record<RecentReminderDTO["status"], Tono> = {
  SENT: "success",
  FAILED: "danger",
  PENDING: "warning",
  CANCELLED: "neutral",
};

// Mapas explícitos (no llaves armadas por concatenación): si mañana se agrega
// un estado/tipo, TypeScript obliga a traducirlo en vez de pintar la llave cruda.
const REMINDER_STATUS_KEY: Record<RecentReminderDTO["status"], string> = {
  SENT: "inbox.whatsapp.recentStatusSent",
  FAILED: "inbox.whatsapp.recentStatusFailed",
  PENDING: "inbox.whatsapp.recentStatusPending",
  CANCELLED: "inbox.whatsapp.recentStatusCancelled",
};

const REMINDER_KIND_KEY: Record<RecentReminderDTO["kind"], string> = {
  Appointment: "inbox.whatsapp.recentKindAppointment",
  Recall: "inbox.whatsapp.recentKindRecall",
  Birthday: "inbox.whatsapp.recentKindBirthday",
  Followup: "inbox.whatsapp.recentKindFollowup",
  TreatmentFollowup: "inbox.whatsapp.recentKindTreatmentFollowup",
  PaymentDue: "inbox.whatsapp.recentKindPaymentDue",
  Clinical: "inbox.whatsapp.recentKindClinical",
  Other: "inbox.whatsapp.recentKindOther",
};

type Formulario = { phoneNumberId: string; accessToken: string; wabaId: string };

/**
 * Todo lo que la vista necesita, tal cual lo tiene `WhatsAppClient`: el estado
 * y los manejadores viven allí (conectar, desconectar, guardar, autosave de
 * los interruptores) y aquí solo se pintan. Así el camino viejo y el nuevo
 * hacen EXACTAMENTE las mismas llamadas a la API.
 */
export type ConexionVM = {
  t: TFunction;
  connected: boolean;
  step: "intro" | "config" | "done";
  setStep: (paso: "intro" | "config" | "done") => void;
  loading: boolean;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  form: Formulario;
  setForm: Dispatch<SetStateAction<Formulario>>;
  msg: string;
  setMsg: (v: string) => void;
  defaultMsg: string;
  /** Mensaje ya renderizado con datos de ejemplo + variables que no existen. */
  vistaPrevia: { preview: string; unknown: string[] };
  r24h: boolean;
  r1h: boolean;
  setR24h: (v: boolean) => void;
  setR1h: (v: boolean) => void;
  savingMsg: boolean;
  toggleBusy: Record<string, boolean>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  saveSettings: () => Promise<void>;
  saveToggle: (
    key: "24h" | "1h",
    field: "waReminder24h" | "waReminder1h",
    next: boolean,
    set: (v: boolean) => void,
    toastKey: string,
  ) => Promise<void>;
  connChip: { tone: "success" | "neutral"; label: string } | null;
  remindersOn: boolean;
  /** Avisos al agendar / reprogramar / cancelar, ya con su valor y su manejador. */
  avisosEvento: ReadonlyArray<{
    campo: string;
    labelKey: string;
    descKey: string;
    val: boolean;
    busy: boolean;
    toggle: () => void;
  }>;
  /** Cobranza (ws1-t3): aviso de mensualidad por vencer + saldo por el bot. */
  avisosCobranza: ReadonlyArray<{
    campo: string;
    labelKey: string;
    descKey: string;
    val: boolean;
    busy: boolean;
    toggle: () => void;
  }>;
  /** ¿El aviso de mensualidad está encendido? (para la nota de la ventana de 24 h) */
  cobranzaOn: boolean;
  /** Resumen de un vistazo: qué manda hoy esta sucursal. */
  resumenAvisos: ReadonlyArray<{ key: string; label: string; on: boolean }>;
  esAvailable: boolean;
  onEmbeddedConnected: () => void;
  refrescar: () => void;
  recentReminders: RecentReminderDTO[];
  recentRemindersFailed: boolean;
  /** Cumpleaños/recall/seguimientos bloqueados por la ventana de 24 h, 30 días (H-7). */
  sinPlantilla30d?: number;
};

/** Las plantillas de recordatorio se cobran por unidad: la clínica necesita un
 *  método de pago en Meta. Aparece antes y después de conectar. */
function NotaFacturacion({ t }: { t: TFunction }) {
  return (
    <Nota icono={<CreditCard size={16} />} titulo={t("inbox.whatsapp.billingNoteLabel")}>
      <p className={s.notaCuerpo}>{t("inbox.whatsapp.billingNoteBody")}</p>
      <a className={`${s.enlace} ${s.arriba}`} href={META_BILLING_URL} target="_blank" rel="noopener noreferrer">
        {t("inbox.whatsapp.billingNoteCta")} <ExternalLink size={12} />
      </a>
    </Nota>
  );
}

export function ConexionRediseno({ vm }: { vm: ConexionVM }) {
  const {
    t, connected, step, setStep, loading, showToken, setShowToken, form, setForm,
    msg, setMsg, defaultMsg, vistaPrevia, r24h, r1h, setR24h, setR1h, savingMsg, toggleBusy,
    connect, disconnect, saveSettings, saveToggle, connChip, remindersOn, esAvailable,
    avisosEvento, avisosCobranza, cobranzaOn, resumenAvisos,
    onEmbeddedConnected, refrescar, recentReminders, recentRemindersFailed, sinPlantilla30d = 0,
  } = vm;

  const pasos = [
    { Icon: Facebook, titleKey: "inbox.whatsapp.stepLoginTitle", descKey: "inbox.whatsapp.stepLoginDesc" },
    { Icon: QrCode, titleKey: "inbox.whatsapp.stepQrTitle", descKey: "inbox.whatsapp.stepQrDesc" },
    { Icon: CheckCircle2, titleKey: "inbox.whatsapp.stepDoneTitle", descKey: "inbox.whatsapp.stepDoneDesc" },
  ];

  const necesidades = [
    { titleKey: "inbox.whatsapp.needAppTitle", descKey: "inbox.whatsapp.needAppDesc" },
    { titleKey: "inbox.whatsapp.needFacebookTitle", descKey: "inbox.whatsapp.needFacebookDesc" },
  ];

  const interruptores = [
    { key: "24h", field: "waReminder24h", labelKey: "inbox.whatsapp.reminder24hLabel", descKey: "inbox.whatsapp.reminder24hDesc", onKey: "inbox.whatsapp.reminder24hOnToast", offKey: "inbox.whatsapp.reminder24hOffToast", val: r24h, set: setR24h },
    { key: "1h", field: "waReminder1h", labelKey: "inbox.whatsapp.reminder1hLabel", descKey: "inbox.whatsapp.reminder1hDesc", onKey: "inbox.whatsapp.reminder1hOnToast", offKey: "inbox.whatsapp.reminder1hOffToast", val: r1h, set: setR1h },
  ] as const;

  return (
    <RaizWhatsApp>
      <Cabecera
        icono={<MessageCircle size={20} />}
        titulo="WhatsApp Business"
        sub={t("inbox.whatsapp.subtitle")}
        acciones={
          <>
            <Etiqueta tono={connected ? "success" : "danger"} punto>
              {connected ? t("inbox.whatsapp.connected") : t("inbox.whatsapp.disconnected")}
            </Etiqueta>
            <BotonEnlace href="/dashboard/whatsapp/plantillas" icono={<FileText size={15} />}>
              {t("inbox.whatsapp.tplNav")}
            </BotonEnlace>
            <BotonEnlace href="/dashboard/whatsapp/bot" icono={<Bot size={15} />}>
              Configurar bot
            </BotonEnlace>
          </>
        }
      />

      {/* INTRO — desconectado */}
      {step === "intro" && (
        <div className={s.apilado}>
          <section className={s.heroe}>
            <h2 className={s.heroeTitulo}>{t("inbox.whatsapp.heroTitle")}</h2>
            <p className={s.heroeSub}>{t("inbox.whatsapp.heroSub")}</p>
            <div className={s.heroeCta}>
              {esAvailable ? (
                <>
                  <EmbeddedSignupButton onConnected={onEmbeddedConnected} />
                  <button type="button" className={`${s.enlace} ${s.enlaceSuave}`} onClick={() => setStep("config")}>
                    {t("inbox.whatsapp.esManualCta")}
                  </button>
                </>
              ) : (
                <Boton variante="principal" grande icono={<MessageCircle size={16} />} onClick={() => setStep("config")}>
                  {t("inbox.whatsapp.esManualCta")}
                </Boton>
              )}
            </div>
          </section>

          <div className={s.rejillaPar}>
            <Tarjeta titulo={t("inbox.whatsapp.howItWorksTitle")} sub={t("inbox.whatsapp.howItWorksSub")}>
              <div className={s.pasos}>
                {pasos.map(({ Icon, titleKey, descKey }) => (
                  <div key={titleKey} className={s.paso}>
                    <div className={s.pasoIcono}>
                      <Icon size={17} />
                    </div>
                    <div className={s.pasoCuerpo}>
                      <div className={s.pasoTitulo}>{t(titleKey)}</div>
                      <div className={s.pasoDesc}>{t(descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Tarjeta>

            <Tarjeta titulo={t("inbox.whatsapp.needsTitle")} sub={t("inbox.whatsapp.needsSub")}>
              <div className={s.necesidades}>
                {necesidades.map(({ titleKey, descKey }) => (
                  <div key={titleKey} className={s.necesidad}>
                    <div className={s.necesidadIcono}>
                      <Check size={13} strokeWidth={3} />
                    </div>
                    <div>
                      <div className={s.pasoTitulo}>{t(titleKey)}</div>
                      <div className={s.pasoDesc}>{t(descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className={s.ayuda}>
                <Link href="/dashboard/soporte" className={s.enlace}>
                  <LifeBuoy size={13} /> {t("inbox.whatsapp.needsHelp")}
                </Link>
              </div>
            </Tarjeta>
          </div>

          <NotaFacturacion t={t} />
        </div>
      )}

      {/* CONFIG — conexión manual (avanzada) */}
      {step === "config" && (
        <div className={s.estrecho}>
          <Tarjeta titulo={t("inbox.whatsapp.connectCardTitle")}>
            <div className={s.campos}>
              <Campo etiqueta="Phone Number ID" obligatorio pista={t("inbox.whatsapp.phoneIdHint")}>
                <input
                  className={s.entrada}
                  placeholder="123456789012345"
                  inputMode="numeric"
                  value={form.phoneNumberId}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm((f) => ({ ...f, phoneNumberId: v }));
                  }}
                />
              </Campo>

              <Campo etiqueta={t("inbox.whatsapp.wabaLabel")} pista={t("inbox.whatsapp.wabaHint")}>
                <input
                  className={s.entrada}
                  placeholder="102290129340398"
                  inputMode="numeric"
                  value={form.wabaId}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm((f) => ({ ...f, wabaId: v }));
                  }}
                />
              </Campo>

              <Campo etiqueta="Access Token" obligatorio pista={t("inbox.whatsapp.accessTokenHint")}>
                <div className={s.conToken}>
                  <input
                    className={s.entrada}
                    type={showToken ? "text" : "password"}
                    placeholder="EAAxxxxxxxxx…"
                    value={form.accessToken}
                    onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
                  />
                  <button
                    type="button"
                    className={s.verToken}
                    aria-label={t(showToken ? "settings.integrations.hideToken" : "settings.integrations.showToken")}
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Campo>

              <Nota icono={<CreditCard size={16} />} titulo={t("inbox.whatsapp.noteLabel")}>
                <p className={s.notaCuerpo}>{t("inbox.whatsapp.tokenNote")}</p>
              </Nota>

              <div className={s.accionesFormulario}>
                <Boton variante="suave" onClick={() => setStep("intro")}>{t("inbox.whatsapp.back")}</Boton>
                <Boton variante="principal" onClick={connect} disabled={loading}>
                  {loading ? t("inbox.whatsapp.verifying") : t("inbox.whatsapp.connectButton")}
                </Boton>
              </div>
            </div>
          </Tarjeta>
        </div>
      )}

      {/* CONECTADO */}
      {step === "done" && (
        <div className={s.rejillaPrincipal}>
          <div className={s.columna}>
            {/* Avisos de citas (ws1-t2): qué sale al agendar, mover o cancelar,
                y arriba el resumen de TODO lo que esta sucursal tiene encendido. */}
            <Tarjeta titulo={t("inbox.whatsapp.eventsTitle")} sub={t("inbox.whatsapp.eventsSub")}>
              <div className={s.resumenAvisos}>
                {resumenAvisos.map((r) => (
                  <Etiqueta key={r.key} tono={r.on ? "success" : "neutral"}>
                    {r.label} · {t(r.on ? "inbox.whatsapp.summaryOn" : "inbox.whatsapp.summaryOff")}
                  </Etiqueta>
                ))}
              </div>
              <div className={s.apilado} style={{ gap: 10 }}>
                {avisosEvento.map((opt) => (
                  <FilaInterruptor
                    key={opt.campo}
                    on={opt.val}
                    disabled={opt.busy}
                    onToggle={opt.toggle}
                    titulo={t(opt.labelKey)}
                    desc={t(opt.descKey)}
                  />
                ))}
              </div>
            </Tarjeta>

            {/* Cobranza (ws1-t3): avisar de la mensualidad por vencer y dejar
                que el bot conteste el saldo. Los DOS apagados de fábrica: el
                primero porque cada plantilla fuera de la ventana de 24 h cuesta
                dinero; el segundo porque hablar de deudas por WhatsApp es una
                decisión de la clínica, nunca un default. */}
            <Tarjeta titulo={t("inbox.whatsapp.duesTitle")} sub={t("inbox.whatsapp.duesSub")}>
              <div className={s.apilado} style={{ gap: 10 }}>
                {avisosCobranza.map((opt) => (
                  <FilaInterruptor
                    key={opt.campo}
                    on={opt.val}
                    disabled={opt.busy}
                    onToggle={opt.toggle}
                    titulo={t(opt.labelKey)}
                    desc={t(opt.descKey)}
                  />
                ))}
              </div>

              {/* Igual que bajo los recordatorios de cita: el aviso no cuelga
                  de una cita, así que fuera de la ventana de 24 h de Meta no
                  hay plantilla aprobada y el envío se bloquea. Se dice junto
                  al interruptor, no se deja morir en silencio. */}
              {cobranzaOn && (
                <Nota icono={<Info size={16} />} titulo={t("inbox.whatsapp.duesWindow24Label")} className={s.arribaMas}>
                  <p className={s.notaCuerpo}>{t("inbox.whatsapp.duesWindow24Body")}</p>
                </Nota>
              )}
            </Tarjeta>

            <Tarjeta titulo={t("inbox.whatsapp.whenToSendTitle")} sub={t("inbox.whatsapp.whenToSendSub")}>
              <div className={s.apilado} style={{ gap: 10 }}>
                {interruptores.map((opt) => (
                  <FilaInterruptor
                    key={opt.key}
                    on={opt.val}
                    disabled={!!toggleBusy[opt.key]}
                    onToggle={() => saveToggle(opt.key, opt.field, !opt.val, opt.set, opt.val ? opt.offKey : opt.onKey)}
                    titulo={t(opt.labelKey)}
                    desc={t(opt.descKey)}
                  />
                ))}
              </div>

              {/* Ventana de 24 h — hoy el recordatorio NO llega a quien no ha
                  escrito. Se dice aquí mismo, junto a los interruptores que lo
                  prometen, en vez de dejar que el envío muera en silencio. */}
              {remindersOn && (
                <Nota icono={<Info size={16} />} titulo={t("inbox.whatsapp.window24Label")} className={s.arribaMas}>
                  <p className={s.notaCuerpo}>{t("inbox.whatsapp.window24Body")}</p>
                </Nota>
              )}
            </Tarjeta>

            <Tarjeta
              titulo={t("inbox.whatsapp.recentTitle")}
              sub={t("inbox.whatsapp.recentSub")}
              accion={
                <Boton variante="suave" peq icono={<RefreshCw size={13} />} onClick={refrescar}>
                  {t("inbox.whatsapp.recentRefresh")}
                </Boton>
              }
            >
              {/* H-7: lo que NO salió por la ventana de 24 h, a la vista y sin
                  buscar fila por fila. Solo aparece si hubo alguno. */}
              {sinPlantilla30d > 0 && (
                <Nota tono="alerta" icono={<AlertTriangle size={16} />} titulo={t("inbox.whatsapp.noTemplateSummaryTitle")}>
                  <p className={s.notaCuerpo}>{t("inbox.whatsapp.noTemplateSummaryBody", { count: sinPlantilla30d })}</p>
                </Nota>
              )}
              {recentRemindersFailed ? (
                <p className={s.vacio}>{t("inbox.whatsapp.recentFailed")}</p>
              ) : recentReminders.length === 0 ? (
                <p className={s.vacio}>{t("inbox.whatsapp.recentEmpty")}</p>
              ) : (
                <ul className={s.lista}>
                  {recentReminders.map((r) => (
                    <li key={r.id} className={s.fila}>
                      <Etiqueta tono={REMINDER_TONE[r.status]} className={s.filaEtiqueta}>
                        {t(REMINDER_STATUS_KEY[r.status])}
                      </Etiqueta>
                      <div className={s.filaCuerpo}>
                        <div className={s.filaCabeza}>
                          <span className={s.filaTipo}>{t(REMINDER_KIND_KEY[r.kind])}</span>
                          {r.channel === "email" && (
                            <span className={s.filaCanal}>
                              <Mail size={11} /> {t("inbox.whatsapp.recentChannelEmail")}
                            </span>
                          )}
                          {r.who && <span className={s.filaQuien}>· {r.who}</span>}
                        </div>
                        {(r.reasonKey || r.rawError) && (
                          <div className={s.filaMotivo}>
                            {r.reasonKey ? t(REMINDER_REASON_KEY[r.reasonKey]) : r.rawError}
                          </div>
                        )}
                      </div>
                      <span className={s.filaCuando}>{r.whenLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Tarjeta>

            <Tarjeta titulo={t("inbox.whatsapp.reminderMessageTitle")} sub={t("inbox.whatsapp.reminderMessageVars")}>
              <textarea
                className={`${s.entrada} ${s.entradaArea}`}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
              <button type="button" className={`${s.enlace} ${s.enlaceSuave} ${s.arriba}`} onClick={() => setMsg(defaultMsg)}>
                {t("inbox.whatsapp.resetDefaultMessage")}
              </button>

              {vistaPrevia.unknown.length > 0 && (
                <p className={s.variablesDesconocidas} role="alert">
                  <AlertTriangle size={13} />
                  <span>{t("inbox.whatsapp.unknownVars", { vars: vistaPrevia.unknown.join(", ") })}</span>
                </p>
              )}

              <div className={s.vistaPrevia}>
                <div className={s.vistaPreviaEtiqueta}>{t("inbox.whatsapp.varsTitle")}</div>
                <ul className={s.variablesLista}>
                  {REMINDER_VARS_HELP.map((v) => (
                    <li key={v.labelKey} className={s.variablesFila}>
                      <span className={s.variablesCodigos}>
                        {v.vars.map((codigo) => <code key={codigo} className={s.variablesCodigo}>{codigo}</code>)}
                      </span>
                      <span className={s.pista}>{t(v.labelKey)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={s.vistaPrevia}>
                <div className={s.vistaPreviaEtiqueta}>{t("inbox.whatsapp.preview")}</div>
                <p className={`${s.pista} ${s.vistaPreviaPista}`}>{t("inbox.whatsapp.previewHint")}</p>
                <div className={s.burbuja}>{vistaPrevia.preview}</div>
              </div>

              <div className={`${s.accionesFormulario} ${s.arribaMas}`}>
                <Boton variante="principal" onClick={saveSettings} disabled={savingMsg || vistaPrevia.unknown.length > 0}>
                  {savingMsg ? t("inbox.whatsapp.saving") : t("inbox.whatsapp.saveSettings")}
                </Boton>
                <Boton variante="peligro" onClick={disconnect} disabled={loading}>
                  {t("inbox.whatsapp.disconnect")}
                </Boton>
              </div>
            </Tarjeta>
          </div>

          <div className={s.columna}>
            <Tarjeta titulo={t("common.status")} sub={t("inbox.whatsapp.statusSub")}>
              <div className={s.estadoLista}>
                <div className={s.estadoFila}>
                  <CheckCircle size={14} className={s.estadoIcono} />
                  <span>{t("inbox.whatsapp.webhookReceiving")}</span>
                </div>
                <div className={s.estadoFila}>
                  <CheckCircle size={14} className={s.estadoIcono} />
                  <span className={s.estadoValor}>
                    {/* Identificador técnico de la integración con la API de Meta:
                        es la única excepción documentada en tipografia-panel.tsx
                        (una clave que se copia tal cual), igual que en la
                        pantalla de siempre y en Integraciones. */}
                    Phone Number ID: <span className="mono-tecnico">{form.phoneNumberId || "—"}</span>
                  </span>
                </div>
                {connChip && (
                  <div className={s.estadoFila}>
                    <Etiqueta tono={connChip.tone} punto larga>
                      {connChip.label}
                    </Etiqueta>
                  </div>
                )}
              </div>
            </Tarjeta>

            <NotaFacturacion t={t} />

            <Tarjeta titulo={t("inbox.whatsapp.howSentTitle")} sub={t("inbox.whatsapp.howSentSub")}>
              <p className={s.parrafo}>
                {t("inbox.whatsapp.howSentBodyBefore")}
                <strong> {t("inbox.whatsapp.howSentAgenda")}</strong> {t("inbox.whatsapp.howSentBodyAfter")}
              </p>
            </Tarjeta>
          </div>
        </div>
      )}
    </RaizWhatsApp>
  );
}
