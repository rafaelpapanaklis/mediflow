"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/bot — el bot de WhatsApp que califica y agenda.
//
// LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARÍSIMO, y por qué:
//
//   1. ESTÁ APAGADO. El interruptor de encendido es lo primero y va con su
//      aviso. Un bot encendido contesta EN NOMBRE de la inmobiliaria y el
//      prospecto no sabe que es un bot; encenderlo tiene que ser un acto
//      consciente, no un default que alguien descubre por un reclamo.
//
//   2. CUÁNTO ESTÁ GASTANDO HOY. El tope es real y se ve contra lo gastado.
//      No hay "ilimitado" en el selector porque no existe en la base.
//
//   3. QUÉ CONTESTÓ. La lista de turnos con el mensaje que entró, el que
//      salió y su costo. Con botón de CORREGIR, porque la corrección viaja
//      al siguiente turno como regla: es la forma de enseñarle sin tocar
//      código.
//
// El servidor manda el estado ya armado (RealtyBotPanelState). Esta pantalla
// re-consulta después de cada escritura en vez de adivinar el resultado: el
// tope, el cupo del plan y la conexión de WhatsApp los decide el servidor y
// pintar aquí un optimismo que allá se rechazó sería mentirle al dueño.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, MessageSquare, Pencil, Play, UserRound } from "lucide-react";
import {
  DEFAULT_REALTY_BOT_SETTINGS,
  REALTY_BOT_ABILITY_KEYS,
  REALTY_BOT_ABILITY_LABELS,
  REALTY_BOT_AI_CAP_MAX,
  REALTY_BOT_AI_CAP_MIN,
  REALTY_BOT_REPLIES_MAX,
  REALTY_BOT_REPLIES_MIN,
  REALTY_BOT_SKIP_LABELS,
  type RealtyBotPanelState,
  type RealtyBotSettings,
  type RealtyBotTurnDTO,
} from "@/lib/realty/bot/core";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { Dictionary } from "@/i18n/t";
import {
  Aviso,
  Barra,
  Boton,
  Campo,
  Cifra,
  Encabezado,
  Interruptor,
  Modal,
  Pastilla,
  Rejilla,
  Tarjeta,
  Vacio,
  apiJson,
  areaBase,
  fechaHora,
  inputBase,
  pesos,
} from "./growth-ui";

const DIAS = ["D", "L", "M", "M", "J", "V", "S"];

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function minutos(valor: string): number {
  const [h, m] = String(valor ?? "").split(":");
  const n = Number(h) * 60 + Number(m);
  return Number.isFinite(n) ? Math.min(1440, Math.max(0, n)) : 0;
}

export function RealtyBotScreen({
  dict,
  estadoInicial,
  conectado,
  timeZone,
  puedeEditar,
}: {
  dict: Dictionary;
  estadoInicial: RealtyBotPanelState | null;
  conectado: boolean;
  timeZone: string;
  /** whatsapp.send. Sin él la pantalla es de solo lectura. */
  puedeEditar: boolean;
}) {
  // Convención B: el servidor ya recortó el sub-árbol → prefijo VACÍO.
  //
  // ⚠️ `t` es una función NUEVA en cada render (makeRealtyT construye una).
  // Meterla en las dependencias de un efecto es un bucle infinito. Por eso
  // ningún useEffect/useCallback de este archivo la lista.
  const t = makeRealtyT(dict);

  const [estado, setEstado] = useState<RealtyBotPanelState | null>(estadoInicial);
  const [borrador, setBorrador] = useState<RealtyBotSettings>(
    estadoInicial?.settings ?? DEFAULT_REALTY_BOT_SETTINGS,
  );
  const [cargando, setCargando] = useState(!estadoInicial);
  const [barriendo, setBarriendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState<RealtyBotTurnDTO | null>(null);

  const faltaSql = estado ? !estado.storageReady : false;
  const sinIa = estado ? !estado.aiConfigured : false;

  const recargar = useCallback(async () => {
    const r = await apiJson<{ state: RealtyBotPanelState }>("/api/realty/bot");
    if (r.ok && r.data?.state) {
      setEstado(r.data.state);
      setBorrador(r.data.state.settings);
    }
  }, []);

  // Carga inicial. La página NO rearma el estado del bot en el servidor a
  // propósito: ese ensamblado (gasto del día, cupo, pausas, turnos, visitas)
  // ya vive en GET /api/realty/bot, y copiarlo aquí sería tener dos verdades
  // que se separan al primer cambio. La pantalla está detrás de sesión y no
  // la indexa nadie, así que un primer pintado con "cargando" no cuesta.
  useEffect(() => {
    if (estadoInicial) return;
    let vivo = true;
    void (async () => {
      const r = await apiJson<{ state: RealtyBotPanelState }>("/api/realty/bot");
      if (!vivo) return;
      if (r.ok && r.data?.state) {
        setEstado(r.data.state);
        setBorrador(r.data.state.settings);
      } else {
        setError(r.error ?? null);
      }
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [estadoInicial]);

  // El "Guardado" se apaga solo. Sin la limpieza, salir de la pantalla justo
  // después de guardar deja un setState sobre un componente desmontado.
  useEffect(() => {
    if (!ok) return undefined;
    const id = setTimeout(() => setOk(false), 2500);
    return () => clearTimeout(id);
  }, [ok]);

  const guardar = useCallback(
    async (parche: Partial<RealtyBotSettings>) => {
      setGuardando(true);
      setError(null);
      const r = await apiJson<{ settings: RealtyBotSettings }>("/api/realty/bot", {
        method: "PATCH",
        json: parche,
      });
      setGuardando(false);
      if (!r.ok) {
        // El servidor manda el motivo en español (sin tope, sin WhatsApp,
        // falta el sql). Se enseña tal cual: es más útil que un genérico.
        setError(r.error ?? t("errores.red"));
        // Y se vuelve a lo guardado: dejar el interruptor en "encendido"
        // cuando el servidor lo rechazó es la peor mentira posible aquí.
        await recargar();
        return false;
      }
      setOk(true);
      await recargar();
      return true;
    },
    // `t` a propósito FUERA: ver la nota de arriba.
    [recargar], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dirty = useMemo(
    () => JSON.stringify(borrador) !== JSON.stringify(estado?.settings ?? DEFAULT_REALTY_BOT_SETTINGS),
    [borrador, estado],
  );

  if (!estado) {
    return (
      <div className="realty-page">
        <Encabezado titulo={t("bot.title")} sub={t("bot.subtitle")} />
        {cargando ? (
          <Vacio texto={t("comun.cargando")} />
        ) : (
          <Aviso tono="malo">{error ?? t("errores.generico")}</Aviso>
        )}
      </div>
    );
  }

  const encendido = estado.settings.enabled;

  return (
    <div className="realty-page">
      <Encabezado titulo={t("bot.title")} sub={t("bot.subtitle")} />

      {faltaSql && <Aviso tono="alerta">{t("errores.faltaSql")}</Aviso>}
      {sinIa && <Aviso tono="alerta">{t("bot.estado.sinIa")}</Aviso>}
      {!conectado && <Aviso tono="alerta">{t("bot.estado.sinWhatsapp")}</Aviso>}
      {error && <Aviso tono="malo">{error}</Aviso>}
      {ok && <Aviso tono="bueno">{t("comun.guardado")}</Aviso>}

      {/* ── 1. EL INTERRUPTOR ─────────────────────────────────────────── */}
      <Tarjeta padded>
        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: encendido ? "var(--brand-soft)" : "var(--bg-elev-2)",
                color: encendido ? "var(--brand)" : "var(--text-4)",
                flexShrink: 0,
              }}
            >
              <Bot size={20} aria-hidden="true" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 750, color: "var(--text-1)" }}>
                  {encendido ? t("bot.estado.encendido") : t("bot.estado.apagado")}
                </span>
                <Pastilla tono={encendido ? "bueno" : "info"}>
                  {encendido ? t("bot.estado.encendido") : t("bot.estado.apagado")}
                </Pastilla>
              </div>
              <p
                style={{
                  margin: "5px 0 0",
                  fontSize: 12.5,
                  color: "var(--text-3)",
                  lineHeight: 1.6,
                  maxWidth: 560,
                }}
              >
                {t("bot.estado.avisoEncender")}
              </p>
            </div>
          </div>
          <Boton
            tono={encendido ? "peligro" : "primario"}
            disabled={!puedeEditar || guardando || faltaSql}
            onClick={() => void guardar({ enabled: !encendido })}
          >
            {encendido ? t("bot.estado.apagar") : t("bot.estado.encender")}
          </Boton>
        </div>
      </Tarjeta>

      {/* ── 2. GASTO Y CUPO ───────────────────────────────────────────── */}
      <Rejilla min={250}>
        <Tarjeta titulo={t("bot.gasto.title")} sub={t("bot.gasto.sub")}>
          <Rejilla min={130}>
            <Cifra
              label={t("bot.gasto.gastado")}
              valor={pesos(estado.spend.spentMxn)}
              tono={estado.spend.capReached ? "alerta" : undefined}
            />
            <Cifra label={t("bot.gasto.tope")} valor={pesos(estado.spend.capMxn)} />
            <Cifra label={t("bot.gasto.turnos")} valor={String(estado.spend.turns)} />
          </Rejilla>
          <Barra
            valor={estado.spend.spentMxn}
            de={estado.spend.capMxn}
            tono={estado.spend.capReached ? "alerta" : "info"}
          />
          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 11 }}>
            {estado.spend.capReached && <Aviso tono="alerta">{t("bot.gasto.topeAlcanzado")}</Aviso>}
            {borrador.aiDailyCapMxn === 0 && <Aviso tono="info">{t("bot.gasto.topeCero")}</Aviso>}
            <Campo
              label={t("bot.gasto.capLabel")}
              hint={t("bot.gasto.capHint")}
              htmlFor="realty-bot-cap"
            >
              <input
                id="realty-bot-cap"
                type="number"
                min={REALTY_BOT_AI_CAP_MIN}
                max={REALTY_BOT_AI_CAP_MAX}
                step={1}
                disabled={!puedeEditar}
                value={borrador.aiDailyCapMxn}
                onChange={(e) =>
                  setBorrador((s) => ({ ...s, aiDailyCapMxn: Number(e.target.value) }))
                }
                style={inputBase}
              />
            </Campo>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-4)" }}>
              {t("bot.gasto.modelo")}: <code>{estado.aiModel}</code>
            </p>
          </div>
        </Tarjeta>

        <Tarjeta titulo={t("bot.cupo.title")}>
          <Cifra
            label={t("bot.cupo.usados")}
            valor={`${estado.quota.used} ${t("comun.de")} ${estado.quota.limit}`}
            tono={estado.quota.tight ? "alerta" : undefined}
          />
          <Barra
            valor={estado.quota.used}
            de={estado.quota.limit}
            tono={estado.quota.tight ? "alerta" : "info"}
          />
          {estado.quota.tight && (
            <div style={{ marginTop: 12 }}>
              <Aviso tono="alerta">{t("bot.cupo.apretado")}</Aviso>
            </div>
          )}
        </Tarjeta>
      </Rejilla>

      {/* ── 3. CÓMO HABLA ─────────────────────────────────────────────── */}
      <Tarjeta
        titulo={t("bot.config.title")}
        accion={
          <Boton
            tono="primario"
            pequeno
            disabled={!puedeEditar || !dirty || guardando || faltaSql}
            onClick={() => void guardar(borrador)}
          >
            {guardando ? t("comun.guardando") : t("comun.guardar")}
          </Boton>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Rejilla min={210}>
            <Campo label={t("bot.config.tono")} htmlFor="realty-bot-tono">
              <select
                id="realty-bot-tono"
                disabled={!puedeEditar}
                value={borrador.tone}
                onChange={(e) =>
                  setBorrador((s) => ({ ...s, tone: e.target.value === "formal" ? "formal" : "cercano" }))
                }
                style={inputBase}
              >
                <option value="cercano">{t("bot.config.tonoCercano")}</option>
                <option value="formal">{t("bot.config.tonoFormal")}</option>
              </select>
            </Campo>

            <Campo
              label={t("bot.config.nombre")}
              hint={t("bot.config.nombreHint")}
              htmlFor="realty-bot-nombre"
            >
              <input
                id="realty-bot-nombre"
                type="text"
                maxLength={40}
                disabled={!puedeEditar}
                value={borrador.botName}
                onChange={(e) => setBorrador((s) => ({ ...s, botName: e.target.value }))}
                style={inputBase}
              />
            </Campo>

            <Campo
              label={t("bot.config.maxRespuestas")}
              hint={t("bot.config.maxRespuestasHint")}
              htmlFor="realty-bot-max"
            >
              <input
                id="realty-bot-max"
                type="number"
                min={REALTY_BOT_REPLIES_MIN}
                max={REALTY_BOT_REPLIES_MAX}
                disabled={!puedeEditar}
                value={borrador.maxRepliesPerContactPerDay}
                onChange={(e) =>
                  setBorrador((s) => ({
                    ...s,
                    maxRepliesPerContactPerDay: Number(e.target.value),
                  }))
                }
                style={inputBase}
              />
            </Campo>
          </Rejilla>

          <Campo
            label={t("bot.config.notas")}
            hint={t("bot.config.notasHint")}
            htmlFor="realty-bot-notas"
          >
            <textarea
              id="realty-bot-notas"
              maxLength={1200}
              disabled={!puedeEditar}
              value={borrador.notes}
              onChange={(e) => setBorrador((s) => ({ ...s, notes: e.target.value }))}
              style={areaBase}
            />
          </Campo>

          {/* Habilidades */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-2)",
                marginBottom: 10,
              }}
            >
              {t("bot.config.habilidades")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {REALTY_BOT_ABILITY_KEYS.map((k) => (
                <Interruptor
                  key={k}
                  checked={borrador.abilities[k]}
                  disabled={!puedeEditar}
                  label={REALTY_BOT_ABILITY_LABELS[k]}
                  onChange={(v) =>
                    setBorrador((s) => ({ ...s, abilities: { ...s.abilities, [k]: v } }))
                  }
                />
              ))}
            </div>
          </div>

          {/* Horario */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>
              {t("bot.config.horario")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <Interruptor
                checked={borrador.hours.mode === "always"}
                disabled={!puedeEditar}
                label={t("bot.config.horarioSiempre")}
                hint={t("bot.config.horarioSiempreHint")}
                onChange={(v) =>
                  setBorrador((s) => ({
                    ...s,
                    hours: { ...s.hours, mode: v ? "always" : "custom" },
                  }))
                }
              />
              {borrador.hours.mode === "custom" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 13,
                    padding: 14,
                    borderRadius: 12,
                    background: "var(--bg-elev-2)",
                    border: "1px solid var(--border-soft)",
                  }}
                >
                  <Rejilla min={140}>
                    <Campo label={t("bot.config.horarioDesde")} htmlFor="realty-bot-desde">
                      <input
                        id="realty-bot-desde"
                        type="time"
                        disabled={!puedeEditar}
                        value={hhmm(borrador.hours.startMinute)}
                        onChange={(e) =>
                          setBorrador((s) => ({
                            ...s,
                            hours: { ...s.hours, startMinute: minutos(e.target.value) },
                          }))
                        }
                        style={inputBase}
                      />
                    </Campo>
                    <Campo label={t("bot.config.horarioHasta")} htmlFor="realty-bot-hasta">
                      <input
                        id="realty-bot-hasta"
                        type="time"
                        disabled={!puedeEditar}
                        value={hhmm(Math.min(1439, borrador.hours.endMinute))}
                        onChange={(e) =>
                          setBorrador((s) => ({
                            ...s,
                            hours: { ...s.hours, endMinute: minutos(e.target.value) },
                          }))
                        }
                        style={inputBase}
                      />
                    </Campo>
                  </Rejilla>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 7 }}>
                      {t("bot.config.horarioDias")}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {DIAS.map((etiqueta, i) => {
                        const activo = borrador.hours.days.includes(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            disabled={!puedeEditar}
                            aria-pressed={activo}
                            onClick={() =>
                              setBorrador((s) => ({
                                ...s,
                                hours: {
                                  ...s.hours,
                                  days: activo
                                    ? s.hours.days.filter((d) => d !== i)
                                    : [...s.hours.days, i].sort((a, b) => a - b),
                                },
                              }))
                            }
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 9,
                              border: `1px solid ${activo ? "var(--brand)" : "var(--border-soft)"}`,
                              background: activo ? "var(--brand)" : "var(--bg)",
                              color: activo ? "#fff" : "var(--text-3)",
                              fontSize: 12,
                              fontWeight: 700,
                              fontFamily: "inherit",
                              cursor: puedeEditar ? "pointer" : "not-allowed",
                            }}
                          >
                            {etiqueta}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Tarjeta>

      {/* ── 4. CONVERSACIONES EN MANOS DE UNA PERSONA ─────────────────── */}
      <Tarjeta titulo={t("bot.pausas.title")} sub={t("bot.pausas.sub")}>
        {estado.pauses.length === 0 ? (
          <Vacio texto={t("bot.pausas.vacio")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {estado.pauses.map((p) => (
              <div
                key={p.phone}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 13px",
                  borderRadius: 11,
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0, display: "flex", gap: 9, alignItems: "center" }}>
                  <UserRound size={15} style={{ color: "var(--text-4)" }} aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: "var(--text-1)" }}>
                      {p.phone}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-4)" }}>
                      {p.reason || "—"} · {t("bot.pausas.desde")} {fechaHora(p.pausedAt, timeZone)}
                    </div>
                  </div>
                </div>
                <Boton
                  pequeno
                  disabled={!puedeEditar}
                  onClick={async () => {
                    await apiJson("/api/realty/bot/pause", {
                      method: "DELETE",
                      json: { phone: p.phone },
                    });
                    await recargar();
                  }}
                >
                  <Play size={12} aria-hidden="true" />
                  {t("bot.turnos.reanudar")}
                </Boton>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── 5. QUÉ CONTESTÓ ───────────────────────────────────────────── */}
      <Tarjeta
        titulo={t("bot.turnos.title")}
        sub={t("bot.turnos.sub")}
        accion={
          // El bot vive del BARRIDO (no se tocó el webhook), así que la
          // respuesta llega con el retraso del cron. Este botón deja que el
          // dueño lo vea trabajar ya, sin esperar la siguiente vuelta.
          <Boton
            pequeno
            disabled={!puedeEditar || !encendido || barriendo || faltaSql}
            onClick={async () => {
              setBarriendo(true);
              setError(null);
              const r = await apiJson<{ answered: number }>("/api/realty/bot/sweep", {
                method: "POST",
                json: {},
              });
              setBarriendo(false);
              if (!r.ok) {
                setError(r.error ?? t("errores.red"));
                return;
              }
              await recargar();
            }}
          >
            <Play size={12} aria-hidden="true" />
            {barriendo ? t("bot.turnos.contestandoPendiente") : t("bot.turnos.contestarPendiente")}
          </Boton>
        }
      >
        {estado.turns.length === 0 ? (
          <Vacio texto={t("bot.turnos.vacio")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {estado.turns.map((turno) => (
              <TurnoFila
                key={turno.id}
                turno={turno}
                t={t}
                timeZone={timeZone}
                puedeEditar={puedeEditar}
                onCorregir={() => setCorrigiendo(turno)}
                onPausar={async () => {
                  await apiJson("/api/realty/bot/pause", {
                    method: "POST",
                    json: { phone: turno.phone },
                  });
                  await recargar();
                }}
              />
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── 6. VISITAS QUE AGENDÓ ─────────────────────────────────────── */}
      <Tarjeta titulo={t("bot.visitas.title")}>
        {estado.visits.length === 0 ? (
          <Vacio texto={t("bot.visitas.vacio")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {estado.visits.map((v) => (
              <div
                key={v.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "9px 12px",
                  borderRadius: 10,
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  fontSize: 12.5,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: "var(--text-1)", fontWeight: 600 }}>
                  {v.propertyTitle} · {v.contactName || t("campanas.previa.sinNombre")}
                </span>
                <span style={{ color: "var(--text-3)" }}>
                  {fechaHora(v.scheduledAt, timeZone)} · {v.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      <CorregirModal
        turno={corrigiendo}
        t={t}
        onCerrar={() => setCorrigiendo(null)}
        onListo={async () => {
          setCorrigiendo(null);
          await recargar();
        }}
      />
    </div>
  );
}

/* ── Una fila de turno ──────────────────────────────────────────────── */

function TurnoFila({
  turno,
  t,
  timeZone,
  puedeEditar,
  onCorregir,
  onPausar,
}: {
  turno: RealtyBotTurnDTO;
  t: (k: string, v?: Record<string, string | number>) => string;
  timeZone: string;
  puedeEditar: boolean;
  onCorregir: () => void;
  onPausar: () => void | Promise<void>;
}) {
  return (
    <article
      style={{
        padding: 14,
        borderRadius: 13,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
            {turno.contactName || turno.phone}
          </span>
          {turno.handoff && <Pastilla tono="alerta">{t("bot.turnos.escalado")}</Pastilla>}
          {turno.correctedBody && <Pastilla tono="bueno">{t("bot.turnos.corregido")}</Pastilla>}
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>
          {fechaHora(turno.createdAt, timeZone)} · {t("bot.turnos.costo")} {pesos(turno.costMxn)}
        </span>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <Burbuja
          icono={<MessageSquare size={13} aria-hidden="true" />}
          titulo={t("bot.turnos.recibido")}
          texto={turno.inboundBody}
        />
        {turno.outboundBody ? (
          <Burbuja
            icono={<Bot size={13} aria-hidden="true" />}
            titulo={t("bot.turnos.contesto")}
            texto={turno.outboundBody}
            brand
          />
        ) : (
          <Aviso tono="info">
            {t("bot.turnos.noContesto")}
            {turno.skipReason ? ` — ${REALTY_BOT_SKIP_LABELS[turno.skipReason]}` : ""}
          </Aviso>
        )}
        {turno.correctedBody && (
          <Burbuja
            icono={<Pencil size={13} aria-hidden="true" />}
            titulo={t("bot.turnos.correccion")}
            texto={turno.correctedBody}
          />
        )}
      </div>

      <footer style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Boton pequeno disabled={!puedeEditar || !turno.outboundBody} onClick={onCorregir}>
          <Pencil size={12} aria-hidden="true" />
          {t("bot.turnos.corregir")}
        </Boton>
        <Boton pequeno disabled={!puedeEditar} onClick={() => void onPausar()}>
          <UserRound size={12} aria-hidden="true" />
          {t("bot.turnos.pausar")}
        </Boton>
      </footer>
    </article>
  );
}

function Burbuja({
  icono,
  titulo,
  texto,
  brand = false,
}: {
  icono: React.ReactNode;
  titulo: string;
  texto: string | null;
  brand?: boolean;
}) {
  return (
    <div
      style={{
        padding: "9px 12px",
        borderRadius: 10,
        background: brand ? "var(--brand-soft)" : "var(--bg)",
        border: `1px solid ${brand ? "var(--border-brand)" : "var(--border-soft)"}`,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          fontSize: 10.5,
          fontWeight: 700,
          color: "var(--text-4)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        {icono}
        {titulo}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          color: "var(--text-1)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {texto || "—"}
      </p>
    </div>
  );
}

/* ── Modal de corrección ────────────────────────────────────────────── */

function CorregirModal({
  turno,
  t,
  onCerrar,
  onListo,
}: {
  turno: RealtyBotTurnDTO | null;
  t: (k: string, v?: Record<string, string | number>) => string;
  onCerrar: () => void;
  onListo: () => void | Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // El modal se reusa entre turnos: sin esto, abrir el segundo enseñaría lo
  // que se escribió para el primero.
  useEffect(() => {
    setTexto(turno?.correctedBody ?? "");
    setError(null);
  }, [turno]);

  return (
    <Modal
      abierto={Boolean(turno)}
      onCerrar={onCerrar}
      titulo={t("bot.turnos.corregir")}
      cerrarLabel={t("comun.cerrar")}
      pie={
        <>
          <Boton tono="fantasma" onClick={onCerrar}>
            {t("comun.cancelar")}
          </Boton>
          <Boton
            tono="primario"
            disabled={enviando || texto.trim().length < 3}
            onClick={async () => {
              if (!turno) return;
              setEnviando(true);
              setError(null);
              const r = await apiJson("/api/realty/bot/turns", {
                method: "PATCH",
                json: { turnId: turno.id, correctedBody: texto.trim() },
              });
              setEnviando(false);
              if (!r.ok) {
                setError(r.error ?? t("errores.red"));
                return;
              }
              await onListo();
            }}
          >
            {enviando ? t("comun.guardando") : t("comun.guardar")}
          </Boton>
        </>
      }
    >
      {error && <Aviso tono="malo">{error}</Aviso>}
      <Aviso tono="info">{t("bot.turnos.correccionHint")}</Aviso>
      {turno?.outboundBody && (
        <Burbuja
          icono={<Bot size={13} aria-hidden="true" />}
          titulo={t("bot.turnos.contesto")}
          texto={turno.outboundBody}
        />
      )}
      <Campo label={t("bot.turnos.correccion")} htmlFor="realty-bot-correccion">
        <textarea
          id="realty-bot-correccion"
          value={texto}
          maxLength={1200}
          onChange={(e) => setTexto(e.target.value)}
          style={areaBase}
        />
      </Campo>
    </Modal>
  );
}
