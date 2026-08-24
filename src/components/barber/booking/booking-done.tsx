"use client";

import { useMemo } from "react";
import { CalendarPlus, Check, MapPin, User } from "lucide-react";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type { PublicBarbershopDTO } from "@/lib/barber/booking";

/* ═══════════════════════════════════════════════════════════════════════
   Pantalla de confirmación.

   Se pinta con lo que devolvió el POST, NO leyendo la cita por su id: así
   no existe ninguna URL de confirmación que alguien pueda adivinar para
   asomarse a la cita de otra persona.

   Botón para agregar al calendario: liga de Google Calendar y archivo .ics
   (que es lo que entiende el iPhone), armados aquí mismo — sin llamar a
   ningún servicio de fuera.

   GANCHO T7: el WhatsApp de confirmación lo dispara el servidor al crear la
   cita (notifyBookingCreated). Esta pantalla solo lo anuncia.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BookingConfirmation {
  reference: string;
  status: "PENDING" | "CONFIRMED";
  startAt: string;
  endAt: string;
  barberName: string | null;
  services: { name: string; price: number }[];
  total: number;
  duplicate: boolean;
  clientName: string;
}

export function BookingDone({
  slug,
  shop,
  confirmation,
}: {
  slug: string;
  shop: PublicBarbershopDTO;
  confirmation: BookingConfirmation;
}) {
  const t = useMemo(() => getBarberT(shop.locale), [shop.locale]);
  const locale = shop.locale === "en" ? "en-US" : "es-MX";

  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
      }),
    [locale],
  );

  const start = new Date(confirmation.startAt);
  const end = new Date(confirmation.endAt);

  const when = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: shop.timezone,
  }).format(start);

  const firstName = confirmation.clientName.split(" ")[0];
  const confirmed = confirmation.status === "CONFIRMED";
  const title = confirmed
    ? t("barber.reserva.confirmacion.tituloConfirmada", { nombre: firstName })
    : t("barber.reserva.confirmacion.tituloPendiente", { nombre: firstName });

  const eventTitle = `${confirmation.services.map((s) => s.name).join(" + ")} · ${shop.name}`;
  const eventLocation = [shop.address, shop.city, shop.state].filter(Boolean).join(", ");

  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(eventTitle)}` +
    `&dates=${icsStamp(start)}/${icsStamp(end)}` +
    `&location=${encodeURIComponent(eventLocation)}` +
    `&details=${encodeURIComponent(
      confirmation.barberName
        ? t("barber.reserva.confirmacion.conBarbero", { barbero: confirmation.barberName })
        : shop.name,
    )}`;

  const icsHref = useMemo(
    () =>
      "data:text/calendar;charset=utf-8," +
      encodeURIComponent(
        buildIcs({
          uid: `${confirmation.reference}-${slug}`,
          title: eventTitle,
          start,
          end,
          location: eventLocation,
          description: confirmation.barberName ?? shop.name,
        }),
      ),
    // El .ics no cambia mientras no cambie la cita.
    [confirmation.reference, slug, eventTitle, eventLocation, confirmation.barberName, shop.name, start, end],
  );

  const mapsUrl = eventLocation
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${shop.name} ${eventLocation}`,
      )}`
    : null;

  return (
    <section className="dcb-done">
      <span className="dcb-done__badge" aria-hidden="true">
        <Check size={30} strokeWidth={3} />
      </span>
      <h1 className="dcb-title" style={{ marginTop: 0 }}>
        {title}
      </h1>
      <p className="dcb-sub">
        {confirmed
          ? t("barber.reserva.confirmacion.subConfirmada")
          : t("barber.reserva.confirmacion.subPendiente")}
      </p>

      {confirmation.duplicate ? (
        <p className="dcb-alert dcb-alert--info">{t("barber.reserva.confirmacion.duplicada")}</p>
      ) : null}

      <div className="dcb-card" style={{ textAlign: "left" }}>
        <p className="dcb-done__when">{when}</p>
        <p className="dcb-option__meta" style={{ marginTop: 6 }}>
          <User size={13} style={{ verticalAlign: "-2px" }} />{" "}
          {confirmation.barberName
            ? t("barber.reserva.confirmacion.conBarbero", { barbero: confirmation.barberName })
            : t("barber.reserva.confirmacion.cualquierBarbero")}
        </p>

        <ul className="dcb-summary" style={{ marginTop: 14 }}>
          {confirmation.services.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              <span>{s.name}</span>
              <b>{money.format(s.price)}</b>
            </li>
          ))}
          <li className="dcb-summary__total">
            <span>{t("barber.reserva.servicio.totalLabel")}</span>
            <b>{money.format(confirmation.total)}</b>
          </li>
        </ul>

        <span className="dcb-ref">
          {t("barber.reserva.confirmacion.referencia")} {confirmation.reference}
        </span>
      </div>

      {shop.address ? (
        <div className="dcb-card" style={{ textAlign: "left", marginTop: 12 }}>
          <p className="dcb-section" style={{ margin: "0 0 6px" }}>
            {t("barber.reserva.confirmacion.donde")}
          </p>
          <p className="dcb-option__meta" style={{ margin: 0, fontSize: 14, color: "var(--text-2)" }}>
            <MapPin size={13} style={{ verticalAlign: "-2px" }} /> {eventLocation}
          </p>
          {mapsUrl ? (
            <a
              className="dcb-link"
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-block", marginTop: 6 }}
            >
              {t("barber.reserva.confirmacion.comoLlegar")}
            </a>
          ) : null}
        </div>
      ) : null}

      <p className="dcb-section" style={{ textAlign: "left" }}>
        {t("barber.reserva.confirmacion.agregarCalendario")}
      </p>
      <div className="dcb-actions" style={{ marginTop: 0 }}>
        <a
          className="dcb-btn dcb-btn--primary"
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <CalendarPlus size={16} /> {t("barber.reserva.confirmacion.google")}
        </a>
        <a className="dcb-btn dcb-btn--ghost" href={icsHref} download={`cita-${confirmation.reference}.ics`}>
          <CalendarPlus size={16} /> .ics
        </a>
      </div>

      <div className="dcb-actions">
        {/* Superficie pública → superficie pública, con <a> duro: nada de
            navegación suave hacia una página que decide sesión en el server. */}
        <a className="dcb-btn dcb-btn--ghost" href={`/b/${slug}/mi-cuenta`}>
          {t("barber.reserva.confirmacion.verMisCitas")}
        </a>
        <a className="dcb-btn dcb-btn--ghost" href={`/b/${slug}/reservar`}>
          {t("barber.reserva.confirmacion.otraCita")}
        </a>
      </div>
    </section>
  );
}

/** Date → "20260824T160000Z" (formato básico UTC que piden Google e iCal). */
function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escapa según RFC 5545: la coma, el punto y coma y el salto de línea. */
function icsEscape(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

function buildIcs(args: {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  location: string;
  description: string;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DaleControl Barber//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${args.uid}@dalecontrol`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(args.start)}`,
    `DTEND:${icsStamp(args.end)}`,
    `SUMMARY:${icsEscape(args.title)}`,
    `LOCATION:${icsEscape(args.location)}`,
    `DESCRIPTION:${icsEscape(args.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
