"use client";

// ═══════════════════════════════════════════════════════════════════════
// Alta y edición de una visita. El objetivo es "2 clics": tocas un hueco y
// este modal ya viene con el barbero y la hora puestos; solo falta decir
// quién y qué servicio.
//
// La duración NO se escribe: sale de la suma de BarberService.durationMin.
// El precio que se ve aquí es el VIVO del catálogo; al guardar, el servidor
// lo congela en BarberAppointmentService.priceAtBooking.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, UserPlus } from "lucide-react";
import type { BarberAppointmentDTO, BarberDTO, BarberServiceDTO } from "@/lib/barber/types";
import {
  formatMXN,
  hhmmToMinute,
  minuteToHHMM,
  shopDateISO,
  shopLocalToUtc,
  shopMinuteOfDay,
  totalServiceMinutes,
  totalServicePrice,
} from "@/lib/barber/agenda";
import { Field, Modal, agendaCss as css } from "./agenda-ui";

interface ClientHit {
  id: string;
  name: string;
  phone: string;
  totalVisits: number;
  lastVisitAt: string | null;
  blocked: boolean;
}

export interface AppointmentDialogProps {
  mode: "create" | "edit";
  timezone: string;
  branchId: string;
  barbers: BarberDTO[];
  services: BarberServiceDTO[];
  canSearchClients: boolean;
  appointment?: BarberAppointmentDTO | null;
  initialBarberId?: string | null;
  initialStartAt?: Date | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onSaved: (appointment: BarberAppointmentDTO) => void;
}

export function AppointmentDialog(props: AppointmentDialogProps) {
  const { t, timezone, mode, appointment } = props;
  const editing = mode === "edit" && appointment;

  const activeBarbers = useMemo(() => props.barbers.filter((b) => b.isActive), [props.barbers]);
  const activeServices = useMemo(
    () => props.services.filter((s) => s.isActive),
    [props.services],
  );

  const startDate = editing ? new Date(appointment.startAt) : (props.initialStartAt ?? new Date());

  const [clientId, setClientId] = useState<string | null>(editing ? appointment.clientId : null);
  const [clientName, setClientName] = useState(editing ? (appointment.clientName ?? "") : "");
  const [clientPhone, setClientPhone] = useState(editing ? (appointment.clientPhone ?? "") : "");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [manual, setManual] = useState(Boolean(editing));

  const [barberId, setBarberId] = useState(
    editing ? (appointment.barberId ?? "") : (props.initialBarberId ?? activeBarbers[0]?.id ?? ""),
  );
  const [dateISO, setDateISO] = useState(shopDateISO(startDate, timezone));
  const [hhmm, setHhmm] = useState(minuteToHHMM(shopMinuteOfDay(startDate, timezone)));
  const [selected, setSelected] = useState<string[]>(
    editing ? appointment.services.map((s) => s.serviceId) : [],
  );
  const [notes, setNotes] = useState(editing ? (appointment.notes ?? "") : "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Buscador de clientes (con freno para no pegarle a cada tecla) ────
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!props.canSearchClients || manual || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/barber/appointments/clients?q=${encodeURIComponent(query.trim())}&branchId=${props.branchId}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = await res.json();
        setHits(Array.isArray(data.clients) ? data.clients : []);
      } catch {
        /* búsqueda cancelada o sin red: la UI se queda como estaba */
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, manual, props.canSearchClients, props.branchId]);

  const chosenServices = useMemo(
    () => activeServices.filter((s) => selected.includes(s.id)),
    [activeServices, selected],
  );
  const durationMin = chosenServices.length > 0 ? totalServiceMinutes(chosenServices) : 0;
  const price = totalServicePrice(chosenServices);

  const toggleService = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const pickClient = (hit: ClientHit) => {
    setClientId(hit.id);
    setClientName(hit.name);
    setClientPhone(hit.phone);
    setHits([]);
    setQuery("");
  };

  const clearClient = () => {
    setClientId(null);
    setClientName("");
    setClientPhone("");
    setManual(false);
  };

  const submit = async () => {
    setError(null);
    if (!clientName.trim()) return setError(t("barber.agenda.modal.errors.client"));
    if (selected.length === 0) return setError(t("barber.agenda.modal.errors.services"));
    if (!barberId) return setError(t("barber.agenda.modal.errors.barber"));
    const minute = hhmmToMinute(hhmm);
    if (minute === null) return setError(t("barber.agenda.modal.errors.time"));

    const startAt = shopLocalToUtc(dateISO, minute, timezone);
    setSaving(true);
    try {
      const url = editing
        ? `/api/barber/appointments/${appointment.id}`
        : "/api/barber/appointments";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: props.branchId,
          barberId,
          startAt: startAt.toISOString(),
          serviceIds: selected,
          notes: notes.trim() || null,
          clientId,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("barber.agenda.queue.errors.generic"));
        return;
      }
      props.onSaved(data.appointment as BarberAppointmentDTO);
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t(editing ? "barber.agenda.modal.editTitle" : "barber.agenda.modal.newTitle")}
      onClose={props.onClose}
      closeLabel={t("barber.agenda.actions.close")}
      footer={
        <>
          <button type="button" className={css.btn} onClick={props.onClose} disabled={saving}>
            {t("barber.agenda.actions.cancel")}
          </button>
          <button
            type="button"
            className={`${css.btn} ${css.btnPrimary}`}
            onClick={submit}
            disabled={saving}
          >
            {saving
              ? t("barber.agenda.modal.saving")
              : t(editing ? "barber.agenda.modal.saveEdit" : "barber.agenda.modal.save")}
          </button>
        </>
      }
    >
      {error ? <div className={css.errorBox}>{error}</div> : null}

      {/* ── Cliente ── */}
      {clientName && (clientId || manual) ? (
        <Field label={t("barber.agenda.modal.client")}>
          <div className={css.chosen}>
            <span>
              <strong className={css.resultName}>{clientName}</strong>
              {clientPhone ? <span className={css.resultMeta}> · {clientPhone}</span> : null}
            </span>
            <button type="button" className={css.btn} onClick={clearClient}>
              {t("barber.agenda.modal.changeClient")}
            </button>
          </div>
        </Field>
      ) : (
        <Field
          label={t("barber.agenda.modal.client")}
          hint={props.canSearchClients ? t("barber.agenda.modal.searchHint") : null}
        >
          {props.canSearchClients ? (
            <>
              <div style={{ position: "relative" }}>
                <Search
                  size={15}
                  style={{
                    position: "absolute",
                    left: 11,
                    top: 11,
                    color: "var(--text-4)",
                    pointerEvents: "none",
                  }}
                />
                <input
                  className={css.input}
                  style={{ paddingLeft: 33 }}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("barber.agenda.modal.searchPlaceholder")}
                  autoComplete="off"
                />
              </div>
              {hits.length > 0 ? (
                <div className={css.results}>
                  {hits.map((hit) => (
                    <button
                      type="button"
                      key={hit.id}
                      className={css.resultItem}
                      onClick={() => pickClient(hit)}
                    >
                      <span className={css.resultName}>{hit.name}</span>
                      <span className={css.resultMeta}>
                        {hit.phone} ·{" "}
                        {t("barber.agenda.modal.visits", { count: hit.totalVisits })}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {query.trim().length >= 2 && hits.length === 0 ? (
                <p className={css.hint}>{t("barber.agenda.modal.noResults")}</p>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            className={css.btn}
            onClick={() => {
              setManual(true);
              setClientName(query.trim());
              setQuery("");
            }}
            style={{ alignSelf: "flex-start" }}
          >
            <UserPlus size={14} /> {t("barber.agenda.modal.newClient")}
          </button>
        </Field>
      )}

      {manual && !clientId ? (
        <div className={css.row}>
          <Field label={t("barber.agenda.modal.clientName")}>
            <input
              className={css.input}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={t("barber.agenda.modal.clientPhone")}>
            <input
              className={css.input}
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
        </div>
      ) : null}

      {/* ── Servicios ── */}
      <Field label={t("barber.agenda.modal.services")}>
        {activeServices.length === 0 ? (
          <p className={css.hint}>{t("barber.agenda.modal.servicesEmpty")}</p>
        ) : (
          <div className={css.chips}>
            {activeServices.map((service) => {
              const on = selected.includes(service.id);
              return (
                <button
                  type="button"
                  key={service.id}
                  className={`${css.chip} ${on ? css.chipOn : ""}`}
                  onClick={() => toggleService(service.id)}
                  aria-pressed={on}
                >
                  {on ? <Check size={13} /> : null}
                  {service.name}
                  <span className={css.chipMeta}>
                    {service.durationMin}′ · {formatMXN(service.price)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Field>

      {/* ── Barbero, fecha y hora ── */}
      <div className={css.row}>
        <Field label={t("barber.agenda.modal.barber")}>
          <select
            className={css.select}
            value={barberId}
            onChange={(e) => setBarberId(e.target.value)}
          >
            {activeBarbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nickname || b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("barber.agenda.modal.date")}>
          <input
            type="date"
            className={css.input}
            value={dateISO}
            onChange={(e) => setDateISO(e.target.value)}
          />
        </Field>
      </div>

      <div className={css.row}>
        <Field label={t("barber.agenda.modal.time")}>
          <input
            type="time"
            step={900}
            className={css.input}
            value={hhmm}
            onChange={(e) => setHhmm(e.target.value)}
          />
        </Field>
        <Field label={t("barber.agenda.modal.duration")}>
          <input
            className={css.input}
            value={t("barber.agenda.modal.durationValue", { min: durationMin })}
            readOnly
            tabIndex={-1}
          />
        </Field>
      </div>

      <div className={css.totals}>
        <span>{t("barber.agenda.modal.total")}</span>
        <span className={css.totalsValue}>{formatMXN(price)}</span>
      </div>
      <p className={css.hint}>{t("barber.agenda.modal.priceFrozen")}</p>

      <Field label={t("barber.agenda.modal.notes")}>
        <textarea
          className={css.textarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("barber.agenda.modal.notesPlaceholder")}
          maxLength={500}
        />
      </Field>
    </Modal>
  );
}
