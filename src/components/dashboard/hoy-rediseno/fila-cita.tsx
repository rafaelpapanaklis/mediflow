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
import { formatShortTime } from "@/lib/home/greet";
import type { AppointmentDTO } from "@/lib/home/types";
import { EtiquetaEstado } from "./piezas";
import s from "./hoy.module.css";

interface Props {
  appt: AppointmentDTO;
  /** Sin mandos (la vista del doctor). */
  compacta?: boolean;
  onCheckIn?: (id: string) => void;
  onCall?: (id: string) => void;
  onWhatsApp?: (id: string) => void;
}

export function FilaCita({ appt, compacta, onCheckIn, onCall, onWhatsApp }: Props) {
  const router = useRouter();
  const t = useT();
  const puedeCheckIn = appt.status === "SCHEDULED" || appt.status === "CONFIRMED";
  // P1-15: /dashboard/appointments/[id] no existe. La cita se abre en la agenda
  // del día resaltada con ?highlight=, igual que la home de siempre.
  const abrirEnAgenda = () => router.push(`/dashboard/agenda?highlight=${appt.id}`);

  return (
    <div className={s.fila}>
      <span className={s.hora}>{formatShortTime(appt.startsAt)}</span>

      <div className={s.filaCuerpo}>
        <button
          type="button"
          className={s.nombre}
          onClick={() => router.push(`/dashboard/patients/${appt.patient.id}`)}
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

      {!compacta && (
        <div className={s.filaAcciones}>
          {puedeCheckIn && (
            <BotonIcono
              icono={CheckCircle2}
              etiqueta="Check-in"
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
  onClick,
  exito,
}: {
  icono: LucideIcon;
  etiqueta: string;
  onClick?: () => void;
  exito?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className={`${s.botonIcono} ${exito ? s.botonIconoExito : ""}`}
    >
      <Icono size={16} strokeWidth={1.75} />
    </button>
  );
}
