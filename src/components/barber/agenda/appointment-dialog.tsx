"use client";

// ═══════════════════════════════════════════════════════════════════════
// Alta y edición de una visita. El objetivo es "2 clics": tocas un hueco y
// este modal ya viene con el barbero y la hora puestos; solo falta decir
// quién y qué servicio.
//
// La duración la PROPONE el catálogo (suma de BarberService.durationMin) y
// se puede pisar a mano: el catálogo describe el caso normal, no el pelo de
// hoy. Mientras nadie la toque, sigue a los servicios sola; en cuanto se
// toca, manda lo escrito y el servidor lo vuelve a acotar con el mismo
// helper. El precio que se ve aquí es el VIVO del catálogo; al guardar, el
// servidor lo congela en BarberAppointmentService.priceAtBooking.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, RotateCcw, Search, UserPlus } from "lucide-react";
import type { BarberAppointmentDTO, BarberDTO, BarberServiceDTO } from "@/lib/barber/types";
import {
  BARBER_DURATION_STEP_MIN,
  BARBER_MAX_APPOINTMENT_MIN,
  BARBER_MIN_APPOINTMENT_MIN,
  appointmentMinutes,
  clampAppointmentMinutes,
  formatMXN,
  hhmmToMinute,
  minuteToHHMM,
  shopDateISO,
  shopLocalToUtc,
  shopMinuteOfDay,
  totalServiceMinutes,
  totalServicePrice,
} from "@/lib/barber/agenda";
import { panelPhone, splitStoredPhone } from "@/lib/barber/telefono-panel";
import { barberPhoneCountry } from "@/lib/barber/phone-countries";
import { TelefonoConPais } from "@/components/barber/telefono-con-pais";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import { Field, Modal, agendaCss as css } from "./agenda-ui";
import { BarberoSelect } from "./barbero-select";
import { pickBarbers, type TimeOffLike, type VisitLike } from "@/lib/barber/quien-trabaja";
import type { ScheduleLike } from "@/lib/barber/agenda";

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
  /**
   * Horarios, bloqueos y visitas que la Agenda ya tiene cargados: con ellos
   * «¿Con quién?» lista solo a los que trabajan el día elegido (con «Ver
   * todos»). Sin ellos (null) se listan todos, como antes.
   */
  roster?: { schedules: ScheduleLike[]; timeOff: TimeOffLike[]; visits: (VisitLike & { startAt: string })[] } | null;
  initialStartAt?: Date | null;
  /**
   * Campo que recibe el foco al abrir (los botones directos de la cita:
   * «Mover de hora», «Cambiar barbero», «Cambiar servicios»).
   */
  focus?: AppointmentDialogFocus | null;
  /**
   * «Repetir esta cita» (solo en alta): cliente, servicios, barbero, duración
   * y nota copiados de otra visita. La hora la pone initialStartAt.
   */
  prefill?: BarberAppointmentDTO | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onSaved: (appointment: BarberAppointmentDTO) => void;
}

export type AppointmentDialogFocus = "time" | "barber" | "services";

export function AppointmentDialog(props: AppointmentDialogProps) {
  const { t, timezone, mode, appointment } = props;
  const editing = mode === "edit" && appointment;
  // Lo que se copia: la visita que se edita, o la que se repite.
  const source = editing ? appointment : mode === "create" ? (props.prefill ?? null) : null;

  const activeBarbers = useMemo(() => props.barbers.filter((b) => b.isActive), [props.barbers]);
  const activeServices = useMemo(
    () => props.services.filter((s) => s.isActive),
    [props.services],
  );

  const startDate = editing ? new Date(appointment.startAt) : (props.initialStartAt ?? new Date());

  const [clientId, setClientId] = useState<string | null>(source ? source.clientId : null);
  const [clientName, setClientName] = useState(source ? (source.clientName ?? "") : "");
  // Teléfono escrito a mano: país + número local. Lo guardado («+34…») se parte
  // para que al editar se vea su bandera (telefono-panel.ts).
  const [clientPhone, setClientPhone] = useState(
    source ? (source.clientId ? (source.clientPhone ?? "") : splitStoredPhone(source.clientPhone).local) : "",
  );
  const [phoneIso, setPhoneIso] = useState(source ? splitStoredPhone(source.clientPhone).iso || "MX" : "MX");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [manual, setManual] = useState(Boolean(editing) || Boolean(source?.clientName));

  const [barberId, setBarberId] = useState(
    editing
      ? (appointment.barberId ?? "")
      : (props.initialBarberId ??
          // Al repetir, el mismo barbero si sigue activo.
          (source?.barberId && activeBarbers.some((b) => b.id === source.barberId)
            ? source.barberId
            : null) ??
          activeBarbers[0]?.id ??
          ""),
  );
  const [dateISO, setDateISO] = useState(shopDateISO(startDate, timezone));

  // «¿Con quién?»: los que trabajan el día ELEGIDO (cambia con la fecha).
  // Las visitas solo cuentan si son de ese día (la silla ocupada es de hoy).
  const roster = props.roster ?? null;
  const isToday = dateISO === shopDateISO(new Date(), timezone);
  const pick = useMemo(
    () =>
      roster
        ? pickBarbers({
            barbers: activeBarbers,
            schedules: roster.schedules,
            timeOff: roster.timeOff,
            visits: roster.visits.filter((v) => shopDateISO(new Date(v.startAt), timezone) === dateISO),
            dateISO,
            timezone,
            now: new Date(),
          })
        : null,
    [roster, activeBarbers, dateISO, timezone],
  );
  const [hhmm, setHhmm] = useState(minuteToHHMM(shopMinuteOfDay(startDate, timezone)));
  const [selected, setSelected] = useState<string[]>(() => {
    if (!source) return [];
    const ids = source.services.map((s) => s.serviceId);
    // Al repetir solo se copian los que siguen a la venta: uno dado de baja
    // no se puede volver a agendar (el servidor lo rechazaría).
    return editing ? ids : ids.filter((id) => activeServices.some((s) => s.id === id));
  });
  const [notes, setNotes] = useState(source ? (source.notes ?? "") : "");

  // ── Foco en el campo que se pidió («Mover de hora», «Cambiar barbero»…).
  // El efecto del Modal (hijo) corre ANTES que este: aquí se pisa su foco
  // en el primer campo.
  const timeRef = useRef<HTMLInputElement | null>(null);
  const barberRef = useRef<HTMLSelectElement | null>(null);
  const servicesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const target =
      props.focus === "time"
        ? timeRef.current
        : props.focus === "barber"
          ? barberRef.current
          : props.focus === "services"
            ? servicesRef.current?.querySelector<HTMLElement>("button") ?? null
            : null;
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus();
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El aviso va arriba del formulario, que se desplaza: sin esto, quien
  // pulsa «Agendar» desde el pie no ve por qué no pasó nada.
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
  // Texto que se está tecleando en «Duración» (permite borrar y reescribir).
  const [durDraft, setDurDraft] = useState<string | null>(null);

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
  const catalogMinutes = chosenServices.length > 0 ? totalServiceMinutes(chosenServices) : 0;
  const price = totalServicePrice(chosenServices);

  // Duración a mano. `null` = "sigue al catálogo". Al editar arranca a mano
  // solo si la visita guardada YA no coincide con lo que suma su catálogo:
  // si coincide, tocar un servicio debe seguir ajustando la duración sola.
  const [customMinutes, setCustomMinutes] = useState<number | null>(() => {
    // Al repetir también: si la original duró distinto que su catálogo, la
    // copia dura lo mismo que la original.
    if (!source) return null;
    const saved = appointmentMinutes(source);
    const fromCatalog = totalServiceMinutes(
      props.services.filter((s) => source.services.some((x) => x.serviceId === s.id)),
    );
    return saved === fromCatalog ? null : saved;
  });
  const durationMin = customMinutes ?? catalogMinutes;
  const durationEditable = durationMin > 0 || customMinutes !== null;

  const setDuration = (next: number) => {
    const clamped = clampAppointmentMinutes(next);
    if (clamped !== null) setCustomMinutes(clamped);
  };

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
    setPhoneIso("MX");
    setManual(false);
  };

  const submit = async () => {
    setError(null);
    if (!clientName.trim()) return setError(t("barber.agenda.modal.errors.client"));
    // Un cliente ya elegido de la lista trae su teléfono bueno. Lo escrito a
    // mano, si no es de 10 dígitos, se avisa AQUÍ: antes el servidor guardaba
    // la visita sin ligar al cliente y sin decir nada.
    if (!clientId && clientPhone.trim() && !panelPhone(phoneIso, clientPhone).ok) {
      const c = barberPhoneCountry(phoneIso);
      if (c.iso !== "MX") return setError(t("barber.agenda.modal.errors.phoneOther", { country: c.name, len: c.len }));
      return setError(t("barber.agenda.modal.errors.phone"));
    }
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
          // Solo viaja si alguien la escribió: sin esto, el servidor la
          // calcula del catálogo como siempre.
          durationMin: customMinutes,
          notes: notes.trim() || null,
          clientId,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          clientPhoneCountry: phoneIso,
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
      {error ? <div ref={errorRef} className={css.errorBox}>{error}</div> : null}

      {/* ── Cliente ── */}
      {clientId && clientName ? (
        <Field label={t("barber.agenda.modal.client")}>
          <div className={css.chosen}>
            <span>
              <strong className={css.resultName}>{clientName}</strong>
              {clientPhone ? <span className={css.resultMeta}> · {formatBarberPhone(clientPhone)}</span> : null}
            </span>
            <button type="button" className={css.btn} onClick={clearClient}>
              {t("barber.agenda.modal.changeClient")}
            </button>
          </div>
        </Field>
      ) : manual ? (
        // Cliente nuevo: los campos de abajo SON la captura; no se repite el nombre en
        // una tarjeta mientras se teclea. La tarjeta solo sale al elegir de la lista.
        editing || !props.canSearchClients ? null : (
          <Field label={t("barber.agenda.modal.client")}>
            <button type="button" className={css.btn} onClick={clearClient} style={{ alignSelf: "flex-start" }}>
              <Search size={14} /> {t("barber.agenda.modal.searchExisting")}
            </button>
          </Field>
        )
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
                        {formatBarberPhone(hit.phone)} ·{" "}
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
            <TelefonoConPais
              iso={phoneIso}
              onIsoChange={setPhoneIso}
              value={clientPhone}
              onValueChange={setClientPhone}
              selectClassName={css.select}
              inputClassName={css.input}
              countryLabel={t("barber.agenda.modal.phoneCountry")}
              inputLabel={t("barber.agenda.modal.clientPhone")}
              placeholderMx={t("barber.agenda.modal.phonePlaceholderMx")}
              placeholderOther={t("barber.agenda.modal.phonePlaceholderOther")}
            />
          </Field>
        </div>
      ) : null}

      {/* ── Servicios ── */}
      <Field label={t("barber.agenda.modal.services")}>
        {activeServices.length === 0 ? (
          <p className={css.hint}>{t("barber.agenda.modal.servicesEmpty")}</p>
        ) : (
          <div className={css.chips} ref={servicesRef}>
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
          <BarberoSelect
            ref={barberRef}
            barbers={activeBarbers}
            pick={pick}
            value={barberId}
            onChange={setBarberId}
            t={t}
            isToday={isToday}
          />
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
            ref={timeRef}
            step={900}
            className={css.input}
            value={hhmm}
            onChange={(e) => setHhmm(e.target.value)}
          />
        </Field>
        <Field
          label={t("barber.agenda.modal.duration")}
          hint={
            customMinutes === null
              ? t("barber.agenda.modal.durationAuto")
              : t("barber.agenda.modal.durationManual")
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <div className={css.stepper}>
              <button
                type="button"
                className={css.stepperBtn}
                onClick={() => setDuration(durationMin - BARBER_DURATION_STEP_MIN)}
                disabled={!durationEditable || durationMin <= BARBER_MIN_APPOINTMENT_MIN}
                aria-label={t("barber.agenda.detail.durationLess")}
              >
                <Minus size={14} />
              </button>
              <input
                className={css.stepperValue}
                inputMode="numeric"
                value={durDraft ?? durationMin}
                aria-label={t("barber.agenda.modal.duration")}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setDurDraft(digits);
                  const raw = parseInt(digits, 10);
                  if (Number.isFinite(raw)) setCustomMinutes(raw);
                }}
                onBlur={() => {
                  setDurDraft(null);
                  if (customMinutes !== null) setDuration(customMinutes);
                }}
              />
              <button
                type="button"
                className={css.stepperBtn}
                onClick={() => setDuration(durationMin + BARBER_DURATION_STEP_MIN)}
                disabled={!durationEditable || durationMin >= BARBER_MAX_APPOINTMENT_MIN}
                aria-label={t("barber.agenda.detail.durationMore")}
              >
                <Plus size={14} />
              </button>
              <span className={css.stepperUnit}>{t("barber.agenda.detail.minutes")}</span>
            </div>
            {customMinutes !== null && catalogMinutes > 0 ? (
              <button
                type="button"
                className={`${css.btn} ${css.btnSm}`}
                onClick={() => setCustomMinutes(null)}
                title={t("barber.agenda.modal.durationResetTitle", { min: catalogMinutes })}
              >
                <RotateCcw size={13} /> {t("barber.agenda.modal.durationReset")}
              </button>
            ) : null}
          </div>
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
