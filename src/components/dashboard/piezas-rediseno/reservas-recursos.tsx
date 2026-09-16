"use client";

import type { Dispatch, SetStateAction } from "react";
import { Plus, X, CalendarDays, Armchair } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { RaizRediseno } from "./raiz";
import { Boton, BotonIcono, Cabecera, Campo, Dialogo, Tarjeta, Vacio, clases as s } from "./piezas";

/**
 * Reserva de recursos, vestida con el lenguaje del menú de dos niveles.
 * Misma idea que los sillones de Recursos: cada recurso es una tarjeta y
 * dentro van sus reservas del día. Todo lo que hoy se ve sin clic sigue a
 * la vista; la papelera de cada reserva, que hoy solo aparece al pasar el
 * ratón, aquí se ve siempre (en iPad no hay ratón).
 *
 * La lógica (estado, fetch, confirmación de borrado) sigue en
 * `app/dashboard/resource-bookings/resource-bookings-client.tsx`; esto solo
 * pinta lo que recibe.
 */

interface Reserva {
  id: string;
  resourceType: string;
  resourceName: string;
  startTime: string;
  endTime: string;
}

interface Formulario {
  resourceType: string;
  resourceName: string;
  startTime: string;
  endTime: string;
}

export interface ReservasRecursosProps {
  bookings: Reserva[];
  grouped: [string, Reserva[]][];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  form: Formulario;
  setForm: Dispatch<SetStateAction<Formulario>>;
  handleAdd: () => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  formatTime: (dt: string) => string;
}

export function ReservasRecursos({
  bookings,
  grouped,
  showAdd,
  setShowAdd,
  form,
  setForm,
  handleAdd,
  handleDelete,
  formatTime,
}: ReservasRecursosProps) {
  const t = useT();

  return (
    <RaizRediseno>
      <Cabecera
        titulo={t("pages.resourceBookings.title")}
        subtitulo={t("pages.resourceBookings.subtitle", { count: bookings.length })}
        acciones={
          <Boton variante="principal" icono={<Plus size={16} strokeWidth={2} />} onClick={() => setShowAdd(true)}>
            {t("pages.resourceBookings.newBooking")}
          </Boton>
        }
      />

      {grouped.length > 0 ? (
        <div className={s.rejilla}>
          {grouped.map(([resourceKey, items]) => (
            <Tarjeta
              key={resourceKey}
              lista
              icono={<Armchair size={15} strokeWidth={1.75} />}
              titulo={resourceKey}
              accion={<span className={s.contador}>{items.length}</span>}
            >
              {items.map((booking) => (
                <div key={booking.id} className={s.fila}>
                  <span className={`${s.hora} ${s.horaAncha}`}>
                    {formatTime(booking.startTime)} — {formatTime(booking.endTime)}
                  </span>
                  <span className={s.filaCuerpo} />
                  <BotonIcono peligro onClick={() => handleDelete(booking.id)} aria-label={t("common.delete")}>
                    <X size={16} strokeWidth={1.75} />
                  </BotonIcono>
                </div>
              ))}
            </Tarjeta>
          ))}
        </div>
      ) : (
        <Vacio alto icono={<CalendarDays size={18} strokeWidth={1.75} />} titulo={t("pages.resourceBookings.emptyToday")} />
      )}

      {showAdd && (
        <Dialogo
          titulo={t("pages.resourceBookings.newBooking")}
          onCerrar={() => setShowAdd(false)}
          pie={
            <>
              <Boton onClick={() => setShowAdd(false)}>{t("common.cancel")}</Boton>
              <Boton variante="principal" onClick={handleAdd}>
                {t("pages.resourceBookings.createBooking")}
              </Boton>
            </>
          }
        >
          <div className={s.campos}>
            <Campo etiqueta={t("pages.resourceBookings.resourceTypeLabel")} htmlFor="rb-type">
              <input
                id="rb-type"
                className={s.campoEntrada}
                autoFocus
                placeholder={t("pages.resourceBookings.resourceTypePlaceholder")}
                value={form.resourceType}
                onChange={(e) => setForm((f) => ({ ...f, resourceType: e.target.value }))}
              />
            </Campo>
            <Campo etiqueta={t("pages.resourceBookings.resourceNameLabel")} htmlFor="rb-name">
              <input
                id="rb-name"
                className={s.campoEntrada}
                placeholder={t("pages.resourceBookings.resourceNamePlaceholder")}
                value={form.resourceName}
                onChange={(e) => setForm((f) => ({ ...f, resourceName: e.target.value }))}
              />
            </Campo>
            <div className={s.campoDoble}>
              <Campo etiqueta={t("pages.resourceBookings.startTimeLabel")} htmlFor="rb-start">
                <input
                  id="rb-start"
                  type="time"
                  className={s.campoEntrada}
                  value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </Campo>
              <Campo etiqueta={t("pages.resourceBookings.endTimeLabel")} htmlFor="rb-end">
                <input
                  id="rb-end"
                  type="time"
                  className={s.campoEntrada}
                  value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </Campo>
            </div>
          </div>
        </Dialogo>
      )}
    </RaizRediseno>
  );
}
