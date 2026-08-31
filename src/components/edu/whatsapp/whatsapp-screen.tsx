"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, RefreshCw, Send, Unplug } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_WA_CONN_DETAILS,
  EDU_WA_CONN_LABELS,
  EDU_WA_KINDS,
  EDU_WA_KIND_DESCRIPTIONS,
  EDU_WA_KIND_LABELS,
  EDU_WA_STATUS_DETAILS,
  EDU_WA_STATUS_LABELS,
  EDU_WA_TEMPLATES,
  EDU_REMINDER_MAX_HOURS,
  EDU_REMINDER_MIN_HOURS,
  eduWaSpec,
  type EduWaConnectionDTO,
  type EduWaMessageRow,
} from "@/lib/edu/whatsapp-core";

/**
 * /instituto/whatsapp — la conexión, las plantillas y qué avisos salen.
 *
 * 🔴 LA PANTALLA DICE LA VERDAD AUNQUE SEA INCÓMODA. Los tres bloques
 * existen para contestar la misma pregunta —"¿le va a llegar al paciente?"—
 * y ninguno pinta un check verde sobre algo que no funciona:
 *
 *   · CONEXIÓN: si Meta está rechazando por falta de tarjeta, dice "sin
 *     método de pago" CON ESAS PALABRAS. No es un fallo del panel y desde
 *     aquí no se arregla; decirlo de otra forma haría que la escuela abriera
 *     un ticket contra DaleControl en vez de ir a Meta.
 *   · PLANTILLAS: sin una aprobada para un tipo, ese aviso NO sale y el
 *     interruptor ni siquiera se deja encender.
 *   · ENVÍOS: "Entregado a WhatsApp" y no "Entregado". Lo que sabemos es que
 *     Meta lo aceptó.
 *
 * MÓVIL PRIMERO, como el resto del vertical: tarjetas apiladas, nada de
 * tablas de seis columnas encogidas.
 */
export interface EduWhatsappScreenProps {
  connection: EduWaConnectionDTO;
  messages: EduWaMessageRow[];
  canManage: boolean;
  institutionName: string;
}

export function EduWhatsappScreen({
  connection,
  messages,
  canManage,
  institutionName,
}: EduWhatsappScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conectar, setConectar] = useState(false);
  const [plantillas, setPlantillas] = useState(false);
  const [busy, setBusy] = useState(false);

  const conectado = connection.state === "CONECTADO";

  function recargar(mensaje: string) {
    setError(null);
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  async function llamar(fn: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      recargar(await fn());
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  async function alternar(field: string, value: boolean) {
    await llamar(async () => {
      await eduRequest("/api/instituto/whatsapp", { method: "PATCH", body: { [field]: value } });
      return value ? "Aviso encendido." : "Aviso apagado.";
    });
  }

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {/* ── 1 · La conexión ───────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">La conexión de {institutionName}</h2>
            <p className="edu-section__lead">
              Cada instituto conecta <strong>su propia</strong> cuenta de WhatsApp. No hay una
              compartida y no puede haberla: Meta le cobra cada plantilla a la tarjeta de esa cuenta
              y no permite mandar en nombre de otra.
            </p>
          </div>
        </div>

        <div className={`edu-wa-conn edu-wa-conn--${connection.state.toLowerCase()}`}>
          <div className="edu-wa-conn__head">
            <span className={`edu-tag ${conectado ? "edu-tag--ok" : "edu-tag--danger"}`}>
              {EDU_WA_CONN_LABELS[connection.state]}
            </span>
            {connection.displayPhone && (
              <span className="edu-wa-conn__phone">{connection.displayPhone}</span>
            )}
          </div>
          <p className="edu-wa-conn__detail">{EDU_WA_CONN_DETAILS[connection.state]}</p>

          {connection.lastErrorMsg && connection.state !== "CONECTADO" && (
            <p className="edu-wa-conn__meta">
              Lo último que dijo Meta: <code>{connection.lastErrorMsg}</code>
            </p>
          )}

          <dl className="edu-kv">
            <dt className="edu-kv__k">Identificador del número</dt>
            <dd className="edu-kv__v">{connection.phoneNumberId ?? "—"}</dd>
            <dt className="edu-kv__k">Cuenta de WhatsApp Business</dt>
            <dd className="edu-kv__v">{connection.businessAccountId ?? "—"}</dd>
            <dt className="edu-kv__k">Método de pago en Meta</dt>
            <dd className="edu-kv__v">
              {connection.billingOk ? "Comprobado al último envío aceptado" : "Sin comprobar"}
            </dd>
          </dl>

          {canManage && (
            <div className="edu-actions">
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => {
                  setFlash(null);
                  setError(null);
                  setConectar(true);
                }}
                disabled={busy}
              >
                <Link2 size={15} />
                {connection.phoneNumberId ? "Volver a conectar" : "Conectar WhatsApp"}
              </button>
              {connection.phoneNumberId && (
                <button
                  type="button"
                  className="edu-btn edu-btn--danger edu-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    llamar(async () => {
                      await eduRequest("/api/instituto/whatsapp/conexion", { method: "DELETE" });
                      return "Se desconectó WhatsApp y se apagaron los tres avisos.";
                    })
                  }
                >
                  <Unplug size={15} />
                  Desconectar
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── 2 · Los avisos ────────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Qué avisos salen</h2>
            <p className="edu-section__lead">
              Los tres nacen apagados. Un aviso sin su plantilla aprobada no se puede encender: fuera
              de la ventana de 24 h WhatsApp solo entrega plantillas, así que se diría que está
              encendido y no saldría nada.
            </p>
          </div>
        </div>

        <div className="edu-wa-avisos">
          {connection.readiness.map((r) => {
            const field =
              r.kind === "RECORDATORIO"
                ? "remindersEnabled"
                : r.kind === "CONSENTIMIENTO"
                  ? "consentEnabled"
                  : "receiptEnabled";
            const puede = conectado && r.templateOk;
            return (
              <div key={r.kind} className={`edu-wa-aviso ${r.enabled ? "edu-wa-aviso--on" : ""}`}>
                <div className="edu-wa-aviso__head">
                  <span className="edu-wa-aviso__name">{r.label}</span>
                  <span className={`edu-tag ${r.enabled ? "edu-tag--ok" : "edu-tag--muted"}`}>
                    {r.enabled ? "Encendido" : "Apagado"}
                  </span>
                </div>
                <p className="edu-wa-aviso__desc">{EDU_WA_KIND_DESCRIPTIONS[r.kind]}</p>

                <p className="edu-wa-aviso__tpl">
                  Plantilla:{" "}
                  {r.templateName ? <code>{r.templateName}</code> : <em>sin registrar</em>}
                  {r.templateStatus && r.templateStatus !== "APPROVED" && (
                    <span className="edu-tag edu-tag--warn"> {r.templateStatus}</span>
                  )}
                </p>

                {r.problem && <p className="edu-wa-aviso__problema">{r.problem}</p>}

                {r.kind === "RECORDATORIO" && r.enabled && (
                  <p className="edu-wa-aviso__meta">
                    Sale <strong>{connection.reminderHoursBefore} h</strong> antes de la cita.
                  </p>
                )}

                {canManage && (
                  <div className="edu-actions">
                    <button
                      type="button"
                      className={`edu-btn edu-btn--sm ${r.enabled ? "edu-btn--ghost" : "edu-btn--primary"}`}
                      disabled={busy || (!r.enabled && !puede)}
                      onClick={() => alternar(field, !r.enabled)}
                    >
                      {r.enabled ? "Apagar" : "Encender"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {canManage && (
          <HorasAntes
            actual={connection.reminderHoursBefore}
            busy={busy}
            onGuardar={(horas) =>
              llamar(async () => {
                await eduRequest("/api/instituto/whatsapp", {
                  method: "PATCH",
                  body: { reminderHoursBefore: horas },
                });
                return `El recordatorio saldrá ${horas} h antes de la cita.`;
              })
            }
          />
        )}
      </section>

      {/* ── 3 · Las plantillas ────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Plantillas aprobadas por Meta</h2>
            <p className="edu-section__lead">
              El texto lo fija DaleControl porque los datos viajan por posición: una plantilla con
              otro número de variables entrega el mensaje con las cosas cambiadas de sitio. Lo que
              se registra aquí es <strong>cómo se llama la tuya</strong> en Meta.
            </p>
          </div>
        </div>

        {canManage && (
          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              disabled={busy}
              onClick={() => {
                setFlash(null);
                setError(null);
                setPlantillas(true);
              }}
            >
              Registrar nombres
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() =>
                llamar(async () => {
                  const res = await eduRequest<{ ok: boolean; reason?: string }>(
                    "/api/instituto/whatsapp/plantillas",
                    { method: "POST" },
                  );
                  return res.ok
                    ? "Meta contestó: los estados quedaron actualizados."
                    : (res.reason ?? "Meta no contestó.");
                })
              }
            >
              <RefreshCw size={15} />
              Revisar en Meta
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy || !connection.remindersEnabled}
              onClick={() =>
                llamar(async () => {
                  const res = await eduRequest<{
                    summary: { enviados: number; bloqueados: number; fallidos: number };
                  }>("/api/instituto/whatsapp/recordatorios", { method: "POST" });
                  const s = res.summary;
                  return `Barrido: ${s.enviados} enviados, ${s.fallidos} fallidos, ${s.bloqueados} sin intentar.`;
                })
              }
            >
              <Send size={15} />
              Correr el barrido ahora
            </button>
          </div>
        )}

        <div className="edu-wa-tpls">
          {EDU_WA_TEMPLATES.map((spec) => {
            const cfg = connection.templates[spec.kind];
            return (
              <div key={spec.kind} className="edu-wa-tpl">
                <p className="edu-wa-tpl__kind">{EDU_WA_KIND_LABELS[spec.kind]}</p>
                <p className="edu-wa-tpl__name">
                  {cfg ? (
                    <>
                      <code>{cfg.name}</code> · {cfg.lang}
                      {cfg.status && (
                        <span
                          className={`edu-tag ${cfg.status === "APPROVED" ? "edu-tag--ok" : cfg.status === "PENDING" ? "edu-tag--warn" : "edu-tag--danger"}`}
                        >
                          {cfg.status}
                        </span>
                      )}
                    </>
                  ) : (
                    <em>Sin registrar. Este aviso no puede salir.</em>
                  )}
                </p>
                {cfg?.reason && <p className="edu-wa-tpl__reason">{cfg.reason}</p>}
                <p className="edu-wa-tpl__body">{spec.body}</p>
                <p className="edu-wa-tpl__vars">
                  Variables, en este orden: {spec.variableKeys.map((v, i) => `{{${i + 1}}} ${v}`).join(" · ")}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 4 · El registro ───────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Últimos envíos</h2>
            <p className="edu-section__lead">
              La constancia se escribe <strong>antes</strong> de llamar a WhatsApp, así que un aviso
              que no salió sale aquí con su motivo. Nada se marca como enviado por si acaso.
            </p>
          </div>
        </div>
        <EduWaEnvios messages={messages} vacio="Todavía no ha salido ningún aviso." />
        {navigating && <p className="edu-note">Actualizando…</p>}
      </section>

      {conectar && (
        <FormConexion
          actual={connection}
          onClose={() => setConectar(false)}
          onDone={() => {
            setConectar(false);
            recargar("WhatsApp conectado. Registra las plantillas y enciende los avisos.");
          }}
        />
      )}

      {plantillas && (
        <FormPlantillas
          actual={connection}
          onClose={() => setPlantillas(false)}
          onDone={() => {
            setPlantillas(false);
            recargar("Plantillas registradas. Usa «Revisar en Meta» para confirmar su estado.");
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// El registro de envíos — se reusa tal cual en la ficha del paciente.
// ═══════════════════════════════════════════════════════════════════════

export function EduWaEnvios({
  messages,
  vacio,
}: {
  messages: EduWaMessageRow[];
  vacio: string;
}) {
  if (messages.length === 0) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">{vacio}</p>
        <p className="edu-empty__detail">
          Cuando salga uno —o cuando no pueda salir— quedará aquí con su resultado, su hora y el
          texto exacto que se mandó.
        </p>
      </div>
    );
  }

  return (
    <div className="edu-wa-envios">
      {messages.map((m) => (
        <div key={m.id} className={`edu-wa-envio edu-wa-envio--${m.status.toLowerCase()}`}>
          <div className="edu-wa-envio__head">
            <span className="edu-wa-envio__kind">{m.kindLabel}</span>
            <span
              className={`edu-tag ${
                m.status === "SENT"
                  ? "edu-tag--ok"
                  : m.status === "PENDING"
                    ? "edu-tag--info"
                    : m.status === "CANCELLED"
                      ? "edu-tag--muted"
                      : "edu-tag--danger"
              }`}
            >
              {EDU_WA_STATUS_LABELS[m.status]}
            </span>
          </div>
          <p className="edu-wa-envio__to">
            {m.toName} · {m.toPhoneLabel}
          </p>
          {m.body && <p className="edu-wa-envio__body">{m.body}</p>}
          {m.errorMsg && (
            <p className="edu-wa-envio__error">
              {m.errorMsg}
              {m.errorCode ? ` (código ${m.errorCode} de Meta)` : ""}
            </p>
          )}
          <p className="edu-wa-envio__meta">
            {EDU_WA_STATUS_DETAILS[m.status]}
            {m.sentByName ? ` · Lo mandó ${m.sentByName}.` : " · Lo mandó el sistema."}
          </p>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Formularios
// ═══════════════════════════════════════════════════════════════════════

function HorasAntes({
  actual,
  busy,
  onGuardar,
}: {
  actual: number;
  busy: boolean;
  onGuardar: (horas: number) => void;
}) {
  const [horas, setHoras] = useState(String(actual));
  const n = Number(horas);
  const valido =
    Number.isInteger(n) && n >= EDU_REMINDER_MIN_HOURS && n <= EDU_REMINDER_MAX_HOURS;

  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor="edu-wa-horas">
        Cuántas horas antes sale el recordatorio
      </label>
      <div className="edu-actions">
        <input
          id="edu-wa-horas"
          className="edu-input edu-input--sm"
          type="number"
          min={EDU_REMINDER_MIN_HOURS}
          max={EDU_REMINDER_MAX_HOURS}
          value={horas}
          onChange={(e) => setHoras(e.target.value)}
          inputMode="numeric"
        />
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          disabled={busy || !valido || n === actual}
          onClick={() => onGuardar(n)}
        >
          Guardar
        </button>
      </div>
      <span className="edu-field__hint">
        Entre {EDU_REMINDER_MIN_HOURS} y {EDU_REMINDER_MAX_HOURS} horas (una semana). Es{" "}
        <strong>una sola</strong> anticipación a propósito: cada plantilla que sale se le cobra al
        instituto, y mandar «24 h y además 2 h» duplica esa factura sin que nadie lo haya pedido.
      </span>
    </div>
  );
}

function FormConexion({
  actual,
  onClose,
  onDone,
}: {
  actual: EduWaConnectionDTO;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phoneNumberId, setPhoneNumberId] = useState(actual.phoneNumberId ?? "");
  const [businessAccountId, setBusinessAccountId] = useState(actual.businessAccountId ?? "");
  const [displayPhone, setDisplayPhone] = useState(actual.displayPhone ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/whatsapp/conexion", {
        method: "POST",
        body: {
          phoneNumberId: phoneNumberId.trim(),
          businessAccountId: businessAccountId.trim(),
          displayPhone: displayPhone.trim(),
          token: token.trim(),
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Conectar el WhatsApp del instituto"
      subtitle="Los tres datos se copian del Administrador de WhatsApp de Meta."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy || !phoneNumberId.trim() || !token.trim()}
          >
            {busy ? "Conectando…" : "Conectar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-banner edu-banner--warn">
        <div>
          <p className="edu-banner__title">La cuenta y la tarjeta son del instituto</p>
          <p className="edu-banner__detail">
            Meta le cobra cada plantilla a la cuenta desde la que sale, así que este número tiene
            que ser el de la escuela y su Administrador comercial necesita un método de pago válido.
            Sin él, Meta rechaza los envíos con el código 131042 y aquí aparecerá{" "}
            <strong>sin método de pago</strong>.
          </p>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-wa-pnid">
          Identificador del número (phone number ID)
        </label>
        <input
          id="edu-wa-pnid"
          className="edu-input"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          autoComplete="off"
          inputMode="numeric"
          placeholder="123456789012345"
        />
        <span className="edu-field__hint">
          Son solo dígitos. No es el teléfono: es el identificador que Meta le pone al número.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-wa-waba">
          Cuenta de WhatsApp Business (WABA ID)
        </label>
        <input
          id="edu-wa-waba"
          className="edu-input"
          value={businessAccountId}
          onChange={(e) => setBusinessAccountId(e.target.value)}
          autoComplete="off"
          inputMode="numeric"
          placeholder="123456789012345"
        />
        <span className="edu-field__hint">
          Opcional para mandar, obligatorio para poder preguntarle a Meta en qué estado tiene tus
          plantillas.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-wa-token">
          Token de acceso
        </label>
        <input
          id="edu-wa-token"
          className="edu-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          placeholder="EAAG…"
        />
        <span className="edu-field__hint">
          Se guarda cifrado y no vuelve a salir de aquí: ni esta pantalla lo puede volver a leer.
          Usa uno permanente, de sistema — uno temporal caduca en 24 h y los avisos dejan de salir.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-wa-display">
          El número, para leerlo
        </label>
        <input
          id="edu-wa-display"
          className="edu-input"
          value={displayPhone}
          onChange={(e) => setDisplayPhone(e.target.value)}
          autoComplete="off"
          placeholder="+52 55 1234 5678"
        />
        <span className="edu-field__hint">
          Solo se pinta en esta pantalla, para saber cuál está conectado. No se manda con él.
        </span>
      </div>
    </EduModal>
  );
}

function FormPlantillas({
  actual,
  onClose,
  onDone,
}: {
  actual: EduWaConnectionDTO;
  onClose: () => void;
  onDone: () => void;
}) {
  const [valores, setValores] = useState<Record<string, { name: string; lang: string }>>(() => {
    const out: Record<string, { name: string; lang: string }> = {};
    for (const kind of EDU_WA_KINDS) {
      const cfg = actual.templates[kind];
      out[kind] = { name: cfg?.name ?? "", lang: cfg?.lang ?? "es_MX" };
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/whatsapp/plantillas", {
        method: "PUT",
        body: { templates: valores },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Registrar las plantillas"
      subtitle="Da de alta en Meta el texto que ves abajo y escribe aquí el nombre con el que te lo aprobaron."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {EDU_WA_KINDS.map((kind) => {
        const spec = eduWaSpec(kind);
        return (
          <div key={kind} className="edu-field">
            <label className="edu-field__label" htmlFor={`edu-wa-tpl-${kind}`}>
              {EDU_WA_KIND_LABELS[kind]}
            </label>
            <div className="edu-actions">
              <input
                id={`edu-wa-tpl-${kind}`}
                className="edu-input"
                value={valores[kind]?.name ?? ""}
                onChange={(e) =>
                  setValores((v) => ({ ...v, [kind]: { ...v[kind], name: e.target.value } }))
                }
                autoComplete="off"
                placeholder={spec?.suggestedName ?? "edu_aviso"}
              />
              <input
                className="edu-input edu-input--sm"
                value={valores[kind]?.lang ?? "es_MX"}
                onChange={(e) =>
                  setValores((v) => ({ ...v, [kind]: { ...v[kind], lang: e.target.value } }))
                }
                autoComplete="off"
                aria-label={`Idioma de la plantilla de ${EDU_WA_KIND_LABELS[kind]}`}
              />
            </div>
            <span className="edu-field__hint">
              Déjalo vacío para desregistrarla. El texto que hay que dar de alta en Meta es:{" "}
              <em>{spec?.body}</em>
            </span>
          </div>
        );
      })}
    </EduModal>
  );
}
