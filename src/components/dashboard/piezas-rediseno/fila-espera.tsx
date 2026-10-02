"use client";

import { useRef, type Dispatch, type ReactNode, type SetStateAction, type KeyboardEvent } from "react";
import { Clock, UserPlus } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { RaizRediseno } from "./raiz";
import { Boton, Cabecera, Campo, Etiqueta, Tarjeta, Vacio, clases as s, type Tono } from "./piezas";

/**
 * Fila de espera (walk-in), vestida con el lenguaje del menú de dos niveles.
 *
 * Se usa con prisa, de pie, en recepción: por eso el formulario «Agregar a
 * la fila» va EN LÍNEA arriba —los mismos dos campos que hoy están detrás
 * del botón— y Enter agrega. Hoy: botón → escribir → «Agregar» (2 clics);
 * aquí: escribir → Enter (0 clics) o escribir → «Agregar» (1 clic). El
 * botón de cabecera de siempre se queda y lleva el cursor al nombre.
 *
 * La lógica (estado, fetch, el refresco cada 30 s, el temporizador de
 * espera) sigue en `app/dashboard/walk-in/walk-in-client.tsx`; esto solo
 * pinta lo que recibe. El temporizador llega como `pintarEspera` para no
 * duplicar su intervalo.
 */

interface Turno {
  id: string;
  patientName: string;
  service: string;
  priority: number;
  status: string;
  assignedTo: string | null;
  joinedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const TONO_ESTADO: Record<string, Tono> = {
  WAITING: "ambar",
  ASSIGNED: "info",
  IN_PROGRESS: "violeta",
  COMPLETED: "exito",
  CANCELLED: "neutra",
};

export interface FilaEsperaProps {
  activeQueue: Turno[];
  doneQueue: Turno[];
  /** Cancelados de hoy: aparte de «Atendidos hoy». */
  cancelledQueue?: Turno[];
  /** Turnos que de verdad esperan (en atención no cuenta): el subtítulo. */
  waitingCount?: number;
  /** Zona de la clínica para «Llegó». */
  timezone?: string;
  form: { patientName: string; service: string };
  setForm: Dispatch<SetStateAction<{ patientName: string; service: string }>>;
  handleAdd: () => Promise<void>;
  handleAction: (id: string, action: string, assignedTo?: string) => Promise<void>;
  /** Quién puede recibir citas: la lista del selector de «Asignar». */
  profesionales?: { id: string; name: string }[];
  /** Fila a la que se le está eligiendo profesional. */
  asignandoId?: string | null;
  cancelarAsignar?: () => void;
  nombreDe?: (id: string | null) => string | null;
  statusLabel: (status: string) => string;
  pintarEspera: (since: string) => ReactNode;
  /** agenda.create / agenda.edit (la API los exige igual; aquí solo se esconde). */
  puedeAgregar?: boolean;
  puedeEditar?: boolean;
}

/** Hora de llegada en la zona de la clínica (no la del navegador); zona inválida → la del navegador. */
export function horaLlegada(iso: string, timeZone?: string) {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  try {
    return new Date(iso).toLocaleTimeString("es-MX", { ...opts, ...(timeZone ? { timeZone } : {}) });
  } catch {
    return new Date(iso).toLocaleTimeString("es-MX", opts);
  }
}

export function FilaEspera({
  activeQueue,
  doneQueue,
  cancelledQueue = [],
  waitingCount,
  timezone,
  form,
  setForm,
  handleAdd,
  handleAction,
  profesionales = [],
  asignandoId = null,
  cancelarAsignar,
  nombreDe,
  statusLabel,
  pintarEspera,
  puedeAgregar = true,
  puedeEditar = true,
}: FilaEsperaProps) {
  const t = useT();
  const nombreRef = useRef<HTMLInputElement>(null);

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAdd();
    }
  }

  return (
    <RaizRediseno>
      <Cabecera
        titulo={t("pages.walkIn.title")}
        subtitulo={t("pages.walkIn.waitingCount", { count: waitingCount ?? activeQueue.length })}
        acciones={
          puedeAgregar ? (
            <Boton variante="principal" icono={<UserPlus size={16} strokeWidth={2} />} onClick={() => nombreRef.current?.focus()}>
              {t("pages.walkIn.addPatient")}
            </Boton>
          ) : undefined
        }
      />

      <div className={s.apilado}>
        {puedeAgregar && <Tarjeta icono={<UserPlus size={15} strokeWidth={1.75} />} titulo={t("pages.walkIn.addToQueue")}>
          <div className={s.campoFila}>
            <Campo etiqueta={t("pages.walkIn.patientNameLabel")} htmlFor="wi-nombre">
              <input
                id="wi-nombre"
                ref={nombreRef}
                className={s.campoEntrada}
                placeholder={t("pages.walkIn.fullNamePlaceholder")}
                value={form.patientName}
                onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))}
                onKeyDown={alTeclear}
                autoComplete="off"
              />
            </Campo>
            <Campo etiqueta={t("pages.walkIn.serviceLabel")} htmlFor="wi-servicio">
              <input
                id="wi-servicio"
                className={s.campoEntrada}
                placeholder={t("pages.walkIn.servicePlaceholder")}
                value={form.service}
                onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
                onKeyDown={alTeclear}
                autoComplete="off"
              />
            </Campo>
            <Boton variante="principal" onClick={handleAdd} icono={<UserPlus size={16} strokeWidth={2} />}>
              {t("common.add")}
            </Boton>
          </div>
        </Tarjeta>}

        {activeQueue.length > 0 ? (
          <div className={s.lista}>
            {activeQueue.map((item, i) => (
              <div key={item.id} className={`${s.fila} ${s.filaSuelta}`}>
                <span className={s.numero}>{i + 1}</span>
                <div className={s.filaCuerpo}>
                  <div className={s.filaArriba}>
                    <p className={`${s.nombre} ${s.nombreGrande}`}>{item.patientName}</p>
                    <Etiqueta tono={TONO_ESTADO[item.status] ?? "neutra"}>{statusLabel(item.status)}</Etiqueta>
                  </div>
                  <div className={s.detalle}>
                    <span>{item.service}</span>
                    <span aria-hidden>·</span>
                    <Clock size={12} strokeWidth={1.75} aria-hidden />
                    <span>
                      {t("pages.walkIn.arrived")} {horaLlegada(item.joinedAt, timezone)}
                    </span>
                    {item.status !== "IN_PROGRESS" && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{t("pages.walkIn.waitingLabel")}</span>
                        <span className={s.espera}>{pintarEspera(item.joinedAt)}</span>
                      </>
                    )}
                    {nombreDe?.(item.assignedTo) && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{t("pages.walkIn.assignedTo", { name: nombreDe(item.assignedTo) ?? "" })}</span>
                      </>
                    )}
                  </div>
                </div>
                {puedeEditar && <div className={s.filaAcciones}>
                  {asignandoId === item.id && (
                    <>
                      <select
                        autoFocus
                        aria-label={t("pages.walkIn.chooseProfessional")}
                        className={s.campoEntrada}
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) void handleAction(item.id, "assign", e.target.value); }}
                      >
                        <option value="" disabled>{t("pages.walkIn.chooseProfessional")}</option>
                        {profesionales.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <Boton peq onClick={() => cancelarAsignar?.()}>{t("common.cancel")}</Boton>
                    </>
                  )}
                  {asignandoId !== item.id && (item.status === "WAITING" || item.status === "ASSIGNED") && (
                    <Boton peq onClick={() => handleAction(item.id, "assign")}>
                      {t("pages.walkIn.assign")}
                    </Boton>
                  )}
                  {(item.status === "WAITING" || item.status === "ASSIGNED") && (
                    <Boton peq variante="principal" onClick={() => handleAction(item.id, "start")}>
                      {t("pages.walkIn.start")}
                    </Boton>
                  )}
                  {item.status === "IN_PROGRESS" && (
                    <Boton peq variante="exito" onClick={() => handleAction(item.id, "complete")}>
                      {t("pages.walkIn.complete")}
                    </Boton>
                  )}
                  {item.status !== "COMPLETED" && item.status !== "CANCELLED" && (
                    <Boton peq variante="peligro" onClick={() => handleAction(item.id, "cancel")}>
                      {t("common.cancel")}
                    </Boton>
                  )}
                </div>}
              </div>
            ))}
          </div>
        ) : (
          <Vacio alto icono={<UserPlus size={18} strokeWidth={1.75} />} titulo={t("pages.walkIn.emptyActive")} />
        )}

        {doneQueue.length > 0 && (
          <Tarjeta lista titulo={t("pages.walkIn.attendedToday")} accion={<span className={s.contador}>{doneQueue.length}</span>}>
            {doneQueue.map((item) => (
              <div key={item.id} className={`${s.fila} ${s.filaApagada}`}>
                <div className={s.filaCuerpo}>
                  <p className={s.nombre}>{item.patientName}</p>
                  <div className={s.detalle}>{item.service}</div>
                </div>
                <Etiqueta tono={TONO_ESTADO[item.status] ?? "neutra"}>{statusLabel(item.status)}</Etiqueta>
              </div>
            ))}
          </Tarjeta>
        )}

        {cancelledQueue.length > 0 && (
          <Tarjeta lista titulo={t("pages.walkIn.cancelledToday")} accion={<span className={s.contador}>{cancelledQueue.length}</span>}>
            {cancelledQueue.map((item) => (
              <div key={item.id} className={`${s.fila} ${s.filaApagada}`}>
                <div className={s.filaCuerpo}>
                  <p className={s.nombre}>{item.patientName}</p>
                  <div className={s.detalle}>{item.service}</div>
                </div>
                <Etiqueta tono={TONO_ESTADO[item.status] ?? "neutra"}>{statusLabel(item.status)}</Etiqueta>
              </div>
            ))}
          </Tarjeta>
        )}
      </div>
    </RaizRediseno>
  );
}
