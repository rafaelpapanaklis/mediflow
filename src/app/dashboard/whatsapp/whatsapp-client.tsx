"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MessageCircle, CheckCircle, CheckCircle2, ExternalLink, Eye, EyeOff, Bot,
  Facebook, QrCode, Check, CreditCard, LifeBuoy, Info, RefreshCw, Mail, FileText, AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { EmbeddedSignupButton } from "./embedded-signup-button";
import type { RecentReminderDTO } from "@/lib/whatsapp/recent-reminders";
import { REMINDER_REASON_KEY } from "@/lib/whatsapp/reason-i18n";
import type { AppointmentEventSettings, CobranzaSettings } from "@/lib/reminders/config";
import { REMINDER_VARS_HELP, previewReminderMessage } from "@/lib/reminders/preview";
import { ConexionRediseno } from "@/components/dashboard/whatsapp-rediseno/conexion";
import s from "./whatsapp.module.css";

// Dónde agrega la clínica su método de pago para las plantillas de Meta.
const META_BILLING_URL = "https://business.facebook.com/billing_hub/payment_settings";

// Mismas env que <EmbeddedSignupButton/> (que se auto-oculta si faltan): si no
// están, el botón grande no existe y la conexión manual pasa a ser la primaria.
const ES_AVAILABLE = Boolean(
  process.env.NEXT_PUBLIC_META_APP_ID && process.env.NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID,
);

interface Props {
  connected:     boolean;
  phoneNumberId: string;
  wabaId:        string;
  connMethod:    string;
  reminderMsg:   string;
  reminder24h:   boolean;
  reminder1h:    boolean;
  /** Config efectiva del cron (reminderSettings o los toggles legacy). */
  remindersEnabled:      boolean;
  /** Minutos antes de la cita que usa hoy el cron ([] = recordatorios apagados). */
  reminderOffsets:       number[];
  /** true = hay config propia en Ajustes → Recordatorios y ESA es la que manda. */
  reminderFromSettings:  boolean;
  /** Apagado general legacy (waReminderActive). */
  reminderMasterOn:      boolean;
  /** Avisos al agendar / reprogramar / cancelar (reminderSettings.eventos). */
  eventos:               AppointmentEventSettings;
  /** Aviso de mensualidad + saldo por el bot (reminderSettings.cobranza, ws1-t3). */
  cobranza:              CobranzaSettings;
  recentReminders:       RecentReminderDTO[];
  recentRemindersFailed: boolean;
  /** Cumpleaños/recall/seguimientos bloqueados por la ventana de 24 h, 30 días (H-7). */
  sinPlantilla30d?:      number;
  clinicName:    string;
  /** Rediseño (ws1-t5): el MISMO interruptor por clínica que enciende el
   *  menú de dos niveles. Apagado, esta pantalla se pinta tal cual. */
  rediseno?:     boolean;
}

/** Tono del chip por estado. "Enviado" = aceptado por WhatsApp, no entregado. */
const REMINDER_TONE: Record<RecentReminderDTO["status"], "success" | "danger" | "neutral" | "warning"> = {
  SENT:      "success",
  FAILED:    "danger",
  PENDING:   "warning",
  CANCELLED: "neutral",
};

// Mapas explícitos (no llaves armadas por concatenación): si mañana se agrega
// un estado/tipo/motivo, TypeScript obliga a traducirlo en vez de pintar la
// llave cruda en pantalla.
const REMINDER_STATUS_KEY: Record<RecentReminderDTO["status"], string> = {
  SENT:      "inbox.whatsapp.recentStatusSent",
  FAILED:    "inbox.whatsapp.recentStatusFailed",
  PENDING:   "inbox.whatsapp.recentStatusPending",
  CANCELLED: "inbox.whatsapp.recentStatusCancelled",
};

const REMINDER_KIND_KEY: Record<RecentReminderDTO["kind"], string> = {
  Appointment:       "inbox.whatsapp.recentKindAppointment",
  Recall:            "inbox.whatsapp.recentKindRecall",
  Birthday:          "inbox.whatsapp.recentKindBirthday",
  Followup:          "inbox.whatsapp.recentKindFollowup",
  TreatmentFollowup: "inbox.whatsapp.recentKindTreatmentFollowup",
  PaymentDue: "inbox.whatsapp.recentKindPaymentDue",
  Clinical:          "inbox.whatsapp.recentKindClinical",
  Other:             "inbox.whatsapp.recentKindOther",
};

// El mapa de motivos vive en lib/whatsapp/reason-i18n: lo comparte con las
// burbujas del Inbox, que traducen exactamente los mismos códigos de Meta.

/** Las plantillas de recordatorio se cobran por unidad: la clínica necesita un
 *  método de pago en Meta. Aparece antes y después de conectar. */
function BillingNote({ t, compact }: { t: TFunction; compact?: boolean }) {
  return (
    <div className={[s.billing, compact ? s.billingCompact : ""].filter(Boolean).join(" ")}>
      <CreditCard size={16} className={s.billingIcon} />
      <div>
        <div className={s.billingLabel}>{t("inbox.whatsapp.billingNoteLabel")}</div>
        <p className={s.billingBody}>{t("inbox.whatsapp.billingNoteBody")}</p>
        <a
          className={s.billingCta}
          href={META_BILLING_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("inbox.whatsapp.billingNoteCta")} <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

export function WhatsAppClient({
  connected: initConnected, phoneNumberId: initPhone, wabaId: initWabaId,
  connMethod: initConnMethod,
  reminderMsg: initMsg, reminder24h: init24h, reminder1h: init1h,
  remindersEnabled, reminderOffsets, reminderFromSettings, reminderMasterOn, eventos: initEventos,
  cobranza: initCobranza,
  recentReminders, recentRemindersFailed, sinPlantilla30d = 0, clinicName,
  rediseno = false,
}: Props) {
  const t = useT();
  const router = useRouter();
  const askConfirm = useConfirm();
  const [connected,  setConnected]  = useState(initConnected);
  const [connMethod, setConnMethod] = useState(initConnMethod);
  const [step,       setStep]       = useState<"intro" | "config" | "done">(initConnected ? "done" : "intro");
  const [loading,    setLoading]    = useState(false);
  const [showToken,  setShowToken]  = useState(false);
  const [form,       setForm]       = useState({ phoneNumberId: initPhone, accessToken: "", wabaId: initWabaId });
  // {clinica} y no el nombre ya puesto: una llave en el nombre de la clínica
  // dejaba el texto por defecto con una «variable desconocida» y sin poder guardar.
  const defaultMsg = "Hola {nombre} 👋, te recordamos tu cita en *{clinica}* el *{fecha}* a las *{hora}h*.\n\nDr/a. {doctor}\n\n_Responde este mensaje si necesitas cambiarla._";
  const [msg,        setMsg]        = useState(initMsg || defaultMsg);
  const [r24h,       setR24h]       = useState(init24h);
  const [r1h,        setR1h]        = useState(init1h);
  const [savingMsg,  setSavingMsg]  = useState(false);
  const [eventos,    setEventos]    = useState(initEventos);
  const [cobranza,   setCobranza]   = useState(initCobranza);
  // Switch con un PATCH en vuelo (por llave). Mientras vale true el propio
  // interruptor va deshabilitado, así dos clics rápidos no dejan respuestas
  // pisándose ni un revert contra un valor que ya cambió.
  const [toggleBusy, setToggleBusy] = useState<Record<string, boolean>>({});

  // El popup del Embedded Signup no nos devuelve el número: tras conectar
  // hacemos router.refresh() y el servidor manda los datos reales por props.
  // La página no se remonta (key=clinicId no cambia), así que hay que
  // sincronizar el estado local con las props nuevas.
  useEffect(() => {
    if (initPhone) setForm(f => (f.phoneNumberId === initPhone ? f : { ...f, phoneNumberId: initPhone }));
  }, [initPhone]);
  useEffect(() => { setConnMethod(initConnMethod); }, [initConnMethod]);

  async function connect() {
    if (!form.phoneNumberId || !form.accessToken) { toast.error(t("inbox.whatsapp.fillBothFields")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId: form.phoneNumberId, accessToken: form.accessToken, wabaId: form.wabaId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConnected(true);
      // Mismo criterio que /api/whatsapp/connect: con WABA es coexistence.
      setConnMethod(form.wabaId ? "coexistence" : "manual");
      setStep("done");
      // El panel de recordatorios lo arma el servidor y solo consulta la cola
      // si la clínica está conectada: sin este refresh, tras reconectar (el
      // caso típico, token caducado) diría "no se ha encolado ningún
      // recordatorio" justo sobre la cola que se viene a diagnosticar.
      router.refresh();
      toast.success(`${t("inbox.whatsapp.connectedToast")}${data.displayName ? ` — ${data.displayName}` : ""}`);
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  async function disconnect() {
    if (!(await askConfirm({
      title: t("inbox.whatsapp.disconnectConfirmTitle"),
      description: t("inbox.whatsapp.disconnectConfirmDesc"),
      variant: "warning",
      confirmText: t("inbox.whatsapp.disconnect"),
    }))) return;
    setLoading(true);
    try {
      await fetch("/api/whatsapp/connect", { method: "DELETE" });
      setConnected(false);
      setConnMethod("");
      setStep("intro");
      toast.success(t("inbox.whatsapp.disconnectedToast"));
    } catch { toast.error(t("common.genericError")); } finally { setLoading(false); }
  }

  // El PATCH de /api/clinic arma su `data` campo por campo y waReminderMsg /
  // waReminder24h / waReminder1h NO están en esa lista: los descartaba en
  // silencio (respondía 200 con la fila intacta), y por eso el botón decía
  // «Configuración guardada» y al recargar volvía todo como estaba.
  // /api/settings sí los tiene en su whitelist y acepta updates parciales;
  // es el mismo endpoint que usa la sección Recordatorios de Ajustes.
  const SETTINGS_URL = "/api/settings";

  // Guardado a mano SOLO del texto del recordatorio. Los interruptores ya no
  // viajan aquí: se guardan solos al tocarlos (saveToggle).
  async function saveSettings() {
    setSavingMsg(true);
    try {
      const res = await fetch(SETTINGS_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waReminderMsg: msg }),
      });
      // Sin este check un 403 (sin permiso de configuración) pintaba el toast
      // de éxito igual que un guardado real.
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t("inbox.whatsapp.settingsSavedToast"));
    } catch { toast.error(t("common.genericError")); } finally { setSavingMsg(false); }
  }

  /**
   * Autosave de un interruptor de recordatorio: se mueve al instante y el
   * PATCH sale detrás. Si el guardado falla, el switch REGRESA a donde estaba
   * y se avisa — la pantalla nunca dice algo distinto de lo que quedó
   * guardado. Manda SOLO su propio campo: incluir waReminderMsg guardaría de
   * rondón el texto que la clínica está editando y no ha confirmado.
   */
  async function saveToggle(
    key: "24h" | "1h",
    field: "waReminder24h" | "waReminder1h",
    next: boolean,
    set: (v: boolean) => void,
    toastKey: string,
  ) {
    const prev = !next;
    set(next);                                   // optimista
    setToggleBusy(b => ({ ...b, [key]: true }));
    try {
      const res = await fetch(SETTINGS_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }), // solo el campo del toggle
      });
      if (!res.ok) {
        set(prev);
        toast.error(t(res.status === 403
          ? "inbox.whatsapp.reminderToggleForbidden"
          : "inbox.whatsapp.reminderToggleError"));
        return;
      }
      toast.success(t(toastKey));
    } catch {
      // Sin red el fetch ni siquiera responde: mismo revert.
      set(prev);
      toast.error(t("inbox.whatsapp.reminderToggleError"));
    } finally {
      setToggleBusy(b => ({ ...b, [key]: false }));
    }
  }

  /**
   * Autosave de un aviso por evento (al agendar / reprogramar / cancelar).
   * Mismo contrato que saveToggle: se mueve al instante, y si el guardado falla
   * REGRESA. Viaja el objeto `eventos` entero (el servidor lo mezcla dentro de
   * reminderSettings sin pisar recordatorios ni recall); por eso los tres van
   * deshabilitados mientras hay un PATCH en vuelo: dos guardados cruzados
   * podrían dejar escrito un estado que la pantalla ya no enseña.
   */
  async function saveEvento(campo: keyof AppointmentEventSettings, next: boolean) {
    const prev = eventos;
    const nuevo = { ...eventos, [campo]: next };
    setEventos(nuevo);
    setToggleBusy(b => ({ ...b, eventos: true }));
    try {
      const res = await fetch(SETTINGS_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventos: nuevo }),
      });
      if (!res.ok) {
        setEventos(prev);
        toast.error(t(res.status === 403
          ? "inbox.whatsapp.reminderToggleForbidden"
          : "inbox.whatsapp.reminderToggleError"));
        return;
      }
      toast.success(t(next ? "inbox.whatsapp.eventOnToast" : "inbox.whatsapp.eventOffToast"));
    } catch {
      setEventos(prev);
      toast.error(t("inbox.whatsapp.reminderToggleError"));
    } finally {
      setToggleBusy(b => ({ ...b, eventos: false }));
    }
  }

  /**
   * Autosave de los dos interruptores de cobranza (ws1-t3). Mismo contrato que
   * saveEvento: se mueve al instante y REGRESA si el guardado falla, y viaja el
   * objeto `cobranza` entero porque el servidor lo mezcla dentro del mismo Json
   * (recordatorios + recall + eventos + cobranza) sin pisar las otras partes.
   */
  async function saveCobranza(campo: "enabled" | "bot", next: boolean) {
    const prev = cobranza;
    const nuevo = { ...cobranza, [campo]: next };
    setCobranza(nuevo);
    setToggleBusy(b => ({ ...b, cobranza: true }));
    try {
      const res = await fetch(SETTINGS_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cobranza: nuevo }),
      });
      if (!res.ok) {
        setCobranza(prev);
        toast.error(t(res.status === 403
          ? "inbox.whatsapp.reminderToggleForbidden"
          : "inbox.whatsapp.reminderToggleError"));
        return;
      }
      toast.success(t(next ? "inbox.whatsapp.eventOnToast" : "inbox.whatsapp.eventOffToast"));
    } catch {
      setCobranza(prev);
      toast.error(t("inbox.whatsapp.reminderToggleError"));
    } finally {
      setToggleBusy(b => ({ ...b, cobranza: false }));
    }
  }

  const avisosCobranza = ([
    { campo: "enabled", labelKey: "inbox.whatsapp.duesRemindLabel", descKey: "inbox.whatsapp.duesRemindDesc" },
    { campo: "bot",     labelKey: "inbox.whatsapp.duesBotLabel",    descKey: "inbox.whatsapp.duesBotDesc"    },
  ] as const).map(a => ({
    ...a,
    val: cobranza[a.campo],
    busy: !!toggleBusy.cobranza,
    toggle: () => saveCobranza(a.campo, !cobranza[a.campo]),
  }));

  const avisosEvento = ([
    { campo: "alAgendar",     labelKey: "inbox.whatsapp.eventCreateLabel",     descKey: "inbox.whatsapp.eventCreateDesc" },
    { campo: "alReprogramar", labelKey: "inbox.whatsapp.eventRescheduleLabel", descKey: "inbox.whatsapp.eventRescheduleDesc" },
    { campo: "alCancelar",    labelKey: "inbox.whatsapp.eventCancelLabel",     descKey: "inbox.whatsapp.eventCancelDesc" },
  ] as const).map(a => ({
    ...a,
    val: eventos[a.campo],
    busy: !!toggleBusy.eventos,
    toggle: () => saveEvento(a.campo, !eventos[a.campo]),
  }));

  // «Qué está encendido», de un vistazo — con lo que usa el cron DE VERDAD:
  //   · hay config propia en Ajustes → Recordatorios → mandan sus momentos
  //     (vacío = apagados), y los dos interruptores de aquí no cuentan;
  //   · si no, mandan los interruptores de esta pantalla (estado local, para
  //     que el resumen se mueva al tocarlos) bajo el apagado general de siempre.
  const horasRecordatorio = reminderFromSettings
    ? reminderOffsets.map(m => (m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`)).join(" · ")
    : reminderMasterOn
      ? [r24h ? "24 h" : "", r1h ? "1 h" : ""].filter(Boolean).join(" · ")
      : "";
  const resumenAvisos = [
    { key: "agendar",      label: t("inbox.whatsapp.summaryCreate"),     on: eventos.alAgendar },
    { key: "recordatorio", label: horasRecordatorio
        ? t("inbox.whatsapp.summaryReminderAt", { when: horasRecordatorio })
        : t("inbox.whatsapp.summaryReminder"),                           on: horasRecordatorio !== "" },
    { key: "reprogramar",  label: t("inbox.whatsapp.summaryReschedule"), on: eventos.alReprogramar },
    { key: "cancelar",     label: t("inbox.whatsapp.summaryCancel"),     on: eventos.alCancelar },
    { key: "mensualidad",  label: t("inbox.whatsapp.summaryDues"),       on: cobranza.enabled },
    { key: "saldoBot",     label: t("inbox.whatsapp.summaryDuesBot"),    on: cobranza.bot },
  ];

  // "embedded" y "coexistence" son el mismo flujo real (el número se queda en el
  // celular de la clínica); "manual" es el fallback avanzado. null = clínica
  // conectada antes de que existiera la columna: no afirmamos nada.
  const connChip =
    connMethod === "embedded" || connMethod === "coexistence"
      ? { tone: "success" as const, label: t("inbox.whatsapp.connMethodCoexistence") }
      : connMethod === "manual"
        ? { tone: "neutral" as const, label: t("inbox.whatsapp.connMethodManual") }
        : null;

  // El aviso de la ventana de 24 h se muestra si el cron los tiene activos O si
  // la clínica acaba de encender un toggle (aún sin guardar): en la duda, se
  // avisa. Es la promesa que hace esta tarjeta, y hoy solo se cumple a medias.
  const remindersOn = remindersEnabled || r24h || r1h;

  const steps = [
    { Icon: Facebook,     titleKey: "inbox.whatsapp.stepLoginTitle", descKey: "inbox.whatsapp.stepLoginDesc" },
    { Icon: QrCode,       titleKey: "inbox.whatsapp.stepQrTitle",    descKey: "inbox.whatsapp.stepQrDesc"    },
    { Icon: CheckCircle2, titleKey: "inbox.whatsapp.stepDoneTitle",  descKey: "inbox.whatsapp.stepDoneDesc"  },
  ];

  const needs = [
    { titleKey: "inbox.whatsapp.needAppTitle",      descKey: "inbox.whatsapp.needAppDesc"      },
    { titleKey: "inbox.whatsapp.needFacebookTitle", descKey: "inbox.whatsapp.needFacebookDesc" },
  ];

  // Vista previa y variables desconocidas del mensaje del recordatorio: el
  // MISMO render que usa el envío (ver @/lib/reminders/preview).
  const vistaPrevia = previewReminderMessage(msg, {
    clinica: clinicName,
    fecha: t("inbox.whatsapp.previewSampleDate"),
  });

  // REDISEÑO (ws1-t5): con el interruptor encendido se pinta la vista nueva
  // con ESTE mismo estado y ESTOS mismos manejadores; el JSX de siempre, de
  // aquí para abajo, no cambia ni un nodo.
  if (rediseno) {
    return (
      <ConexionRediseno
        vm={{
          t, connected, step, setStep, loading, showToken, setShowToken, form, setForm,
          msg, setMsg, defaultMsg, vistaPrevia, r24h, r1h, setR24h, setR1h, savingMsg, toggleBusy,
          connect, disconnect, saveSettings, saveToggle, connChip, remindersOn,
          avisosEvento, avisosCobranza, cobranzaOn: cobranza.enabled, resumenAvisos,
          esAvailable: ES_AVAILABLE,
          onEmbeddedConnected: () => {
            setConnected(true);
            setConnMethod("embedded");
            setStep("done");
            router.refresh();
          },
          refrescar: () => router.refresh(),
          recentReminders, recentRemindersFailed, sinPlantilla30d,
        }}
      />
    );
  }

  return (
    <div className={s.page}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerId}>
          <div className={s.headerIcon}>
            <MessageCircle size={20} />
          </div>
          <div>
            <h1 className={s.title}>WhatsApp Business</h1>
            <p className={s.subtitle}>{t("inbox.whatsapp.subtitle")}</p>
          </div>
        </div>
        <div className={s.headerActions}>
          <BadgeNew tone={connected ? "success" : "danger"} dot>
            {connected ? t("inbox.whatsapp.connected") : t("inbox.whatsapp.disconnected")}
          </BadgeNew>
          <ButtonNew
            variant="secondary"
            icon={<FileText size={15} />}
            onClick={() => router.push("/dashboard/whatsapp/plantillas")}
          >
            {t("inbox.whatsapp.tplNav")}
          </ButtonNew>
          <ButtonNew variant="secondary" icon={<Bot size={15} />} onClick={() => router.push("/dashboard/whatsapp/bot")}>
            Configurar bot
          </ButtonNew>
        </div>
      </div>

      {/* INTRO — desconectado */}
      {step === "intro" && (
        <div className={s.intro}>
          <section className={s.hero}>
            <h2 className={s.heroTitle}>{t("inbox.whatsapp.heroTitle")}</h2>
            <p className={s.heroSub}>{t("inbox.whatsapp.heroSub")}</p>
            <div className={s.heroCta}>
              {ES_AVAILABLE ? (
                <>
                  <EmbeddedSignupButton
                    onConnected={() => {
                      setConnected(true);
                      setConnMethod("embedded");
                      setStep("done");
                      router.refresh();
                    }}
                  />
                  <button type="button" className={s.manualLink} onClick={() => setStep("config")}>
                    {t("inbox.whatsapp.esManualCta")}
                  </button>
                </>
              ) : (
                <ButtonNew variant="primary" icon={<MessageCircle size={15} />} onClick={() => setStep("config")}>
                  {t("inbox.whatsapp.esManualCta")}
                </ButtonNew>
              )}
            </div>
          </section>

          <div className={s.cards}>
            <CardNew title={t("inbox.whatsapp.howItWorksTitle")} sub={t("inbox.whatsapp.howItWorksSub")}>
              <div className={s.steps}>
                {steps.map(({ Icon, titleKey, descKey }) => (
                  <div key={titleKey} className={s.step}>
                    <div className={s.stepIcon}>
                      <Icon size={17} />
                    </div>
                    <div className={s.stepBody}>
                      <div className={s.stepTitle}>{t(titleKey)}</div>
                      <div className={s.stepDesc}>{t(descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardNew>

            <CardNew title={t("inbox.whatsapp.needsTitle")} sub={t("inbox.whatsapp.needsSub")}>
              <div className={s.needs}>
                {needs.map(({ titleKey, descKey }) => (
                  <div key={titleKey} className={s.need}>
                    <div className={s.needIcon}>
                      <Check size={13} strokeWidth={3} />
                    </div>
                    <div>
                      <div className={s.needTitle}>{t(titleKey)}</div>
                      <div className={s.needDesc}>{t(descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className={s.needsHelp}>
                <Link href="/dashboard/soporte" className={s.helpLink}>
                  <LifeBuoy size={13} /> {t("inbox.whatsapp.needsHelp")}
                </Link>
              </div>
            </CardNew>
          </div>

          <BillingNote t={t} />
        </div>
      )}

      {/* CONFIG — conexión manual (avanzada) */}
      {step === "config" && (
        <div className={s.manualPane}>
          <CardNew title={t("inbox.whatsapp.connectCardTitle")}>
            <div className={s.formStack}>
              <div className="field-new">
                <label className="field-new__label">Phone Number ID <span className="req">*</span></label>
                <input
                  className="input-new mono"
                  placeholder="123456789012345"
                  inputMode="numeric"
                  value={form.phoneNumberId}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm(f => ({ ...f, phoneNumberId: v }));
                  }}
                />
                <p className={s.hint}>{t("inbox.whatsapp.phoneIdHint")}</p>
              </div>

              <div className="field-new">
                <label className="field-new__label">{t("inbox.whatsapp.wabaLabel")}</label>
                <input
                  className="input-new mono"
                  placeholder="102290129340398"
                  inputMode="numeric"
                  value={form.wabaId}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm(f => ({ ...f, wabaId: v }));
                  }}
                />
                <p className={s.hint}>{t("inbox.whatsapp.wabaHint")}</p>
              </div>

              <div className="field-new">
                <label className="field-new__label">Access Token <span className="req">*</span></label>
                <div className={s.tokenWrap}>
                  <input
                    className="input-new mono"
                    type={showToken ? "text" : "password"}
                    placeholder="EAAxxxxxxxxx…"
                    value={form.accessToken}
                    onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))}
                  />
                  <button
                    type="button"
                    className={s.tokenToggle}
                    aria-label={t(showToken ? "settings.integrations.hideToken" : "settings.integrations.showToken")}
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className={s.hint}>{t("inbox.whatsapp.accessTokenHint")}</p>
              </div>

              <div className={s.billing}>
                <CreditCard size={16} className={s.billingIcon} />
                <div>
                  <div className={s.billingLabel}>{t("inbox.whatsapp.noteLabel")}</div>
                  <p className={s.billingBody}>{t("inbox.whatsapp.tokenNote")}</p>
                </div>
              </div>

              <div className={s.formActions}>
                <ButtonNew variant="ghost" onClick={() => setStep("intro")}>{t("inbox.whatsapp.back")}</ButtonNew>
                <ButtonNew variant="primary" onClick={connect} disabled={loading}>
                  {loading ? t("inbox.whatsapp.verifying") : t("inbox.whatsapp.connectButton")}
                </ButtonNew>
              </div>
            </div>
          </CardNew>
        </div>
      )}

      {/* CONNECTED */}
      {step === "done" && (
        <div className={s.doneGrid}>
          <div className={s.col}>
            <CardNew title={t("inbox.whatsapp.eventsTitle")} sub={t("inbox.whatsapp.eventsSub")}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {resumenAvisos.map(r => (
                  <BadgeNew key={r.key} tone={r.on ? "success" : "neutral"}>
                    {r.label} · {t(r.on ? "inbox.whatsapp.summaryOn" : "inbox.whatsapp.summaryOff")}
                  </BadgeNew>
                ))}
              </div>
              <div className={s.toggles}>
                {avisosEvento.map(opt => (
                  <div key={opt.campo} className={[s.toggle, opt.val ? s.toggleOn : ""].filter(Boolean).join(" ")}>
                    <button
                      type="button"
                      role="switch"
                      aria-label={t(opt.labelKey)}
                      aria-checked={opt.val}
                      disabled={opt.busy}
                      onClick={opt.toggle}
                      className={`switch ${opt.val ? "switch--on" : ""}`}
                    >
                      <span className="switch__thumb" />
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{t(opt.labelKey)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t(opt.descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardNew>

            {/* Cobranza (ws1-t3): el aviso de la mensualidad por vencer y el
                permiso para que el bot diga el saldo. Los DOS apagados de
                fábrica; ver src/lib/reminders/config.ts. */}
            <CardNew title={t("inbox.whatsapp.duesTitle")} sub={t("inbox.whatsapp.duesSub")}>
              <div className={s.toggles}>
                {avisosCobranza.map(opt => (
                  <div key={opt.campo} className={[s.toggle, opt.val ? s.toggleOn : ""].filter(Boolean).join(" ")}>
                    <button
                      type="button"
                      role="switch"
                      aria-label={t(opt.labelKey)}
                      aria-checked={opt.val}
                      disabled={opt.busy}
                      onClick={opt.toggle}
                      className={`switch ${opt.val ? "switch--on" : ""}`}
                    >
                      <span className="switch__thumb" />
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{t(opt.labelKey)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t(opt.descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* La misma honestidad que la tarjeta de recordatorios de al
                  lado: este aviso no cuelga de una cita, así que fuera de la
                  ventana de 24 h de Meta no hay plantilla que mandar. Se dice
                  aquí, junto al interruptor que lo promete. */}
              {cobranza.enabled && (
                <div className={`${s.billing} ${s.windowNote}`}>
                  <Info size={16} className={s.billingIcon} />
                  <div>
                    <div className={s.billingLabel}>{t("inbox.whatsapp.duesWindow24Label")}</div>
                    <p className={s.billingBody}>{t("inbox.whatsapp.duesWindow24Body")}</p>
                  </div>
                </div>
              )}
            </CardNew>

            <CardNew title={t("inbox.whatsapp.whenToSendTitle")} sub={t("inbox.whatsapp.whenToSendSub")}>
              <div className={s.toggles}>
                {([
                  { key: "24h", field: "waReminder24h", labelKey: "inbox.whatsapp.reminder24hLabel", descKey: "inbox.whatsapp.reminder24hDesc", onKey: "inbox.whatsapp.reminder24hOnToast", offKey: "inbox.whatsapp.reminder24hOffToast", val: r24h, set: setR24h },
                  { key: "1h",  field: "waReminder1h",  labelKey: "inbox.whatsapp.reminder1hLabel",  descKey: "inbox.whatsapp.reminder1hDesc",  onKey: "inbox.whatsapp.reminder1hOnToast",  offKey: "inbox.whatsapp.reminder1hOffToast",  val: r1h,  set: setR1h  },
                ] as const).map(opt => (
                  <div key={opt.key} className={[s.toggle, opt.val ? s.toggleOn : ""].filter(Boolean).join(" ")}>
                    <button
                      type="button"
                      role="switch"
                      aria-label={t(opt.labelKey)}
                      aria-checked={opt.val}
                      disabled={!!toggleBusy[opt.key]}
                      onClick={() => saveToggle(opt.key, opt.field, !opt.val, opt.set, opt.val ? opt.offKey : opt.onKey)}
                      className={`switch ${opt.val ? "switch--on" : ""}`}
                    >
                      <span className="switch__thumb" />
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{t(opt.labelKey)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t(opt.descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Ventana de 24 h — hoy el recordatorio NO llega a quien no ha
                  escrito. Se dice aquí mismo, junto a los toggles que lo
                  prometen, en vez de dejar que el envío muera en silencio. */}
              {remindersOn && (
                <div className={`${s.billing} ${s.windowNote}`}>
                  <Info size={16} className={s.billingIcon} />
                  <div>
                    <div className={s.billingLabel}>{t("inbox.whatsapp.window24Label")}</div>
                    <p className={s.billingBody}>{t("inbox.whatsapp.window24Body")}</p>
                  </div>
                </div>
              )}
            </CardNew>

            <CardNew
              title={t("inbox.whatsapp.recentTitle")}
              sub={t("inbox.whatsapp.recentSub")}
              action={
                <button type="button" className={s.refreshBtn} onClick={() => router.refresh()}>
                  <RefreshCw size={12} /> {t("inbox.whatsapp.recentRefresh")}
                </button>
              }
            >
              {/* H-7: lo que NO salió por la ventana de 24 h, a la vista y sin
                  buscar fila por fila. Solo aparece si hubo alguno. */}
              {sinPlantilla30d > 0 && (
                <div className={`${s.billing} ${s.windowNote}`} role="status">
                  <AlertTriangle size={16} className={s.billingIcon} />
                  <div>
                    <div className={s.billingLabel}>{t("inbox.whatsapp.noTemplateSummaryTitle")}</div>
                    <p className={s.billingBody}>{t("inbox.whatsapp.noTemplateSummaryBody", { count: sinPlantilla30d })}</p>
                  </div>
                </div>
              )}
              {recentRemindersFailed ? (
                <p className={s.remEmpty}>{t("inbox.whatsapp.recentFailed")}</p>
              ) : recentReminders.length === 0 ? (
                <p className={s.remEmpty}>{t("inbox.whatsapp.recentEmpty")}</p>
              ) : (
                <ul className={s.remList}>
                  {recentReminders.map(r => (
                    <li key={r.id} className={s.remRow}>
                      <BadgeNew tone={REMINDER_TONE[r.status]} className={s.remBadge}>
                        {t(REMINDER_STATUS_KEY[r.status])}
                      </BadgeNew>
                      <div className={s.remBody}>
                        <div className={s.remHead}>
                          <span className={s.remKind}>{t(REMINDER_KIND_KEY[r.kind])}</span>
                          {r.channel === "email" && (
                            <span className={s.remChannel}>
                              <Mail size={11} /> {t("inbox.whatsapp.recentChannelEmail")}
                            </span>
                          )}
                          {r.who && <span className={s.remWho}>· {r.who}</span>}
                        </div>
                        {(r.reasonKey || r.rawError) && (
                          <div className={s.remReason}>
                            {r.reasonKey ? t(REMINDER_REASON_KEY[r.reasonKey]) : r.rawError}
                          </div>
                        )}
                      </div>
                      <span className={s.remWhen}>{r.whenLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardNew>

            <CardNew
              title={t("inbox.whatsapp.reminderMessageTitle")}
              sub={t("inbox.whatsapp.reminderMessageVars")}
            >
              <textarea
                className={`input-new ${s.msgTextarea}`}
                value={msg}
                onChange={e => setMsg(e.target.value)}
              />
              <button type="button" className={s.resetMsg} onClick={() => setMsg(defaultMsg)}>
                {t("inbox.whatsapp.resetDefaultMessage")}
              </button>

              {vistaPrevia.unknown.length > 0 && (
                <p className={s.varsUnknown} role="alert">
                  <AlertTriangle size={13} />
                  <span>{t("inbox.whatsapp.unknownVars", { vars: vistaPrevia.unknown.join(", ") })}</span>
                </p>
              )}

              <div className={s.varsBox}>
                <div className={s.previewLabel}>{t("inbox.whatsapp.varsTitle")}</div>
                <ul className={s.varsList}>
                  {REMINDER_VARS_HELP.map((v) => (
                    <li key={v.labelKey} className={s.varsRow}>
                      <span className={s.varsCodes}>
                        {v.vars.map((code) => <code key={code} className={s.varsCode}>{code}</code>)}
                      </span>
                      <span className={s.varsDesc}>{t(v.labelKey)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={s.previewBox}>
                <div className={s.previewLabel}>{t("inbox.whatsapp.preview")}</div>
                <p className={s.previewHint}>{t("inbox.whatsapp.previewHint")}</p>
                <div className={s.previewBubble}>{vistaPrevia.preview}</div>
              </div>

              <div className={s.doneActions}>
                <ButtonNew variant="primary" onClick={saveSettings} disabled={savingMsg || vistaPrevia.unknown.length > 0}>
                  {savingMsg ? t("inbox.whatsapp.saving") : t("inbox.whatsapp.saveSettings")}
                </ButtonNew>
                <ButtonNew variant="danger" onClick={disconnect} disabled={loading}>
                  {t("inbox.whatsapp.disconnect")}
                </ButtonNew>
              </div>
            </CardNew>
          </div>

          <div className={s.col}>
            <CardNew title={t("common.status")} sub={t("inbox.whatsapp.statusSub")}>
              <div className={s.statusList}>
                <div className={s.statusRow}>
                  <CheckCircle size={14} className={s.statusIcon} />
                  <span>{t("inbox.whatsapp.webhookReceiving")}</span>
                </div>
                <div className={s.statusRow}>
                  <CheckCircle size={14} className={s.statusIcon} />
                  <span className={s.statusValue}>
                    {/* Identificador técnico de la integración con la API de Meta —
                        letra de máquina real incluso con Instrument Sans en el resto
                        del panel (WS1-T6), igual que Integraciones. */}
                    Phone Number ID: <span className="mono-tecnico">{form.phoneNumberId || "—"}</span>
                  </span>
                </div>
                {connChip && (
                  <div className={s.statusRow}>
                    <BadgeNew tone={connChip.tone} dot className={s.connChip}>
                      {connChip.label}
                    </BadgeNew>
                  </div>
                )}
              </div>
            </CardNew>

            <BillingNote t={t} compact />

            <CardNew title={t("inbox.whatsapp.howSentTitle")} sub={t("inbox.whatsapp.howSentSub")}>
              <div className={s.howSent}>
                {t("inbox.whatsapp.howSentBodyBefore")}
                <strong className={s.howSentStrong}> {t("inbox.whatsapp.howSentAgenda")}</strong> {t("inbox.whatsapp.howSentBodyAfter")}
              </div>
            </CardNew>
          </div>
        </div>
      )}
    </div>
  );
}
