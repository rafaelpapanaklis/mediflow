"use client";

/**
 * Una cita de hoy, en una fila: hora, paciente (abre su ficha), motivo y
 * doctor, la etiqueta de estado, los minutos esperando si ya está en sala y,
 * en recepción, los cuatro mandos de siempre a la vista: check-in, llamar,
 * WhatsApp y el desplegable con ver / reagendar / cancelar. Mismos destinos y
 * mismos clics que `home/parts/today-appointment-row.tsx`.
 */

import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CheckCircle2, Footprints, MessageCircle, MoreHorizontal, Phone, Video,
  type LucideIcon,
} from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { useT } from "@/i18n/i18n-provider";
import { useAyudaDelPaso } from "@/lib/agenda/ayuda-de-pasos";
import { formatShortTime } from "@/lib/home/greet";
import type { AppointmentDTO } from "@/lib/home/types";
import { destinoDeLaCitaEnHoy } from "@/lib/orthodontics/hoy";
import { RegistrarControlEnFila } from "@/components/specialties/orthodontics/agenda/RegistrarControlEnFila";
import { EtiquetaEstado } from "./piezas";
import s from "./hoy.module.css";

interface Props {
  appt: AppointmentDTO;
  /** Sin mandos (la vista del doctor). */
  compacta?: boolean;
  /** Zona de la clínica: la hora se pinta ahí, no en la del navegador. */
  timeZone?: string | null;
  onCheckIn?: (id: string) => void;
  onCall?: (id: string) => void;
  onWhatsApp?: (id: string) => void;
}

export function FilaCita({ appt, compacta, timeZone, onCheckIn, onCall, onWhatsApp }: Props) {
  const router = useRouter();
  const t = useT();
  const ayudaDelPaso = useAyudaDelPaso();
  const puedeCheckIn = appt.status === "SCHEDULED" || appt.status === "CONFIRMED";
  // P1-15: /dashboard/appointments/[id] no existe. La cita se abre en la agenda
  // del día resaltada con ?highlight=, igual que la home de siempre.
  const abrirEnAgenda = () => router.push(`/dashboard/agenda?highlight=${appt.id}`);

  return (
    <div className={s.fila}>
      <span className={s.hora}>{formatShortTime(appt.startsAt, timeZone)}</span>

      <div className={s.filaCuerpo}>
        <button
          type="button"
          className={s.nombre}
          // Un control de ortodoncia abre el caso del paciente, no la ficha general.
          onClick={() =>
            router.push(destinoDeLaCitaEnHoy({ patientId: appt.patient.id, motivo: appt.reason }))
          }
        >
          {appt.patient.name}
        </button>
        <div className={s.detalle}>
          {appt.isTeleconsult && (
            <Video size={12} strokeWidth={1.75} aria-hidden className={s.iconoTele} />
          )}
          {appt.isWalkIn && (
            <Footprints size={12} strokeWidth={1.75} aria-hidden className={s.iconoWalkIn} />
          )}
          <span>
            {appt.reason ?? t("home.apptRow.defaultReason")}
            {appt.doctor && ` · ${appt.doctor.shortName}`}
          </span>
        </div>
      </div>

      <EtiquetaEstado estado={appt.status} />

      {appt.status === "CHECKED_IN" && appt.minutesWaiting != null && (
        <span className={s.espera}>
          {t("home.apptRow.minutesWaiting", { count: appt.minutesWaiting })}
        </span>
      )}

      {/* M3 (ws1-t8, Ronda 6): hallazgo 3 — "Hoy" era una de las tres
          pantallas que listaban controles de ortodoncia sin poder
          registrarlos. Se autocalifica sola (nada se pinta si la cita no es
          un control o el paciente no tiene caso) — igual que RanuraCita.tsx
          en el panel de la Agenda. Fuera del `!compacta`: también vive en la
          vista del doctor. */}
      <RegistrarControlEnFila appointmentId={appt.id} patientId={appt.patient.id} reason={appt.reason} />

      {!compacta && (
        <div className={s.filaAcciones}>
          {puedeCheckIn && (
            <BotonIcono
              icono={CheckCircle2}
              etiqueta="Check-in"
              ayuda={ayudaDelPaso("CHECKED_IN")}
              onClick={() => onCheckIn?.(appt.id)}
              exito
            />
          )}
          <BotonIcono icono={Phone} etiqueta={t("home.apptRow.call")} onClick={() => onCall?.(appt.id)} />
          <BotonIcono
            icono={MessageCircle}
            etiqueta={t("home.apptRow.sendWhatsApp")}
            onClick={() => onWhatsApp?.(appt.id)}
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" aria-label={t("home.apptRow.moreActions")} className={s.botonIcono}>
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              {/* Sale por un portal, fuera de la raíz: lleva los tokens del menú
                  puestos a mano, como todo lo que el menú pinta en portales. */}
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className={`${CLASES_MENU} ${s.desplegable}`}
              >
                <DropdownMenu.Item className={s.desplegableItem} onSelect={abrirEnAgenda}>
                  {t("home.apptRow.viewAppointment")}
                </DropdownMenu.Item>
                <DropdownMenu.Item className={s.desplegableItem} onSelect={abrirEnAgenda}>
                  {t("home.apptRow.reschedule")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={`${s.desplegableItem} ${s.desplegablePeligro}`}
                  onSelect={abrirEnAgenda}
                >
                  {t("home.apptRow.cancelAppointment")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
    </div>
  );
}

function BotonIcono({
  icono: Icono,
  etiqueta,
  ayuda,
  onClick,
  exito,
}: {
  icono: LucideIcon;
  etiqueta: string;
  /** 9a (ws1-t2): qué hace el paso; el botón es solo icono, así que va en el tooltip y en el nombre accesible. */
  ayuda?: string | null;
  onClick?: () => void;
  exito?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ayuda ? `${etiqueta}: ${ayuda}` : etiqueta}
      title={ayuda ? `${etiqueta}: ${ayuda}` : etiqueta}
      className={`${s.botonIcono} ${exito ? s.botonIconoExito : ""}`}
    >
      <Icono size={16} strokeWidth={1.75} />
    </button>
  );
}
