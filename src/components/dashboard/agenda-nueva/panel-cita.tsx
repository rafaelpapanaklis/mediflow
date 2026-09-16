"use client";

/**
 * El panel lateral de la cita (420 px). Se abre al pulsar una tarjeta y la
 * agenda se angosta; sin ventanas modales, como pide el diseño.
 *
 * ⛔ Este panel NO inventa reglas. Cada acción llama a lo que ya existe:
 *   · cambiar de estado → `patchAppointmentStatus` (PATCH /api/appointments/:id/status)
 *   · qué estados caben → `possibleTransitions` (la máquina de estados real)
 *   · cancelar          → el mismo PATCH con motivo, tras `confirmWithReason`
 *   · reagendar         → `useNewAppointmentDialog()`, igual que el panel de siempre
 *   · WhatsApp          → POST /api/whatsapp/send
 *   · cobrar            → GET /api/invoices/by-appointment/:id + `InvoiceDetailModal`
 * El servidor revalida permisos y transiciones en todos los casos; los
 * booleanos de `permissions` solo esconden lo que la API va a rechazar.
 */

import { startTransition, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  Check,
  CreditCard,
  DoorOpen,
  ExternalLink,
  FileText,
  MessageCircle,
  Receipt,
  RotateCcw,
  SkipForward,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useConfirmWithReason } from "@/components/ui/confirm-dialog";
import { InvoiceDetailModal } from "@/components/dashboard/billing/invoice-detail-modal";
import { patchAppointmentStatus } from "@/lib/agenda/mutations";
import { possibleTransitions } from "@/lib/agenda/transitions";
import { formatTimeInTz } from "@/lib/agenda/date-ranges";
import type { Role } from "@prisma/client";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import { aCitaVista, type CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { citaContada, estadoNormalizado } from "@/lib/agenda-nueva/estados";
import { fechaCorta } from "@/lib/agenda-nueva/fechas";
import { diaEnTz } from "@/lib/agenda-nueva/geometria";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import { useMinuto } from "./usar-minuto";
import s from "./agenda-nueva.module.css";

/* ═══ Flujo de la cita ══════════════════════════════════════════════════
   El diseño enseña cinco pasos: Confirmada → Llegó → En consulta → Atendida
   → Cobrada. Los cuatro primeros son estados reales del sistema. El quinto
   no: «cobrada» vive en la factura, no en la cita, y saberlo costaría una
   consulta por cita. Se sustituye por «Salió» (CHECKED_OUT), que sí es un
   estado real y es el final del pipeline. Queda anotado en el reporte.
   ═══════════════════════════════════════════════════════════════════════ */

const PASOS = ["Confirmada", "Llegó", "En consulta", "Atendida", "Salió"] as const;

/**
 * Dónde cae cada estado en el recorrido de cinco pasos.
 *
 *  · `hechos` — cuántos pasos están COMPLETADOS (se pintan en verde).
 *  · `actual` — el paso que describe el estado de AHORA, resaltado en morado;
 *    `-1` si el estado no «está» en ningún paso, solo los ha dejado atrás.
 *
 * Son dos números y no uno porque no es lo mismo «ya llegó» que «está
 * esperando»: con un solo número, un paciente en la sala de espera resaltaba
 * el paso «En consulta» con el subtítulo «llegó 11:04 · espera 24 min» debajo,
 * que se contradice consigo mismo. Es el mismo reparto que hace el prototipo.
 */
const RECORRIDO: Record<AppointmentStatus, { hechos: number; actual: number }> = {
  SCHEDULED: { hechos: 0, actual: -1 },
  CONFIRMED: { hechos: 1, actual: -1 },
  // Llegó y está esperando: «Llegó» es el paso en el que está, no uno pasado.
  CHECKED_IN: { hechos: 1, actual: 1 },
  // Ya está dentro, pero la consulta no ha empezado.
  IN_CHAIR: { hechos: 2, actual: -1 },
  IN_PROGRESS: { hechos: 2, actual: 2 },
  COMPLETED: { hechos: 4, actual: -1 },
  CHECKED_OUT: { hechos: 5, actual: -1 },
  // Las dos terminales se salen del carril: el panel enseña un aviso, no pasos.
  CANCELLED: { hechos: -1, actual: -1 },
  NO_SHOW: { hechos: -1, actual: -1 },
};

interface AccionEstado {
  etiqueta: string;
  icono: LucideIcon;
  destino: AppointmentStatus;
}

/** Cómo se llama y con qué ícono se pinta cada destino posible. */
const ACCIONES: Partial<Record<AppointmentStatus, Omit<AccionEstado, "destino">>> = {
  // El diseño dice «Confirmar por WhatsApp». Aquí es solo «Confirmar»: en el
  // sistema, confirmar es que el paciente confirmó, y mandarle el mensaje es
  // otra acción (el botón de WhatsApp de arriba, que además marca el
  // recordatorio como enviado). Juntarlas mentiría en el expediente.
  CONFIRMED: { etiqueta: "Confirmar cita", icono: Check },
  CHECKED_IN: { etiqueta: "Marcar llegada", icono: DoorOpen },
  IN_CHAIR: { etiqueta: "Pasar al sillón", icono: ArrowRight },
  IN_PROGRESS: { etiqueta: "Pasar a consulta", icono: ArrowRight },
  COMPLETED: { etiqueta: "Terminar consulta", icono: Check },
  CHECKED_OUT: { etiqueta: "Marcar salida", icono: DoorOpen },
  SCHEDULED: { etiqueta: "Reabrir cita", icono: RotateCcw },
};

/**
 * Qué destinos son «el siguiente paso» desde cada estado, EN ORDEN DE
 * PREFERENCIA. Se coge el primero que la máquina de estados permita **a este
 * rol**; los demás que también permita salen como botón secundario.
 *
 * 🔴 Tiene que ser una LISTA y no un solo destino, porque el camino depende
 * del rol y elegir a ciegas dejaba a media clínica sin botón:
 *
 *  · Un DOCTOR con una cita agendada no puede confirmarla (confirmar es de
 *    recepción) pero sí empezar la consulta. Con un solo destino se le pintaba
 *    «Confirmar cita», el servidor devolvía 403, y no le quedaba NINGÚN camino
 *    para pasar su cita a «en consulta» desde la agenda.
 *  · RECEPCIÓN con un paciente en sala no puede pasarlo a consulta (es
 *    clínico) pero sí sentarlo en el sillón.
 *
 * La causa de fondo era preguntar a `possibleTransitions` sin `role`: ese
 * filtro es solo estructural y daba por buenas transiciones prohibidas para el
 * rol. Lo encontró el revisor.
 */
const SIGUIENTES: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"],
  CONFIRMED: ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"],
  CHECKED_IN: ["IN_PROGRESS", "IN_CHAIR"],
  IN_CHAIR: ["IN_PROGRESS", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["CHECKED_OUT"],
  // Reabrir es cosa de administradores; a los demás ni se les pinta el botón.
  CANCELLED: ["SCHEDULED"],
  NO_SHOW: ["SCHEDULED"],
};

export interface PanelCitaProps {
  /**
   * `Clinic.cfdiTaxMode` ("exempt" | "iva16"). 🔴 Obligatorio y sin valor por
   * defecto a propósito: con `null`, el cobro resuelve «exento» y una clínica
   * con IVA timbraría su CFDI sin desglose. Sería una diferencia FISCAL
   * causada solo por tener la bandera encendida. Lo encontró el revisor.
   */
  clinicTaxMode: string | null;
  /** El rol de quien mira; sin él no se sabe qué transiciones le tocan. */
  userRole?: Role;
}

export function PanelCita({ clinicTaxMode, userRole }: PanelCitaProps) {
  const { state, dispatch, permissions, invalidateRangeCache } = useAgenda();
  // El MISMO reloj por minuto que la cuadrícula: sin él, los minutos de espera
  // se congelaban al abrir el panel y «No asistió» no aparecía al cumplirse la
  // gracia de 15 min hasta cerrar y volver a abrir.
  const ahora = useMinuto();
  const ag = useAgendaNueva();
  const router = useRouter();
  const { open: abrirNuevaCita } = useNewAppointmentDialog();
  const confirmarConMotivo = useConfirmWithReason();

  const [enVuelo, setEnVuelo] = useState<AppointmentStatus | null>(null);
  const [enviandoWa, setEnviandoWa] = useState(false);
  const [factura, setFactura] = useState<Parameters<typeof InvoiceDetailModal>[0]["invoice"] | null>(
    null,
  );
  const [buscandoFactura, setBuscandoFactura] = useState(false);

  const dto = useMemo(
    () => state.appointments.find((a) => a.id === ag.citaAbiertaId) ?? null,
    [state.appointments, ag.citaAbiertaId],
  );

  const cita = useMemo<CitaVista | null>(
    () =>
      dto
        ? aCitaVista(dto, {
            timezone: state.timezone,
            doctores: state.doctors,
            unidades: state.resources,
            ahora,
          })
        : null,
    [dto, state.timezone, state.doctors, state.resources, ahora],
  );

  /** La siguiente cita del mismo responsable ese día — la tarjeta gris del pie. */
  const siguiente = useMemo(() => {
    if (!dto || !cita) return null;
    const finMs = dto.endsAt ? new Date(dto.endsAt).getTime() : new Date(dto.startsAt).getTime();
    const mismas = state.appointments
      .filter(
        (a) =>
          a.id !== dto.id &&
          a.doctor?.id === dto.doctor?.id &&
          diaEnTz(a.startsAt, state.timezone) === diaEnTz(dto.startsAt, state.timezone) &&
          citaContada(a.status) &&
          new Date(a.startsAt).getTime() >= finMs,
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const n = mismas[0];
    if (!n) return null;
    return `${n.patient.name} · ${formatTimeInTz(n.startsAt, state.timezone)}`;
  }, [dto, cita, state.appointments, state.timezone]);

  const transiciones = useMemo(
    () =>
      dto
        ? // 🔴 CON `role`: sin él este filtro es solo estructural y da por
          // buenas transiciones que el rol tiene prohibidas — el botón se
          // pintaba y el servidor devolvía 403.
          // El estado NORMALIZADO: una fila legacy en `PENDING` no está en la
          // máquina de estados y se quedaría sin ninguna transición posible.
          possibleTransitions(estadoNormalizado(dto.status), {
            role: userRole,
            now: ahora,
            appointmentStart: new Date(dto.startsAt),
          })
        : [],
    [dto, userRole, ahora],
  );

  const cambiarEstado = useCallback(
    async (destino: AppointmentStatus): Promise<boolean> => {
      if (!dto) return false;

      const esCancelar = destino === "CANCELLED";
      if (esCancelar ? !permissions.canCancel : !permissions.canEdit) {
        toast.error("No tienes permiso para esta acción.");
        return false;
      }

      let motivo: string | undefined;
      if (esCancelar) {
        const r = await confirmarConMotivo({
          title: "¿Cancelar esta cita?",
          description:
            "La cita queda cancelada y se anulan sus recordatorios pendientes. Puedes anotar el motivo para que quede en el expediente.",
          variant: "danger",
          withReason: true,
          reasonLabel: "Motivo de la cancelación (opcional)",
          reasonPlaceholder: "Ej.: el paciente pidió reagendar",
          confirmText: "Cancelar la cita",
        });
        if (!r.confirmed) return false;
        motivo = r.reason?.trim() || undefined;
      }

      const original: AgendaAppointmentDTO = dto;
      setEnVuelo(destino);
      dispatch({ type: "OPTIMISTIC_STATUS", id: dto.id, status: destino });

      try {
        const actualizada = motivo
          ? await patchConMotivo(dto.id, destino, motivo)
          : await patchAppointmentStatus(dto.id, destino);
        startTransition(() => {
          dispatch({ type: "REPLACE_APPOINTMENT", appointment: actualizada });
        });
        // El caché SWR de rangos guarda la respuesta anterior: sin invalidarlo,
        // volver al día tras un refresh repone la cita con el estado viejo.
        invalidateRangeCache();
        return true;
      } catch (err) {
        dispatch({ type: "ROLLBACK_STATUS", original });
        const e = err as { status?: number; reason?: string; error?: string; message?: string };
        const detalle = e?.reason ?? e?.error ?? e?.message ?? "No se pudo cambiar el estado.";
        toast.error(`${e?.status ? `[${e.status}] ` : ""}${detalle}`);
        return false;
      } finally {
        setEnVuelo(null);
      }
    },
    [dto, permissions, confirmarConMotivo, dispatch, invalidateRangeCache],
  );

  const enviarWhatsapp = useCallback(async () => {
    if (!dto) return;
    setEnviandoWa(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: dto.id }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cuerpo?.error ?? "No se pudo enviar el WhatsApp.");
      toast.success("Recordatorio enviado por WhatsApp.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el WhatsApp.");
    } finally {
      setEnviandoWa(false);
    }
  }, [dto]);

  const abrirCobro = useCallback(async () => {
    if (!dto) return;
    setBuscandoFactura(true);
    try {
      const res = await fetch(`/api/invoices/by-appointment/${dto.id}`);
      if (res.status === 404) {
        toast("Esta cita todavía no tiene factura.");
        return;
      }
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cuerpo?.error ?? "No se pudo abrir el cobro.");
      setFactura(cuerpo.invoice);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo abrir el cobro.");
    } finally {
      setBuscandoFactura(false);
    }
  }, [dto]);

  if (!cita || !dto) return null;

  const permitida = (e: AppointmentStatus) => transiciones.includes(e);

  // El siguiente paso: el primero de la lista de preferencia que ESTE rol
  // pueda dar. Los demás que también pueda, abajo como secundarios.
  const aAccion = (destino: AppointmentStatus): AccionEstado | null => {
    const a = ACCIONES[destino];
    return a ? { ...a, destino } : null;
  };
  const candidatos = (SIGUIENTES[cita.estado] ?? []).filter(permitida);
  const principal = candidatos[0] ? aAccion(candidatos[0]) : null;
  const otrosPasos = candidatos
    .slice(1)
    .map(aAccion)
    .filter((a): a is AccionEstado => a !== null);

  const esCobro = cita.estado === "COMPLETED" || cita.estado === "CHECKED_OUT";
  // `cita.estado` y no `dto.status`: ya viene normalizado, así que una fila
  // legacy en `PENDING` no deja esto en `undefined` (que tumbaba el render).
  const recorrido = RECORRIDO[cita.estado];
  const terminal = recorrido.hechos === -1;
  // El detalle del estado va debajo del paso resaltado; si no hay ninguno
  // resaltado, debajo del último completado, que es donde el ojo lo busca.
  const pasoConDetalle = recorrido.actual >= 0 ? recorrido.actual : recorrido.hechos - 1;

  const hrefExpediente = cita.pacienteId ? `/dashboard/patients/${cita.pacienteId}` : null;
  const esAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";

  return (
    <>
      <aside className={`${s.panel} ${s.panelCita}`} aria-label="Detalle de la cita">
        <div className={s.panelCabecera}>
          <span className={s.panelRotulo}>Cita</span>
          {hrefExpediente && (
            <Link
              className={s.panelIconoBoton}
              href={`${hrefExpediente}?appointment=${dto.id}`}
              aria-label="Abrir la cita completa"
              title="Abrir la cita completa"
            >
              <ExternalLink size={20} strokeWidth={2} />
            </Link>
          )}
          <button
            type="button"
            className={`${s.panelIconoBoton} ${s.panelCerrar}`}
            onClick={ag.cerrarPanel}
            aria-label="Cerrar el panel"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <div className={s.panelDesplaza}>
          {/* ── Paciente ── */}
          <div className={s.panelPaciente}>
            <span className={s.panelAvatar} style={{ background: cita.colorResponsable }}>
              {iniciales(cita.nombrePaciente)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {hrefExpediente ? (
                <Link className={s.panelNombre} href={hrefExpediente}>
                  {cita.nombrePaciente}
                </Link>
              ) : (
                <div className={s.panelNombre}>{cita.nombrePaciente}</div>
              )}
              <div className={s.panelSub}>{origenDeLaCita(dto.source)}</div>
            </div>
          </div>

          {/* ── Dos acciones rápidas ──
              El diseño pone tres (WhatsApp, Llamar, Expediente). «Llamar»
              necesita el teléfono del paciente, que NO viaja en el payload de
              la agenda; traerlo obligaría a cargar la ficha entera por cada
              clic o a mandar el teléfono de todos los pacientes del día al
              navegador. Se queda fuera y va anotado en el reporte. */}
          <div className={s.panelAcciones3}>
            {/* `POST /api/whatsapp/send` es admin-only. Sin este filtro, a
                recepción y a los doctores les salía el botón y el servidor les
                devolvía «Solo administradores»: un botón que nunca funciona es
                peor que no tenerlo. */}
            {esAdmin && (
              <button
                type="button"
                className={s.panelAccion3}
                onClick={enviarWhatsapp}
                disabled={enviandoWa}
              >
                <MessageCircle size={18} strokeWidth={2} color="var(--ag-verde)" />
                {enviandoWa ? "Enviando…" : "WhatsApp"}
              </button>
            )}
            <button
              type="button"
              className={s.panelAccion3}
              onClick={() => hrefExpediente && router.push(hrefExpediente)}
              disabled={!hrefExpediente}
              title={hrefExpediente ? undefined : "No puedes ver el expediente de este paciente"}
            >
              <FileText size={18} strokeWidth={2} />
              Expediente
            </button>
          </div>

          {/* ── Tarjeta de datos ── */}
          <div className={s.panelDatos}>
            <Dato rotulo="Horario" valor={`${fechaCorta(diaEnTz(dto.startsAt, state.timezone))} · ${cita.rango}`} />
            <Dato rotulo="Responsable" valor={cita.responsableNombre} />
            <Dato
              rotulo="Tratamiento"
              valor={`${cita.tratamiento || "Sin especificar"} · ${Math.round(cita.duracionMin)} min`}
            />
            <Dato rotulo="Unidad dental" valor={cita.unidadNombre ?? "Sin asignar"} />
            <Dato rotulo="Origen" valor={origenCorto(dto.source)} />
            <Dato rotulo="Estado" valor={cita.chip} color={cita.pinta.chipTinta} />
          </div>

          {/* ── Flujo de la cita ── */}
          <div className={s.panelSeccion}>
            <div className={s.rotuloSeccion}>Flujo de la cita</div>
            {terminal ? (
              <div className={s.nota} style={{ marginTop: 10 }}>
                <span className={s.notaIcono}>
                  {cita.estado === "CANCELLED" ? (
                    <Ban size={18} strokeWidth={2} />
                  ) : (
                    <UserX size={18} strokeWidth={2} />
                  )}
                </span>
                <span>{cita.detalle}</span>
              </div>
            ) : (
              <div className={s.flujo}>
                {PASOS.map((etiqueta, k) => {
                  const hecho = k < recorrido.hechos;
                  const actual = k === recorrido.actual;
                  return (
                    <div key={etiqueta} className={s.flujoPaso}>
                      <div className={s.flujoCarril}>
                        <span
                          className={`${s.flujoPunto} ${hecho ? s.flujoPuntoHecho : ""} ${
                            actual ? s.flujoPuntoActual : ""
                          }`}
                        >
                          {hecho && <Check size={14} strokeWidth={3} />}
                          {actual && <span className={s.flujoPuntoInterior} />}
                        </span>
                        {k < PASOS.length - 1 && (
                          <span className={`${s.flujoLinea} ${hecho ? s.flujoLineaHecha : ""}`} />
                        )}
                      </div>
                      <div className={s.flujoTextos}>
                        <div
                          className={`${s.flujoEtiqueta} ${hecho ? s.flujoEtiquetaHecha : ""} ${
                            actual ? s.flujoEtiquetaActual : ""
                          }`}
                        >
                          {etiqueta}
                        </div>
                        {k === pasoConDetalle && <div className={s.flujoSub}>{cita.detalle}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Avisos ──
              El diseño enseña aquí la nota clínica («Alergia a penicilina»).
              La agenda no la carga —vive en el expediente y traerla por cita
              sería una consulta más por tarjeta—, así que este bloque ámbar se
              reserva para lo que la agenda SÍ sabe y recepción necesita ver.  */}
          {dto.requiresValidation && cita.estado === "SCHEDULED" && (
            <div className={s.panelSeccion}>
              <div className={s.rotuloSeccion}>Atención</div>
              <div className={s.nota}>
                <span className={s.notaIcono}>
                  <AlertTriangle size={18} strokeWidth={2} />
                </span>
                <span>
                  Esta cita entró {origenCorto(dto.source).toLowerCase()} y está pendiente de que
                  recepción la valide.
                  {dto.overrideReason ? ` Motivo anotado: ${dto.overrideReason}` : ""}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Pie ── */}
        <div className={s.panelPie}>
          {esCobro ? (
            <button
              type="button"
              className={s.accionPrincipal}
              onClick={abrirCobro}
              disabled={buscandoFactura}
            >
              {cita.estado === "CHECKED_OUT" ? (
                <Receipt size={20} strokeWidth={2} />
              ) : (
                <CreditCard size={20} strokeWidth={2} />
              )}
              {buscandoFactura
                ? "Abriendo…"
                : cita.estado === "CHECKED_OUT"
                  ? "Ver recibo"
                  : "Cobrar"}
            </button>
          ) : principal ? (
            <button
              type="button"
              className={s.accionPrincipal}
              onClick={() => cambiarEstado(principal.destino)}
              disabled={enVuelo !== null}
            >
              <principal.icono size={20} strokeWidth={2} />
              {enVuelo === principal.destino ? "Guardando…" : principal.etiqueta}
            </button>
          ) : null}

          <div className={s.accionesSecundarias}>
            <button
              type="button"
              className={s.accionSecundaria}
              disabled={!permissions.canCreate}
              onClick={() =>
                abrirNuevaCita({
                  initialPatient: cita.pacienteId
                    ? { id: cita.pacienteId, name: cita.nombrePaciente }
                    : undefined,
                  initialDoctorId: dto.doctor?.id,
                  initialReason: dto.reason ?? undefined,
                  initialSlot: { doctorId: dto.doctor?.id, resourceId: dto.resourceId },
                  openAgendaAfter: false,
                })
              }
            >
              <CalendarClock size={18} strokeWidth={2} />
              Reagendar
            </button>

            {permitida("CANCELLED") && permissions.canCancel && (
              <button
                type="button"
                className={`${s.accionSecundaria} ${s.accionCancelar}`}
                onClick={() => cambiarEstado("CANCELLED")}
                disabled={enVuelo !== null}
              >
                <Ban size={18} strokeWidth={2} />
                Cancelar
              </button>
            )}

            {/* Los OTROS pasos que este rol también puede dar. Recepción, con
                un paciente en sala, tiene «Pasar al sillón» de principal y
                nada más; un doctor tiene «Pasar a consulta» y, además,
                «Pasar al sillón» aquí. Nadie se queda sin camino. */}
            {otrosPasos.map((a) => (
              <button
                key={a.destino}
                type="button"
                className={s.accionSecundaria}
                onClick={() => cambiarEstado(a.destino)}
                disabled={enVuelo !== null || !permissions.canEdit}
              >
                <a.icono size={18} strokeWidth={2} />
                {a.etiqueta}
              </button>
            ))}

            {/* Contextual: no asistió (antes de empezar) o marcar salida
                (después de terminar). El diseño solo tiene dos botones aquí,
                pero dejarlos fuera sería QUITAR funcionalidad de la agenda. */}
            {permitida("NO_SHOW") && permissions.canEdit && (
              <button
                type="button"
                className={s.accionSecundaria}
                onClick={() => cambiarEstado("NO_SHOW")}
                disabled={enVuelo !== null}
              >
                <UserX size={18} strokeWidth={2} />
                No asistió
              </button>
            )}
          </div>

          {siguiente && (
            <div className={s.siguienteEnUnidad}>
              <SkipForward size={18} strokeWidth={2} color="var(--ag-texto-2)" />
              <span className={s.siguienteTexto}>
                <b>Siguiente con {cita.responsableNombre}</b> · {siguiente}
              </span>
            </div>
          )}
        </div>
      </aside>

      {factura && (
        <InvoiceDetailModal
          open
          invoice={factura}
          patientName={cita.nombrePaciente}
          clinicTaxMode={clinicTaxMode}
          onClose={() => setFactura(null)}
          onMutated={() => {
            invalidateRangeCache();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function Dato({ rotulo, valor, color }: { rotulo: string; valor: string; color?: string }) {
  return (
    <div>
      <div className={s.datoRotulo}>{rotulo}</div>
      <div className={s.datoValor} style={color ? { color } : undefined}>
        {valor}
      </div>
    </div>
  );
}

function iniciales(nombre: string): string {
  return (
    nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** El subtítulo bajo el nombre. El diseño pone el teléfono; no lo tenemos. */
function origenDeLaCita(source: string): string {
  switch (source) {
    case "WHATSAPP":
      return "Cita agendada por WhatsApp";
    case "PATIENT_PORTAL":
      return "Cita agendada por el paciente";
    case "WEBSITE":
      return "Cita agendada desde la web";
    default:
      return "Cita agendada en la clínica";
  }
}

function origenCorto(source: string): string {
  switch (source) {
    case "WHATSAPP":
      return "Por WhatsApp";
    case "PATIENT_PORTAL":
      return "Por el paciente";
    case "WEBSITE":
      return "Desde la web";
    default:
      return "En la clínica";
  }
}

/**
 * El PATCH de estado con motivo. `patchAppointmentStatus` no acepta motivo y
 * cambiar su firma tocaría a todos sus llamadores; esto es el mismo endpoint
 * con un campo más, igual que hace el panel de detalle de siempre.
 */
async function patchConMotivo(
  id: string,
  status: AppointmentStatus,
  reason: string,
): Promise<AgendaAppointmentDTO> {
  const res = await fetch(`/api/appointments/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reason }),
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...cuerpo };
  return cuerpo.appointment ?? cuerpo;
}
