"use client";

/**
 * Próximas citas (admin), con el diseño nuevo. La MISMA lógica que
 * `home/parts/upcoming-appointments-card.tsx`: pide /api/dashboard/home/upcoming,
 * cada fila abre la cita en la agenda del día resaltada, y el nombre abre la
 * ficha del paciente. Solo cambia la ropa.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Video } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { formatShortTime } from "@/lib/home/greet";
import type { AppointmentStatus } from "@/lib/home/types";
import { EtiquetaEstado, Tarjeta, Vacio } from "./piezas";
import s from "./hoy.module.css";

interface Proxima {
  id: string;
  startsAt: string;
  status: AppointmentStatus;
  patientId: string;
  patientName: string;
  doctorShortName: string | null;
  reason: string | null;
  isTeleconsult: boolean;
}

export function TarjetaProximas({ limite = 5 }: { limite?: number }) {
  const t = useT();
  const [citas, setCitas] = useState<Proxima[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/dashboard/home/upcoming?limit=${limite}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items?: Proxima[] };
        if (vivo) setCitas(Array.isArray(json.items) ? json.items : []);
      } catch {
        if (vivo) {
          setCitas([]);
          setError(true);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [limite]);

  return (
    <Tarjeta
      icono={CalendarClock}
      titulo={t("home.upcoming.title")}
      sub={t("home.upcoming.subtitle", { count: limite })}
      lista
    >
      {citas === null ? (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`${s.esqueleto} ${s.esqueletoFila}`} aria-hidden />
          ))}
        </>
      ) : error ? (
        <Vacio icono={CalendarClock} tono="peligro" titulo={t("home.upcoming.loadError")} />
      ) : citas.length === 0 ? (
        <Vacio icono={CalendarClock} titulo={t("home.upcoming.empty")} />
      ) : (
        <div role="list" className={s.apilado} style={{ gap: 6 }}>
          {citas.map((cita) => (
            <FilaProxima key={cita.id} cita={cita} />
          ))}
        </div>
      )}
    </Tarjeta>
  );
}

function FilaProxima({ cita }: { cita: Proxima }) {
  const t = useT();
  const router = useRouter();
  const cuando = cuandoLegible(cita.startsAt, t);

  // P1-15: /dashboard/appointments/[id] no existe. Agenda del día + ?highlight=;
  // la fecha se deriva en la zona del navegador, la misma que pinta la hora.
  const abrirCita = () => {
    const d = new Date(cita.startsAt);
    const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    router.push(`/dashboard/agenda?date=${dia}&highlight=${cita.id}`);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("home.upcoming.openAppointmentAria", { name: cita.patientName, when: cuando })}
      onClick={abrirCita}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          abrirCita();
        }
      }}
      className={`${s.fila} ${s.filaBoton}`}
    >
      <span className={`${s.hora} ${s.horaAncha}`}>{cuando}</span>

      <div className={s.filaCuerpo}>
        <button
          type="button"
          className={s.nombre}
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/dashboard/patients/${cita.patientId}`);
          }}
          onKeyDown={(e) => {
            // El teclado abriría la fila además del paciente: se corta aquí.
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
          aria-label={t("home.upcoming.viewRecordAria", { name: cita.patientName })}
        >
          {cita.patientName}
        </button>
        <div className={s.detalle}>
          {cita.isTeleconsult && (
            <Video size={12} strokeWidth={1.75} aria-label={t("home.upcoming.teleconsult")} className={s.iconoTele} />
          )}
          <span>
            {[cita.reason ?? t("home.upcoming.defaultReason"), cita.doctorShortName].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>

      <EtiquetaEstado estado={cita.status} />
    </div>
  );
}

/** «Hoy 14:30» · «Mañana 09:00» · «Lun 12 jun · 10:00», en la zona del navegador. */
function cuandoLegible(iso: string, t: TFunction): string {
  const d = new Date(iso);
  const ahora = new Date();
  const inicioDia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((inicioDia(d) - inicioDia(ahora)) / 86_400_000);
  const hora = formatShortTime(iso);
  const locale = t("home.upcoming.intlLocale");

  if (dias <= 0) return t("home.upcoming.whenToday", { time: hora });
  if (dias === 1) return t("home.upcoming.whenTomorrow", { time: hora });

  const semana = capitalizar(new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d).replace(".", ""));
  const diaMes = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d).replace(".", "");
  return `${semana} ${diaMes} · ${hora}`;
}

function capitalizar(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}
