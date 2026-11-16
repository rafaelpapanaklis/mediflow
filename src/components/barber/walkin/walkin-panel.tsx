"use client";

// ═══════════════════════════════════════════════════════════════════════
// Panel de la FILA VIRTUAL. 7 de cada 10 clientes de barbería llegan sin
// cita y el que no ve su lugar se va. Esta pantalla es la respuesta: la
// fila en orden, con acciones grandes y el QR listo para imprimir.
//
// "Pasar a la silla" NO es un cambio de etiqueta: convierte la entrada en
// una VISITA EN SILLA de la agenda, para que el cobro y la comisión salgan
// de ahí y no de un registro paralelo.
//
// El aviso por WhatsApp de esta ola solo REGISTRA el evento (encola una
// fila BarberMessage PENDING). El envío lo conecta la ola de WhatsApp.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, LogOut, MessageCircle, Plus, RefreshCw, Scissors, Volume2 } from "lucide-react";
import { type Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import {
  BARBER_WALKIN_STATUS_UI,
  type BarberDTO,
  type BarberWalkInDTO,
  type BarberWalkInStatus,
} from "@/lib/barber/types";
import {
  formatMinutes,
  formatWaitMinutes,
  minuteToLabel,
  shopMinuteOfDay,
} from "@/lib/barber/agenda";
import { Field, Modal, Pill, agendaCss } from "@/components/barber/agenda/agenda-ui";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import { mxTenDigits } from "@/lib/phone-mx";
import { WalkinQr } from "./walkin-qr";
import { ChatClienteLink } from "../wa-chat";
import { TelefonoConPais } from "@/components/barber/telefono-con-pais";
import { panelPhone } from "@/lib/barber/telefono-panel";
import { barberPhoneCountry } from "@/lib/barber/phone-countries";
import { BarberoSelect } from "@/components/barber/agenda/barbero-select";
import type { BarberPick } from "@/lib/barber/quien-trabaja";
import css from "./walkin.module.css";

interface QueueRow extends BarberWalkInDTO {
  rank: number;
  ahead: number;
  etaMinutes: number;
}

interface ServiceLite {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}

interface Payload {
  branchId: string;
  timezone: string;
  chairs: number;
  avgServiceMin: number;
  barbers: BarberDTO[];
  services: ServiceLite[];
  queue: QueueRow[];
  recent: BarberWalkInDTO[];
  /** «¿Con quién?»: quién trabaja hoy y a quién se propone (quien-trabaja.ts). Opcional: una API vieja no lo manda. */
  pick?: BarberPick;
  /** Siguen «esperando» desde antes de hoy (no cuentan en la fila de hoy). */
  staleCount?: number;
}

export interface WalkinPanelProps {
  dict: Dictionary;
  timezone: string;
  branchId: string;
  slug: string;
  shopName: string;
}

export function WalkinPanel(props: WalkinPanelProps) {
  const t = useMemo(() => makeBarberT(props.dict), [props.dict]);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [serving, setServing] = useState<QueueRow | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(`/api/barber/walkins?branchId=${props.branchId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(typeof body.error === "string" ? body.error : t("barber.agenda.state.error"));
          return;
        }
        setData((await res.json()) as Payload);
        setError(null);
      } catch {
        setError(t("barber.agenda.state.error"));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [props.branchId, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // La fila se mueve sola: refresco cada 20 s, pero solo con la pestaña a
  // la vista (una pestaña de fondo no tiene a nadie mirándola).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 20_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const act = async (row: BarberWalkInDTO, action: string, extra?: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/barber/walkins/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, branchId: props.branchId, ...(extra ?? {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : t("barber.agenda.queue.errors.generic"));
        return false;
      }
      setError(null);
      await load(true);
      return true;
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
      return false;
    }
  };

  const notify = async (row: BarberWalkInDTO) => {
    try {
      const res = await fetch(`/api/barber/walkins/${row.id}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: props.branchId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : t("barber.agenda.queue.errors.generic"));
        return;
      }
      setNotice(
        body.queued ? t("barber.agenda.queue.notify.queued") : t("barber.agenda.queue.notify.already"),
      );
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
    }
  };

  // «De ayer (N) · Sacarlos»: los marca «Se fue» (no se borra nada).
  const [clearingStale, setClearingStale] = useState(false);
  const clearStale = async () => {
    setClearingStale(true);
    try {
      const res = await fetch("/api/barber/walkins/de-ayer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: props.branchId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : t("barber.agenda.queue.errors.generic"));
        return;
      }
      setError(null);
      setNotice(t("barber.agenda.queue.stale.done", { count: typeof body.cleared === "number" ? body.cleared : 0 }));
      await load(true);
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
    } finally {
      setClearingStale(false);
    }
  };

  const queue = data?.queue ?? [];

  return (
    <div>
      <div className={agendaCss.toolbar}>
        <div className={agendaCss.dateBlock}>
          <h1 className={agendaCss.dateTitle}>{t("barber.agenda.queue.title")}</h1>
          <p className={agendaCss.dateSub}>
            {t("barber.agenda.queue.waiting", { count: queue.length })}
            {data ? ` · ${t("barber.agenda.queue.eta")} ${data.avgServiceMin} min` : ""}
          </p>
        </div>
        <span className={agendaCss.toolbarSpacer} />
        <button
          type="button"
          className={`${agendaCss.btn} ${agendaCss.btnIcon}`}
          onClick={() => void load()}
          aria-label={t(error ? "barber.agenda.actions.retry" : "barber.agenda.actions.refresh")}
          title={t(error ? "barber.agenda.actions.retry" : "barber.agenda.actions.refresh")}
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className={`${agendaCss.btn} ${agendaCss.btnPrimary}`}
          onClick={() => setAdding(true)}
        >
          <Plus size={15} /> {t("barber.agenda.queue.add")}
        </button>
      </div>

      {error ? <div className={agendaCss.errorBox} style={{ marginBottom: 12 }}>{error}</div> : null}
      {notice ? (
        <div className={agendaCss.totals} style={{ marginBottom: 12 }}>
          <span>{notice}</span>
        </div>
      ) : null}
      {/* Los que se anotaron antes de hoy y nadie sacó: ya no cuentan en la
          fila de hoy (fila-del-dia.ts); se marcan «Se fue» SOLO al pulsar. */}
      {data && (data.staleCount ?? 0) > 0 ? (
        <div className={agendaCss.totals} style={{ marginBottom: 12, alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>{t("barber.agenda.queue.stale.text", { count: data.staleCount ?? 0 })}</span>
          <button
            type="button"
            className={`${agendaCss.btn} ${agendaCss.btnSm}`}
            disabled={clearingStale}
            onClick={() => void clearStale()}
          >
            <LogOut size={14} /> {t("barber.agenda.queue.stale.clear")}
          </button>
        </div>
      ) : null}

      <div className={css.layout}>
        <div>
          <div className={css.panel}>
            <div className={css.panelHead}>
              <div>
                <p className={css.panelSub}>{t("barber.agenda.queue.subtitle")}</p>
              </div>
            </div>

            <div className={css.panelBody}>
              {loading && !data ? (
                <div className={agendaCss.empty}>{t("barber.agenda.state.loading")}</div>
              ) : queue.length === 0 ? (
                <div className={agendaCss.empty}>
                  <p className={agendaCss.emptyTitle}>{t("barber.agenda.queue.empty")}</p>
                  <p>{t("barber.agenda.queue.emptyHint")}</p>
                </div>
              ) : (
                queue.map((row) => {
                  const barber = data?.barbers.find((b) => b.id === row.barberId);
                  const waited = Math.max(
                    0,
                    Math.round((Date.now() - new Date(row.joinedAt).getTime()) / 60_000),
                  );
                  const ui = BARBER_WALKIN_STATUS_UI[row.status as BarberWalkInStatus];
                  return (
                    <div
                      key={row.id}
                      className={`${css.row} ${row.status === "CALLED" ? css.rowCalled : ""}`}
                    >
                      <span className={`${css.rank} ${row.rank === 1 ? css.rankNext : ""}`}>
                        {row.rank}
                      </span>

                      <div className={css.rowMain}>
                        <div className={css.rowName}>
                          {row.clientName} <Pill tone={ui.tone}>{ui.label}</Pill>
                        </div>
                        <div className={css.rowMeta}>
                          {t("barber.agenda.queue.joinedAt", {
                            time: minuteToLabel(
                              shopMinuteOfDay(new Date(row.joinedAt), props.timezone),
                            ),
                          })}
                          {" · "}
                          {t("barber.agenda.queue.waitingSince", {
                            wait: formatMinutes(waited),
                          })}
                          {barber ? ` · ${barber.nickname || barber.name}` : ""}
                          {row.phone ? ` · ${formatBarberPhone(row.phone)}` : ""}
                        </div>
                      </div>

                      <div className={css.eta}>
                        {t("barber.agenda.queue.eta")}
                        <span className={css.etaValue}>{formatWaitMinutes(row.etaMinutes)}</span>
                      </div>

                      <div className={css.rowActions}>
                        {row.status === "WAITING" ? (
                          <button
                            type="button"
                            className={agendaCss.btn}
                            onClick={() => void act(row, "call")}
                          >
                            <Volume2 size={14} /> {t("barber.agenda.queue.actions.call")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`${agendaCss.btn} ${agendaCss.btnPrimary}`}
                          onClick={() => setServing(row)}
                        >
                          <Scissors size={14} /> {t("barber.agenda.queue.actions.serve")}
                        </button>
                        {row.status !== "WAITING" ? (
                          // Ya se llamó: lo principal es sentarlo; volver a la fila es lo raro.
                          <button
                            type="button"
                            className={agendaCss.btn}
                            onClick={() => void act(row, "wait")}
                          >
                            {t("barber.agenda.queue.actions.uncall")}
                          </button>
                        ) : null}
                        {/* El aviso sale por el WhatsApp de la barbería: hoy solo a números de México. */}
                        {mxTenDigits(row.phone ?? "") ? (
                          <button
                            type="button"
                            className={agendaCss.btn}
                            onClick={() => void notify(row)}
                            title={t("barber.agenda.queue.notify.explain")}
                          >
                            <BellRing size={14} /> {t("barber.agenda.queue.actions.notify")}
                          </button>
                        ) : null}
                        {mxTenDigits(row.phone) ? (
                          <ChatClienteLink className={agendaCss.btn} phone={row.phone}>
                            <MessageCircle size={14} /> {t("barber.agenda.cita.client.whatsapp")}
                          </ChatClienteLink>
                        ) : null}
                        <button
                          type="button"
                          className={`${agendaCss.btn} ${agendaCss.btnDanger}`}
                          onClick={() => void act(row, "left")}
                        >
                          <LogOut size={14} /> {t("barber.agenda.queue.actions.left")}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {data && data.recent.length > 0 ? (
            <div className={css.panel} style={{ marginTop: 16 }}>
              <div className={css.panelHead}>
                <h2 className={css.panelTitle}>{t("barber.agenda.queue.recent")}</h2>
              </div>
              <div className={css.panelBody}>
                {data.recent.map((row) => (
                  <div key={row.id} className={css.row}>
                    <div className={css.rowMain}>
                      <div className={css.rowName}>{row.clientName}</div>
                      <div className={css.rowMeta}>
                        {BARBER_WALKIN_STATUS_UI[row.status as BarberWalkInStatus].label}
                      </div>
                    </div>
                    {row.status === "LEFT" ? (
                      <button
                        type="button"
                        className={agendaCss.btn}
                        onClick={() => void act(row, "restore")}
                      >
                        {t("barber.agenda.queue.actions.uncall")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <WalkinQr slug={props.slug} shopName={props.shopName} t={t} />
      </div>

      {adding && data ? (
        <AddWalkInDialog
          t={t}
          branchId={props.branchId}
          barbers={data.barbers}
          pick={data.pick ?? null}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void load(true);
          }}
        />
      ) : null}

      {serving && data ? (
        <ServeDialog
          t={t}
          row={serving}
          barbers={data.barbers}
          pick={data.pick ?? null}
          services={data.services}
          onClose={() => setServing(null)}
          onConfirm={async (barberId, serviceIds) => {
            const ok = await act(serving, "serve", { barberId, serviceIds });
            if (ok) {
              setNotice(t("barber.agenda.queue.servedOk", { name: serving.clientName }));
              setServing(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ── Anotar a alguien desde el mostrador ────────────────────────────────

function AddWalkInDialog(props: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  branchId: string;
  barbers: BarberDTO[];
  pick: BarberPick | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = props;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // México por omisión; el turista elige su país (telefono-panel.ts).
  const [phoneIso, setPhoneIso] = useState("MX");
  const [barberId, setBarberId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setError(t("barber.agenda.queue.errors.name"));
    // Un teléfono a medias no se descarta en silencio: se avisa (igual que en la agenda).
    if (phone.trim()) {
      const tel = panelPhone(phoneIso, phone);
      if (!tel.ok) {
        const c = barberPhoneCountry(phoneIso);
        return setError(
          c.iso === "MX"
            ? t("barber.agenda.modal.errors.phone")
            : t("barber.agenda.modal.errors.phoneOther", { country: c.name, len: c.len }),
        );
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/barber/walkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: props.branchId,
          clientName: name.trim(),
          phone: phone.trim(),
          phoneCountry: phoneIso,
          barberId: barberId || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : t("barber.agenda.queue.errors.generic"));
        return;
      }
      props.onAdded();
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("barber.agenda.queue.addTitle")}
      onClose={props.onClose}
      closeLabel={t("barber.agenda.actions.close")}
      footer={
        <>
          <button type="button" className={agendaCss.btn} onClick={props.onClose}>
            {t("barber.agenda.actions.cancel")}
          </button>
          <button
            type="button"
            className={`${agendaCss.btn} ${agendaCss.btnPrimary}`}
            onClick={submit}
            disabled={busy}
          >
            {t("barber.agenda.queue.join")}
          </button>
        </>
      }
    >
      {error ? <div className={agendaCss.errorBox}>{error}</div> : null}
      <Field label={t("barber.agenda.queue.name")}>
        <input className={agendaCss.input} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("barber.agenda.queue.phone")} hint={t("barber.agenda.queue.phoneHint")}>
        <TelefonoConPais
          iso={phoneIso}
          onIsoChange={setPhoneIso}
          value={phone}
          onValueChange={setPhone}
          selectClassName={agendaCss.select}
          inputClassName={agendaCss.input}
          countryLabel={t("barber.agenda.modal.phoneCountry")}
          inputLabel={t("barber.agenda.queue.phone")}
          placeholderMx={t("barber.agenda.modal.phonePlaceholderMx")}
          placeholderOther={t("barber.agenda.modal.phonePlaceholderOther")}
        />
      </Field>
      <Field label={t("barber.agenda.queue.barber")}>
        <BarberoSelect
          barbers={props.barbers}
          pick={props.pick}
          value={barberId}
          onChange={setBarberId}
          anyLabel={t("barber.agenda.queue.anyBarber")}
          t={t}
          isToday
        />
      </Field>
    </Modal>
  );
}

// ── Pasar a la silla ───────────────────────────────────────────────────

function ServeDialog(props: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  row: QueueRow;
  barbers: BarberDTO[];
  pick: BarberPick | null;
  services: ServiceLite[];
  onClose: () => void;
  onConfirm: (barberId: string, serviceIds: string[]) => void | Promise<void>;
}) {
  const { t } = props;
  // El que pidió (si pidió a alguien); si no, el que trabaja ahora y está libre.
  const [barberId, setBarberId] = useState(
    props.row.barberId ?? props.pick?.suggested ?? props.barbers.find((b) => b.isActive)?.id ?? "",
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      title={t("barber.agenda.queue.serveTitle")}
      onClose={props.onClose}
      closeLabel={t("barber.agenda.actions.close")}
      footer={
        <>
          <button type="button" className={agendaCss.btn} onClick={props.onClose}>
            {t("barber.agenda.actions.cancel")}
          </button>
          <button
            type="button"
            className={`${agendaCss.btn} ${agendaCss.btnPrimary}`}
            disabled={busy || !barberId}
            onClick={async () => {
              // Una visita de $0 por olvido no sirve para cobrar ni para la comisión.
              if (selected.length === 0) return setError(t("barber.agenda.queue.errors.serveService"));
              setError(null);
              setBusy(true);
              await props.onConfirm(barberId, selected);
              setBusy(false);
            }}
          >
            {t("barber.agenda.queue.serveConfirm")}
          </button>
        </>
      }
    >
      {error ? <div className={agendaCss.errorBox}>{error}</div> : null}
      <p className={agendaCss.hint}>{t("barber.agenda.queue.serveBody")}</p>
      <Field label={t("barber.agenda.queue.barber")}>
        <BarberoSelect
          barbers={props.barbers}
          pick={props.pick}
          value={barberId}
          onChange={setBarberId}
          t={t}
          isToday
        />
      </Field>
      <Field label={t("barber.agenda.modal.services")}>
        <div className={agendaCss.chips}>
          {props.services.map((service) => {
            const on = selected.includes(service.id);
            return (
              <button
                type="button"
                key={service.id}
                className={`${agendaCss.chip} ${on ? agendaCss.chipOn : ""}`}
                aria-pressed={on}
                onClick={() =>
                  setSelected((prev) =>
                    prev.includes(service.id)
                      ? prev.filter((id) => id !== service.id)
                      : [...prev, service.id],
                  )
                }
              >
                {service.name}
                <span className={agendaCss.chipMeta}>{service.durationMin}′</span>
              </button>
            );
          })}
        </div>
      </Field>
    </Modal>
  );
}
