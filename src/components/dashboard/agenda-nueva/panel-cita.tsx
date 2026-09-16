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
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import { aCitaVista, type CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { fechaCorta } from "@/lib/agenda-nueva/fechas";
import { diaEnTz } from "@/lib/agenda-nueva/geometria";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import s from "./agenda-nueva.module.css";

/* ═══ Flujo de la cita ══════════════════════════════════════════════════
   El diseño enseña cinco pasos: Confirmada → Llegó → En consulta → Atendida
   → Cobrada. Los cuatro primeros son estados reales del sistema. El quinto
   no: «cobrada» vive en la factura, no en la cita, y saberlo costaría una
   consulta por cita. Se sustituye por «Salió» (CHECKED_OUT), que sí es un
   estado real y es el final del pipeline. Queda anotado en el reporte.
   ═══════════════════════════════════════════════════════════════════════ */

/** Escalón del flujo al que llega cada estado. */
const PELDANO: Record<AppointmentStatus, number> = {
  SCHEDULED: 0,
  CONFIRMED: 1,
  CHECKED_IN: 2,
  IN_CHAIR: 2,
  IN_PROGRESS: 3,
  COMPLETED: 4,
  CHECKED_OUT: 5,
  // Las dos terminales se salen del carril: el panel enseña un aviso, no pasos.
  CANCELLED: -1,
  NO_SHOW: -1,
};

const PASOS = ["Confirmada", "Llegó", "En consulta", "Atendida", "Salió"] as const;

interface AccionEstado {
  etiqueta: string;
  icono: LucideIcon;
  destino: AppointmentStatus;
}

/**
 * La acción principal del pie, por estado. Es la que el diseño pone en el
 * botón negro de 40 px. Solo se pinta si la transición está PERMITIDA por
 * `possibleTransitions` para este usuario y este momento.
 */
const ACCION_PRINCIPAL: Partial<Record<AppointmentStatus, AccionEstado>> = {
  // El diseño dice «Confirmar por WhatsApp». Aquí es solo «Confirmar»: en el
  // sistema, confirmar es que el paciente confirmó, y mandarle el mensaje es
  // otra acción (el botón de WhatsApp de arriba, que además marca el
  // recordatorio como enviado). Juntarlas mentiría en el expediente.
  SCHEDULED: { etiqueta: "Confirmar cita", icono: Check, destino: "CONFIRMED" },
  CONFIRMED: { etiqueta: "Marcar llegada", icono: DoorOpen, destino: "CHECKED_IN" },
  CHECKED_IN: { etiqueta: "Pasar a consulta", icono: ArrowRight, destino: "IN_PROGRESS" },
  IN_CHAIR: { etiqueta: "Iniciar consulta", icono: ArrowRight, destino: "IN_PROGRESS" },
  IN_PROGRESS: { etiqueta: "Terminar consulta", icono: Check, destino: "COMPLETED" },
  CANCELLED: { etiqueta: "Reabrir cita", icono: RotateCcw, destino: "SCHEDULED" },
  NO_SHOW: { etiqueta: "Reabrir cita", icono: RotateCcw, destino: "SCHEDULED" },
};

/**
 * Plan B cuando la acción principal no está permitida para este rol. Ejemplo
 * real: recepción no puede pasar a consulta (es CLINICAL), pero sí sentar al
 * paciente en el sillón. Sin esto, el botón desaparecería y recepción se
 * quedaría sin siguiente paso.
 */
const ALTERNATIVA: Partial<Record<AppointmentStatus, AccionEstado>> = {
  CHECKED_IN: { etiqueta: "Pasar al sillón", icono: ArrowRight, destino: "IN_CHAIR" },
  IN_CHAIR: { etiqueta: "Terminar consulta", icono: Check, destino: "COMPLETED" },
};

export function PanelCita() {
  const { state, dispatch, permissions, invalidateRangeCache } = useAgenda();
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
            ahora: new Date(),
          })
        : null,
    [dto, state.timezone, state.doctors, state.resources],
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
          a.status !== "CANCELLED" &&
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
        ? possibleTransitions(dto.status, {
            now: new Date(),
            appointmentStart: new Date(dto.startsAt),
          })
        : [],
    [dto],
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

  // La principal: la del estado, o su alternativa si el rol no puede con ella.
  const preferida = ACCION_PRINCIPAL[dto.status];
  const alterna = ALTERNATIVA[dto.status];
  const principal =
    preferida && permitida(preferida.destino)
      ? preferida
      : alterna && permitida(alterna.destino)
        ? alterna
        : null;

  const esCobro = dto.status === "COMPLETED" || dto.status === "CHECKED_OUT";
  const peldano = PELDANO[dto.status];
  const terminal = peldano === -1;

  const hrefExpediente = cita.pacienteId ? `/dashboard/patients/${cita.pacienteId}` : null;

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
            <button
              type="button"
              className={s.panelAccion3}
              onClick={enviarWhatsapp}
              disabled={enviandoWa}
            >
              <MessageCircle size={18} strokeWidth={2} color="var(--ag-verde)" />
              {enviandoWa ? "Enviando…" : "WhatsApp"}
            </button>
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
                  {dto.status === "CANCELLED" ? (
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
                  const hecho = k < peldano;
                  const actual = k === peldano;
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
                        {actual && <div className={s.flujoSub}>{cita.detalle}</div>}
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
          {dto.requiresValidation && dto.status === "SCHEDULED" && (
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
              {dto.status === "CHECKED_OUT" ? (
                <Receipt size={20} strokeWidth={2} />
              ) : (
                <CreditCard size={20} strokeWidth={2} />
              )}
              {buscandoFactura
                ? "Abriendo…"
                : dto.status === "CHECKED_OUT"
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
            {permitida("CHECKED_OUT") && permissions.canEdit && dto.status === "COMPLETED" && (
              <button
                type="button"
                className={s.accionSecundaria}
                onClick={() => cambiarEstado("CHECKED_OUT")}
                disabled={enVuelo !== null}
              >
                <DoorOpen size={18} strokeWidth={2} />
                Marcar salida
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
          clinicTaxMode={null}
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
