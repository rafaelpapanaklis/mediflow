"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarOff, Check, ChevronLeft, MapPin, MessageCircle, Phone, Scissors } from "lucide-react";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type {
  PublicBarberDTO,
  PublicBarbershopDTO,
  PublicContactDTO,
  PublicServiceDTO,
} from "@/lib/barber/booking";
import { sumMoneyBy } from "@/lib/barber/money";
import { BookingDone, type BookingConfirmation } from "./booking-done";

/* ═══════════════════════════════════════════════════════════════════════
   El embudo de reserva. MÓVIL PRIMERO: casi todo el tráfico llega desde
   Instagram en un celular.

   Servicio → barbero → día y hora → nombre y WhatsApp → listo.
   Sin registro, sin contraseña, sin descargar nada.

   Pasos que se saltan solos (cada pantalla de más es gente que se cae):
   · con UN solo barbero no se pregunta con quién;
   · con ?barbero=<id> (la liga que se comparte por WhatsApp o en la bio de
     Instagram) el barbero viene elegido de fábrica.

   Los horarios SIEMPRE se piden al servidor: el navegador nunca calcula
   disponibilidad. Y aunque los pinte, quien decide es la base al crear la
   cita (ver createPublicBooking).
   ═══════════════════════════════════════════════════════════════════════ */

type StepId = "servicio" | "barbero" | "fecha" | "datos";

interface SlotDTO {
  time: string;
  available: number;
}

export interface BookingFlowProps {
  slug: string;
  shop: PublicBarbershopDTO;
  services: PublicServiceDTO[];
  barbers: PublicBarberDTO[];
  /** WhatsApp y teléfono de la barbería, para cuando aquí no se puede apartar. */
  contact: PublicContactDTO;
  /** Barbero fijado por la liga directa (?barbero=). */
  pinnedBarberId: string | null;
}

const ANY = "any";

/**
 * "Todavía no hay horarios en línea" — honesto y con salida. NUNCA se pinta
 * como "no hay lugar": el cliente se va creyendo que la barbería está llena
 * y la barbería pierde la cita sin enterarse. Reproducido en producción con
 * una barbería recién publicada.
 */
function NoScheduleNotice(props: {
  title: string;
  body: string;
  waHref: string | null;
  telHref: string | null;
  waLabel: string;
  telLabel: string;
  noContact: string;
  /** Acciones propias del embudo (van antes que las de contacto). */
  children?: ReactNode;
}) {
  const hasContact = !!props.waHref || !!props.telHref;
  const contactIsPrimary = !props.children;
  return (
    <div className="dcb-notice" role="status">
      <span className="dcb-notice__icon" aria-hidden="true">
        <CalendarOff size={20} />
      </span>
      <p className="dcb-notice__title">{props.title}</p>
      <p className="dcb-notice__body">{props.body}</p>
      <div className="dcb-notice__actions">
        {props.children}
        {props.waHref ? (
          <a
            className={"dcb-btn dcb-btn--sm " + (contactIsPrimary ? "dcb-btn--primary" : "dcb-btn--ghost")}
            href={props.waHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={16} aria-hidden="true" /> {props.waLabel}
          </a>
        ) : null}
        {props.telHref ? (
          <a className="dcb-btn dcb-btn--ghost dcb-btn--sm" href={props.telHref}>
            <Phone size={16} aria-hidden="true" /> {props.telLabel}
          </a>
        ) : null}
      </div>
      {!hasContact ? <p className="dcb-notice__body">{props.noContact}</p> : null}
    </div>
  );
}

export function BookingFlow({ slug, shop, services, barbers, contact, pinnedBarberId }: BookingFlowProps) {
  const t = useMemo(() => getBarberT(shop.locale), [shop.locale]);

  // Con un solo barbero no hay nada que preguntar; con la liga directa,
  // tampoco.
  const singleBarberId = barbers.length === 1 ? barbers[0].id : null;
  const fixedBarberId = pinnedBarberId ?? singleBarberId;

  const steps = useMemo<StepId[]>(
    () => (fixedBarberId ? ["servicio", "fecha", "datos"] : ["servicio", "barbero", "fecha", "datos"]),
    [fixedBarberId],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];

  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [barberId, setBarberId] = useState<string>(fixedBarberId ?? ANY);
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const [openDays, setOpenDays] = useState<string[] | null>(null);
  const [slots, setSlots] = useState<SlotDTO[] | null>(null);
  const [loadingDays, setLoadingDays] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // campo trampa
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BookingConfirmation | null>(null);

  const topRef = useRef<HTMLDivElement | null>(null);
  const daysReq = useRef(0);
  const slotsReq = useRef(0);

  const chosen = useMemo(
    () => services.filter((s) => selectedServices.indexOf(s.id) >= 0),
    [services, selectedServices],
  );
  const totalPrice = sumMoneyBy(chosen, (s) => s.price);
  const totalMin = chosen.reduce((acc, s) => acc + s.durationMin, 0);

  // ── Sin horarios cargados: decir la verdad, no "está llena" ────────────
  // Los días vacíos tienen dos causas que se leen distinto: de verdad no
  // hay hueco en el rango (raro) o nadie ha cargado horario todavía (una
  // barbería recién publicada). El servidor ya dice quién tiene horario.
  const anyBarberScheduled = barbers.some((b) => b.hasSchedule);
  const chosenBarber = barberId === ANY ? null : barbers.find((b) => b.id === barberId) ?? null;
  const chosenBarberNoSchedule = chosenBarber !== null && !chosenBarber.hasSchedule;
  const waHref = contact.whatsapp
    ? `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(
        t("barber.reserva.fecha.whatsappTexto", { shop: shop.name }),
      )}`
    : null;
  const telHref = contact.phone ? `tel:${contact.phone.replace(/[^\d+]/g, "")}` : null;
  const contactLabels = {
    waLabel: t("barber.reserva.fecha.escribirWhatsapp"),
    telLabel: t("barber.reserva.fecha.llamar"),
    noContact: t("barber.reserva.fecha.sinContacto"),
  };

  const money = useMemo(
    () =>
      new Intl.NumberFormat(shop.locale === "en" ? "en-US" : "es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
      }),
    [shop.locale],
  );

  // ── Carga de días con lugar ────────────────────────────────────────────
  const loadDays = useCallback(async () => {
    if (selectedServices.length === 0) return;
    const req = ++daysReq.current;
    setLoadingDays(true);
    try {
      const qs = new URLSearchParams({
        modo: "dias",
        servicios: selectedServices.join(","),
        barbero: barberId,
        dias: "28",
      });
      const res = await fetch(`/api/barber/public/booking/${slug}/slots?${qs}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (req !== daysReq.current) return; // llegó una respuesta vieja
      setOpenDays(res.ok && Array.isArray(data?.days) ? data.days : []);
    } catch {
      if (req === daysReq.current) setOpenDays([]);
    } finally {
      if (req === daysReq.current) setLoadingDays(false);
    }
  }, [slug, selectedServices, barberId]);

  const loadSlots = useCallback(
    async (day: string) => {
      const req = ++slotsReq.current;
      setLoadingSlots(true);
      setSlots(null);
      try {
        const qs = new URLSearchParams({
          modo: "horas",
          fecha: day,
          servicios: selectedServices.join(","),
          barbero: barberId,
        });
        const res = await fetch(`/api/barber/public/booking/${slug}/slots?${qs}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (req !== slotsReq.current) return;
        setSlots(res.ok && Array.isArray(data?.slots) ? data.slots : []);
      } catch {
        if (req === slotsReq.current) setSlots([]);
      } finally {
        if (req === slotsReq.current) setLoadingSlots(false);
      }
    },
    [slug, selectedServices, barberId],
  );

  // Al llegar al paso de fecha se piden los días. Si cambia el servicio o el
  // barbero, la selección anterior deja de valer.
  useEffect(() => {
    if (step !== "fecha") return;
    setDateISO(null);
    setTime(null);
    setSlots(null);
    void loadDays();
  }, [step, loadDays]);

  useEffect(() => {
    if (topRef.current) topRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [stepIndex, done]);

  // ── Navegación ────────────────────────────────────────────────────────
  const canAdvance = (() => {
    if (step === "servicio") return selectedServices.length > 0;
    if (step === "barbero") return true;
    if (step === "fecha") return !!dateISO && !!time;
    return false;
  })();

  const goNext = () => {
    setError(null);
    if (!canAdvance) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const goBack = () => {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const toggleService = (id: string) => {
    setSelectedServices((prev) =>
      prev.indexOf(id) >= 0 ? prev.filter((x) => x !== id) : prev.concat(id),
    );
  };

  // ── Envío ─────────────────────────────────────────────────────────────
  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) return setError(t("barber.reserva.errores.nombreCorto"));
    if (phone.replace(/\D/g, "").length < 10) {
      return setError(t("barber.reserva.errores.telefonoInvalido"));
    }
    if (!dateISO || !time) return setError(t("barber.reserva.errores.sinHora"));

    setSending(true);
    try {
      const res = await fetch(`/api/barber/public/booking/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: selectedServices,
          barberId,
          date: dateISO,
          time,
          name: name.trim(),
          phone,
          notes: notes.trim() || null,
          website,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? t("barber.reserva.errores.generico"));
        // El horario se lo llevó alguien más: de vuelta a elegir hora, con
        // la lista ya refrescada.
        if (data?.code === "slotTaken" || data?.code === "badBarber") {
          setTime(null);
          setStepIndex(steps.indexOf("fecha"));
          if (dateISO) void loadSlots(dateISO);
        }
        return;
      }
      setDone({
        reference: data.reference,
        status: data.status,
        startAt: data.startAt,
        endAt: data.endAt,
        barberName: data.barberName ?? null,
        services: data.services ?? [],
        total: data.total ?? totalPrice,
        duplicate: !!data.duplicate,
        clientName: name.trim(),
      });
    } catch {
      setError(t("barber.reserva.errores.sinRed"));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div ref={topRef}>
        <BookingDone slug={slug} shop={shop} confirmation={done} />
      </div>
    );
  }

  const stepLabel: Record<StepId, string> = {
    servicio: t("barber.reserva.pasos.servicio"),
    barbero: t("barber.reserva.pasos.barbero"),
    fecha: t("barber.reserva.pasos.fecha"),
    datos: t("barber.reserva.pasos.datos"),
  };

  return (
    <div ref={topRef}>
      <ol className="dcb-steps" aria-hidden="true">
        {steps.map((s, i) => (
          <li
            key={s}
            className={
              "dcb-steps__item" +
              (i < stepIndex ? " dcb-steps__item--done" : i === stepIndex ? " dcb-steps__item--now" : "")
            }
          />
        ))}
      </ol>
      <p className="dcb-steps__label">
        {t("barber.reserva.pasos.de", { n: stepIndex + 1, total: steps.length })} ·{" "}
        {stepLabel[step]}
      </p>

      {error ? (
        <p className="dcb-alert dcb-alert--error" role="alert" style={{ marginTop: 14 }}>
          {error}
        </p>
      ) : null}

      {/* ── Paso 1: servicio ─────────────────────────────────────────── */}
      {step === "servicio" ? (
        <section>
          <h1 className="dcb-title">{t("barber.reserva.servicio.title")}</h1>
          <p className="dcb-sub">{t("barber.reserva.servicio.sub")}</p>
          {services.length === 0 ? (
            <p className="dcb-empty">{t("barber.reserva.servicio.vacio")}</p>
          ) : (
            <div className="dcb-options dcb-options--two">
              {services.map((s) => {
                const on = selectedServices.indexOf(s.id) >= 0;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="dcb-option"
                    aria-pressed={on}
                    onClick={() => toggleService(s.id)}
                  >
                    <span className="dcb-option__check" aria-hidden="true">
                      <Check size={14} strokeWidth={3} />
                    </span>
                    <span className="dcb-option__body">
                      <span className="dcb-option__name">{s.name}</span>
                      <span className="dcb-option__meta">
                        {t("barber.reserva.servicio.minutos", { min: s.durationMin })}
                        {s.description ? ` · ${s.description}` : ""}
                      </span>
                    </span>
                    <span className="dcb-option__price">{money.format(s.price)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* ── Paso 2: barbero ──────────────────────────────────────────── */}
      {step === "barbero" ? (
        <section>
          <h1 className="dcb-title">{t("barber.reserva.barbero.title")}</h1>
          <p className="dcb-sub">{t("barber.reserva.barbero.sub")}</p>
          {barbers.length === 0 ? (
            <p className="dcb-empty">{t("barber.reserva.barbero.vacio")}</p>
          ) : (
            <div className="dcb-options">
              <button
                type="button"
                className={"dcb-option" + (barberId === ANY ? " dcb-option--on" : "")}
                onClick={() => setBarberId(ANY)}
              >
                <span className="dcb-option__avatar dcb-option__avatar--fallback" aria-hidden="true">
                  <Scissors size={18} />
                </span>
                <span className="dcb-option__body">
                  <span className="dcb-option__name">{t("barber.reserva.barbero.cualquiera")}</span>
                  <span className="dcb-option__meta">
                    {t("barber.reserva.barbero.cualquieraSub")}
                  </span>
                </span>
                <span className="dcb-option__check" aria-hidden="true">
                  <Check size={14} strokeWidth={3} />
                </span>
              </button>

              {barbers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={"dcb-option" + (barberId === b.id ? " dcb-option--on" : "")}
                  onClick={() => setBarberId(b.id)}
                >
                  {b.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="dcb-option__avatar" src={b.photoUrl} alt="" />
                  ) : (
                    <span className="dcb-option__avatar dcb-option__avatar--fallback" aria-hidden="true">
                      {b.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="dcb-option__body">
                    <span className="dcb-option__name">{b.nickname || b.name}</span>
                    {b.bio ? <span className="dcb-option__meta">{b.bio}</span> : null}
                  </span>
                  <span className="dcb-option__check" aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ── Paso 3: día y hora ───────────────────────────────────────── */}
      {step === "fecha" ? (
        <section>
          <h1 className="dcb-title">{t("barber.reserva.fecha.title")}</h1>
          <p className="dcb-sub">{t("barber.reserva.fecha.sub")}</p>

          {loadingDays ? (
            <p className="dcb-empty">
              <span className="dcb-spin" aria-hidden="true" /> {t("barber.reserva.fecha.cargando")}
            </p>
          ) : openDays && openDays.length === 0 ? (
            !anyBarberScheduled ? (
              <NoScheduleNotice
                title={t("barber.reserva.fecha.sinHorario")}
                body={t("barber.reserva.fecha.sinHorarioBody")}
                waHref={waHref}
                telHref={telHref}
                {...contactLabels}
              />
            ) : chosenBarberNoSchedule ? (
              <NoScheduleNotice
                title={t("barber.reserva.fecha.sinHorarioBarbero", {
                  barbero: chosenBarber.nickname || chosenBarber.name,
                })}
                body={t("barber.reserva.fecha.sinHorarioBarberoBody")}
                waHref={waHref}
                telHref={telHref}
                {...contactLabels}
              >
                <button
                  type="button"
                  className="dcb-btn dcb-btn--primary dcb-btn--sm"
                  onClick={() => setBarberId(ANY)}
                >
                  {t("barber.reserva.fecha.conCualquiera")}
                </button>
                {steps.indexOf("barbero") >= 0 ? (
                  <button
                    type="button"
                    className="dcb-btn dcb-btn--ghost dcb-btn--sm"
                    onClick={() => setStepIndex(steps.indexOf("barbero"))}
                  >
                    {t("barber.reserva.fecha.otroBarbero")}
                  </button>
                ) : null}
              </NoScheduleNotice>
            ) : (
              <p className="dcb-empty">{t("barber.reserva.fecha.sinDias")}</p>
            )
          ) : (
            <div className="dcb-days" role="group" aria-label={t("barber.reserva.fecha.title")}>
              {(openDays ?? []).map((day) => (
                <button
                  key={day}
                  type="button"
                  className={"dcb-day" + (dateISO === day ? " dcb-day--on" : "")}
                  onClick={() => {
                    setDateISO(day);
                    setTime(null);
                    void loadSlots(day);
                  }}
                >
                  <span className="dcb-day__dow">{dayLabel(day, shop.locale, shop.timezone, t)}</span>
                  <span className="dcb-day__num">{Number(day.slice(8, 10))}</span>
                  <span className="dcb-day__mon">{monthLabel(day, shop.locale)}</span>
                </button>
              ))}
            </div>
          )}

          {dateISO ? (
            <>
              <p className="dcb-section">{t("barber.reserva.fecha.horaTitle")}</p>
              {loadingSlots ? (
                <p className="dcb-empty">
                  <span className="dcb-spin" aria-hidden="true" />{" "}
                  {t("barber.reserva.fecha.cargando")}
                </p>
              ) : slots && slots.length === 0 ? (
                <p className="dcb-empty">{t("barber.reserva.fecha.sinHoras")}</p>
              ) : (
                <div className="dcb-times">
                  {(slots ?? []).map((s) => (
                    <button
                      key={s.time}
                      type="button"
                      className={"dcb-time" + (time === s.time ? " dcb-time--on" : "")}
                      onClick={() => setTime(s.time)}
                    >
                      {s.time}
                      {s.available === 1 && barberId === ANY ? (
                        <span className="dcb-time__tag">{t("barber.reserva.fecha.ultimo")}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </section>
      ) : null}

      {/* ── Paso 4: datos ────────────────────────────────────────────── */}
      {step === "datos" ? (
        <section>
          <h1 className="dcb-title">{t("barber.reserva.datos.title")}</h1>
          <p className="dcb-sub">{t("barber.reserva.datos.sub")}</p>

          <div className="dcb-card" style={{ marginBottom: 18 }}>
            <p className="dcb-section" style={{ margin: "0 0 10px" }}>
              {t("barber.reserva.datos.resumen")}
            </p>
            <ul className="dcb-summary">
              {chosen.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  <b>{money.format(s.price)}</b>
                </li>
              ))}
              <li className="dcb-summary__total">
                <span>{whenLabel(dateISO, time, shop.locale)}</span>
                <b>{money.format(totalPrice)}</b>
              </li>
            </ul>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="dcb-field">
              <span className="dcb-label">{t("barber.reserva.datos.nombre")}</span>
              <input
                className="dcb-input"
                type="text"
                name="name"
                autoComplete="name"
                enterKeyHint="next"
                maxLength={80}
                placeholder={t("barber.reserva.datos.nombrePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>

            <label className="dcb-field">
              <span className="dcb-label">{t("barber.reserva.datos.telefono")}</span>
              <input
                className="dcb-input"
                type="tel"
                name="phone"
                inputMode="numeric"
                autoComplete="tel"
                enterKeyHint="done"
                maxLength={20}
                placeholder={t("barber.reserva.datos.telefonoPlaceholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <span className="dcb-help">{t("barber.reserva.datos.telefonoAyuda")}</span>
            </label>

            <label className="dcb-field">
              <span className="dcb-label">{t("barber.reserva.datos.notas")}</span>
              <textarea
                className="dcb-textarea"
                name="notes"
                maxLength={500}
                placeholder={t("barber.reserva.datos.notasPlaceholder")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            {/* Campo trampa: invisible para una persona, irresistible para un bot. */}
            <div className="dcb-honey" aria-hidden="true">
              <label>
                Sitio web
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>

            <button type="submit" className="dcb-btn dcb-btn--primary" disabled={sending}>
              {sending ? (
                <>
                  <span className="dcb-spin" aria-hidden="true" />
                  {t("barber.reserva.datos.enviando")}
                </>
              ) : (
                t("barber.reserva.datos.enviar")
              )}
            </button>
            <p className="dcb-help" style={{ textAlign: "center", marginTop: 10 }}>
              {t("barber.reserva.datos.aviso")}
            </p>
          </form>
        </section>
      ) : null}

      {/* ── Barra de acción ──────────────────────────────────────────── */}
      {step !== "datos" ? (
        <div className="dcb-bar">
          <div className="dcb-bar__row">
            {stepIndex > 0 ? (
              <button
                type="button"
                className="dcb-btn dcb-btn--ghost dcb-btn--sm"
                onClick={goBack}
                aria-label={t("barber.reserva.pasos.de", { n: stepIndex, total: steps.length })}
              >
                <ChevronLeft size={16} />
              </button>
            ) : null}
            <div className="dcb-bar__total">
              <b>{chosen.length > 0 ? money.format(totalPrice) : "—"}</b>
              <span>
                {chosen.length > 0
                  ? t("barber.reserva.servicio.minutos", { min: totalMin })
                  : t("barber.reserva.errores.sinServicio")}
              </span>
            </div>
            <button
              type="button"
              className="dcb-btn dcb-btn--primary"
              onClick={goNext}
              disabled={!canAdvance}
            >
              {t("barber.reserva.pasos.continuar")}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="dcb-link" onClick={goBack}>
            <ChevronLeft size={14} style={{ verticalAlign: "-2px" }} /> {stepLabel.fecha}
          </button>
        </div>
      )}

      {shop.address ? (
        <p className="dcb-foot">
          <MapPin size={12} style={{ verticalAlign: "-2px" }} /> {shop.address}
        </p>
      ) : null}
    </div>
  );
}

/* ── Formato de fechas ─────────────────────────────────────────────────
   Una fecha "YYYY-MM-DD" es un día del calendario, no un instante: se
   formatea anclándola al mediodía UTC y leyéndola en UTC. Así no se corre
   un día según dónde esté el celular de quien reserva. */

function dateAtNoonUtc(dateISO: string): Date {
  return new Date(`${dateISO}T12:00:00Z`);
}

function dayLabel(
  dateISO: string,
  locale: string,
  timezone: string,
  t: (k: string) => string,
): string {
  // "Hoy" es hoy EN LA BARBERÍA, no donde esté el celular de quien reserva.
  // en-CA da directo el formato YYYY-MM-DD.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  if (dateISO === hoy) return t("barber.reserva.fecha.hoy");
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(dateAtNoonUtc(dateISO))
    .replace(".", "");
}

function monthLabel(dateISO: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    month: "short",
    timeZone: "UTC",
  })
    .format(dateAtNoonUtc(dateISO))
    .replace(".", "");
}

function whenLabel(dateISO: string | null, time: string | null, locale: string): string {
  if (!dateISO || !time) return "";
  const day = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(dateAtNoonUtc(dateISO));
  return `${day} · ${time}`;
}
