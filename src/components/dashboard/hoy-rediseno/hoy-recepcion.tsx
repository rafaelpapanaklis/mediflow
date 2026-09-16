"use client";

/**
 * «Hoy» para recepción, con el diseño nuevo. Dice exactamente lo mismo que
 * `home/home-receptionist.tsx` y con los mismos clics: agenda de hoy con sus
 * mandos, acción inmediata con la sala de espera, lista de espera y los
 * atajos del pie. Solo cambia la ropa.
 */

import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Link from "next/link";
import {
  CalendarDays, CalendarPlus, CheckCircle2, ChevronRight, Clock, ListChecks, Plus,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { formatRelative } from "@/lib/home/greet";
import type { HomeActionItem, HomeReceptionistData } from "@/lib/home/types";
import { AccionesRapidas, BarraAtajos, Saludo, Tarjeta, Vacio } from "./piezas";
import { FilaCita } from "./fila-cita";
import s from "./hoy.module.css";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeReceptionistData;
}

export function HoyRecepcion({ user, data }: Props) {
  const t = useT();
  const router = useRouter();
  const enSala = data.checkedInPatients.length;

  const handleCheckIn = async (id: string) => {
    try {
      // La ruta real es /api/appointments/... (P1-14), y se mira res.ok: sin
      // eso el aviso cantaba éxito con la cita sin pasar a CHECKED_IN.
      const res = await fetch(`/api/appointments/${id}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t("home.recep.checkInOk"));
      router.refresh();
    } catch {
      toast.error(t("home.recep.checkInError"));
    }
  };

  const handleWhatsApp = (id: string) => router.push(`/dashboard/whatsapp?appt=${id}`);
  // P1-15: la cita se abre en la agenda del día, resaltada.
  const handleCall = (id: string) => router.push(`/dashboard/agenda?highlight=${id}`);
  // La página real es /dashboard/walk-in (con guion).
  const agregarAEspera = () => router.push("/dashboard/walk-in?waitlist=1");

  return (
    <>
      <div className={s.cabecera}>
        <Saludo
          nombreCompleto={user.displayName}
          cola={enSala > 0 ? t("home.recep.patientsWaiting", { count: enSala }) : undefined}
        />
        <AccionesRapidas />
      </div>

      <div className={s.rejillaPrincipal}>
        <Tarjeta
          icono={CalendarDays}
          titulo={t("home.recep.todayTitle")}
          sub={
            data.todayAppointments.length === 0
              ? t("home.recep.todayEmpty")
              : t("home.recep.todayCount", { count: data.todayAppointments.length })
          }
          accion={
            <Link href="/dashboard/appointments" className={s.tarjetaEnlace}>
              {t("home.recep.viewFullAgenda")}
              <ChevronRight size={13} strokeWidth={1.75} aria-hidden />
            </Link>
          }
          lista
        >
          {data.todayAppointments.length === 0 ? (
            <VacioCitasHoy />
          ) : (
            data.todayAppointments.map((appt) => (
              <FilaCita
                key={appt.id}
                appt={appt}
                onCheckIn={handleCheckIn}
                onCall={handleCall}
                onWhatsApp={handleWhatsApp}
              />
            ))
          )}
        </Tarjeta>

        <Tarjeta
          icono={ListChecks}
          titulo={t("home.recep.actionTitle")}
          sub={
            data.actionItems.length === 0
              ? t("home.recep.actionEmpty")
              : t("home.recep.actionCount", { count: data.actionItems.length })
          }
          lista
        >
          {data.actionItems.length === 0 ? (
            <Vacio
              icono={CheckCircle2}
              tono="exito"
              titulo={t("clinical.emptyStates.allClearTitle")}
              pista={t("clinical.emptyStates.allClearDesc")}
            />
          ) : (
            data.actionItems.map((item) => <FilaPendiente key={item.id} item={item} />)
          )}

          {data.checkedInPatients.length > 0 && (
            <div className={s.sala}>
              <div className={s.salaTitulo}>
                <Clock size={11} aria-hidden />
                {t("home.recep.waitingRoom")}
              </div>
              {data.checkedInPatients.map((p) => (
                <div key={p.id} className={s.salaFila}>
                  <span>{p.patient.name}</span>
                  <span>{p.minutesWaiting ?? 0} min</span>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
      </div>

      <Tarjeta
        icono={Clock}
        titulo={t("home.waitlist.title")}
        sub={
          data.waitlist.length === 0
            ? t("home.waitlist.emptySubtitle")
            : t("home.waitlist.subtitle", { count: data.waitlist.length })
        }
        accion={
          <button type="button" className={`${s.boton} ${s.botonPeq}`} onClick={agregarAEspera}>
            <Plus size={14} strokeWidth={1.75} aria-hidden />
            {t("common.add")}
          </button>
        }
        lista
      >
        {data.waitlist.length === 0 ? (
          <Vacio
            icono={Clock}
            titulo={t("clinical.emptyStates.waitlistTitle")}
            pista={t("clinical.emptyStates.waitlistDesc")}
            acciones={
              <button
                type="button"
                className={`${s.boton} ${s.botonPeq} ${s.botonPrincipal}`}
                onClick={agregarAEspera}
              >
                <Plus size={14} strokeWidth={1.75} aria-hidden />
                {t("clinical.emptyStates.waitlistAddCta")}
              </button>
            }
          />
        ) : (
          data.waitlist.map((it) => (
            <div key={it.id} className={s.fila}>
              <div className={s.filaCuerpo}>
                <span className={`${s.nombre} ${s.nombreFijo}`}>{it.patient.name}</span>
                {it.reason && (
                  <div className={s.detalle}>
                    <span>{it.reason}</span>
                  </div>
                )}
              </div>
              <span className={s.derecha}>{formatRelative(it.since)}</span>
            </div>
          ))
        )}
      </Tarjeta>

      <BarraAtajos />
    </>
  );
}

/**
 * El vacío de «Agenda de hoy» con los DOS botones que ya ofrece la home de
 * siempre (`EmptyAppointmentsToday`): nueva cita y ver la semana.
 */
export function VacioCitasHoy() {
  const t = useT();
  return (
    <Vacio
      icono={CalendarDays}
      titulo={t("clinical.emptyStates.apptsTodayTitle")}
      pista={t("clinical.emptyStates.apptsTodayDesc")}
      acciones={
        <>
          <Link href="/dashboard/appointments?new=1" className={`${s.boton} ${s.botonPeq} ${s.botonPrincipal}`}>
            <CalendarPlus size={14} strokeWidth={1.75} aria-hidden />
            {t("clinical.emptyStates.apptsNewCta")}
          </Link>
          <Link href="/dashboard/appointments?view=week" className={`${s.boton} ${s.botonPeq}`}>
            <CalendarDays size={14} strokeWidth={1.75} aria-hidden />
            {t("clinical.emptyStates.apptsWeekCta")}
          </Link>
        </>
      }
    />
  );
}

const PUNTO: Record<HomeActionItem["tone"], string> = {
  brand:   s.puntoVioleta,
  success: s.puntoExito,
  warning: s.puntoAlerta,
  danger:  s.puntoPeligro,
  info:    s.puntoInfo,
  neutral: "",
};

function FilaPendiente({ item }: { item: HomeActionItem }) {
  const cta = item.cta;
  const cuerpo = (
    <>
      <span aria-hidden className={`${s.punto} ${PUNTO[item.tone]}`} />
      <div className={s.filaCuerpo}>
        <span className={`${s.nombre} ${s.nombreFijo}`}>{item.title}</span>
        {item.detail && (
          <div className={`${s.detalle} ${s.detalleLargo}`}>
            <span>{item.detail}</span>
          </div>
        )}
        {cta && (
          <span className={s.enlaceInterno}>
            {cta.label}
            <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
          </span>
        )}
      </div>
    </>
  );

  if (cta?.href) {
    return (
      <Link href={cta.href} className={`${s.fila} ${s.filaArriba} ${s.filaBoton}`}>
        {cuerpo}
      </Link>
    );
  }
  if (cta?.onClick) {
    return (
      <button type="button" onClick={cta.onClick} className={`${s.fila} ${s.filaArriba} ${s.filaBoton}`}>
        {cuerpo}
      </button>
    );
  }
  return <div className={`${s.fila} ${s.filaArriba}`}>{cuerpo}</div>;
}
