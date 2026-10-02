// Módulo de Ortodoncia — la vista de «Controles / agenda» (ws1-t3, H16 de la
// QA en vivo del 28-sep-2026: el apartado decía «Próximamente»).
//
// Solo pinta lo que recibe: los datos los carga la página
// (`controles/page.tsx`) con `controles-data.ts`. Un control ES una cita de la
// Agenda; esto no es otra agenda, es la de siempre filtrada a los controles, y
// cada fila lleva a su día en la Agenda.
//
// Tres tarjetas: los controles de hoy, los de los próximos siete días y quién
// falta de control (caso activo sin su próximo control agendado).
//
// ws1-t4 ronda 6 (revisión de lógica de uso, filas 21 y 24): la lista se llama
// «Sin próximo control» aquí Y en Alertas (antes «Sin su próximo control» y
// «Falta de control»: la misma lista con dos nombres), y el estado de cada
// cita se dice igual que en la Agenda y en la ficha (`estadoDeCita`).
import type { ReactNode } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  type LucideIcon,
} from "lucide-react";
import type { OrthoControlesData } from "@/lib/orthodontics/controles-data";
import {
  DIAS_DE_LA_SEMANA,
  citaAtendida,
  controlPendiente,
  estadoDeCita,
  fraseSinControl,
  rotuloDelDia,
  type CitaDeControl,
  type TonoEstado,
} from "@/lib/orthodontics/controles-modulo";
import { AgendarControlBoton } from "./agendar-control";
import { BotonHojaControl } from "@/components/specialties/orthodontics/agenda/BotonHojaControl";
import { horaEnZona } from "./fechas";
import { Pantalla, Tarjeta, Vacio, type Tono } from "./piezas";
import { progresoDeControles, textoControlQueSigue } from "@/lib/orthodontics/plan-detalle";
import s from "./modulo.module.css";

const CLASE_TONO: Record<Tono, string> = {
  violeta: "",
  exito: s.tonoExito,
  alerta: s.tonoAlerta,
  peligro: s.tonoPeligro,
  neutro: s.tonoNeutro,
};

const CLASE_ESTADO: Record<TonoEstado, string> = {
  violeta: s.etiquetaVioleta,
  exito: s.etiquetaExito,
  alerta: s.etiquetaAlerta,
  peligro: s.etiquetaPeligro,
  neutro: s.etiquetaNeutra,
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * ws1-t12 (ticket BEVADENT 12): «2 controles · 1 ya atendido». Solo cuenta como control lo que sigue por atender; una
 * cita futura ya marcada «Atendida» se lista y se dice aparte.
 */
function cuentaDeControles(pendientes: number, atendidos: number, uno: string, varios: string): string {
  return [pendientes > 0 || atendidos === 0 ? plural(pendientes, uno, varios) : null, atendidos > 0 ? plural(atendidos, "ya atendido", "ya atendidos") : null]
    .filter(Boolean)
    .join(" · ");
}

export function VistaControles({
  data,
  zonaHoraria,
  puedeAgendar,
}: {
  data: OrthoControlesData;
  /** `clinic.timezone`: la hora de cada control se pinta en la zona de la clínica, no en la del servidor. */
  zonaHoraria: string | null;
  /** Permiso `agenda.create`, decidido en el servidor: sin él no sale «Agendar control». */
  puedeAgendar: boolean;
}) {
  const { semana, sinControl, hoy } = data;
  const deHoy = semana.hoy.filter((c) => c.status !== "CANCELLED").length;

  const resumen: { id: string; valor: number; etiqueta: string; icono: LucideIcon; tono: Tono }[] = [
    { id: "controles-de-hoy", valor: deHoy, etiqueta: "Controles de hoy", icono: CalendarCheck, tono: "violeta" },
    {
      id: "proximos-dias",
      valor: semana.totalProximos,
      etiqueta: `En los próximos ${DIAS_DE_LA_SEMANA} días`,
      icono: CalendarRange,
      tono: "violeta",
    },
    { id: "sin-control", valor: sinControl.length, etiqueta: "Sin próximo control", icono: Clock, tono: "alerta" },
  ];

  return (
    <Pantalla
      titulo="Controles / agenda"
      sub={
        data.casosActivos === 0
          ? "Los controles de ortodoncia de la Agenda, y quién falta de control."
          : `${plural(deHoy, "control hoy", "controles hoy")} · ${plural(sinControl.length, "caso", "casos")} de ${data.casosActivos} sin próximo control.`
      }
      // Fila 15 (ws1-t4 ronda 6, decisión del gerente): el ÚNICO enlace a la
      // Agenda de esta pantalla. «Ver el día», el título de cada día y «Ver en
      // la Agenda» de cada fila eran tres salidas más al mismo sitio.
      acciones={
        <Link href={`/dashboard/agenda?date=${hoy}`} className={s.boton}>
          <CalendarDays size={15} strokeWidth={1.9} aria-hidden />
          Abrir la Agenda
        </Link>
      }
    >
      <nav className={`${s.cuadros} ${s.cuadros3}`} aria-label="Ir a cada lista">
        {resumen.map((r) => (
          <a
            key={r.id}
            href={`#${r.id}`}
            className={r.valor === 0 ? `${s.resumenItem} ${s.resumenItemVacio}` : s.resumenItem}
          >
            <span className={`${s.tarjetaIcono} ${r.valor === 0 ? s.tonoNeutro : CLASE_TONO[r.tono]}`} aria-hidden>
              <r.icono size={15} strokeWidth={1.9} />
            </span>
            <span className={s.resumenTextos}>
              <span className={s.resumenValor}>{r.valor}</span>
              <span className={s.resumenEtiqueta}>{r.etiqueta}</span>
            </span>
          </a>
        ))}
      </nav>

      <Tarjeta
        id="controles-de-hoy"
        icono={CalendarCheck}
        titulo="Controles de hoy"
        sub={
          semana.hoy.length > 0
            ? [
                semana.resumenHoy.enPie > 0 ? plural(semana.resumenHoy.enPie, "por atender", "por atender") : null,
                semana.resumenHoy.atendidos > 0 ? plural(semana.resumenHoy.atendidos, "completado", "completados") : null,
                semana.resumenHoy.faltaron > 0 ? plural(semana.resumenHoy.faltaron, "no asistió", "no asistieron") : null,
                semana.resumenHoy.cancelados > 0 ? plural(semana.resumenHoy.cancelados, "cancelado", "cancelados") : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      >
        {semana.hoy.length === 0 ? (
          <div className={s.tarjetaCuerpo}>
            <Vacio
              icono={CalendarCheck}
              titulo="Hoy no hay controles de ortodoncia"
              pista="Aquí aparecen las citas de tipo «Control de ortodoncia» de hoy. Se agendan desde la Agenda o desde «Sin próximo control», más abajo."
            />
          </div>
        ) : (
          <ul className={s.tarjetaLista}>
            {semana.hoy.map((c) => (
              <FilaDeControl key={c.appointmentId} cita={c} zonaHoraria={zonaHoraria} esHoy />
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta
        id="proximos-dias"
        icono={CalendarRange}
        titulo={`Próximos ${DIAS_DE_LA_SEMANA} días`}
        sub={
          semana.totalProximos > 0 || semana.atendidosProximos > 0
            ? cuentaDeControles(semana.totalProximos, semana.atendidosProximos, "control agendado", "controles agendados")
            : undefined
        }
      >
        {semana.proximosDias.length === 0 ? (
          <p className={s.enOrden}>
            <CalendarRange size={15} strokeWidth={1.9} aria-hidden />
            No hay controles agendados de mañana a {DIAS_DE_LA_SEMANA} días.
          </p>
        ) : (
          <div className={s.dias}>
            {semana.proximosDias.map((d) => (
              <section key={d.dia} className={s.dia} aria-label={rotuloDelDia(d.dia, hoy)}>
                <h3 className={s.diaTitulo}>
                  {rotuloDelDia(d.dia, hoy)}
                  <span className={s.diaCuenta}>
                    {cuentaDeControles(
                      d.citas.filter((c) => controlPendiente(c.status)).length,
                      d.citas.filter((c) => citaAtendida(c.status)).length,
                      "control",
                      "controles",
                    )}
                  </span>
                </h3>
                <ul className={s.diaLista}>
                  {d.citas.map((c) => (
                    <FilaDeControl key={c.appointmentId} cita={c} zonaHoraria={zonaHoraria} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        id="sin-control"
        icono={Clock}
        tono={sinControl.length > 0 ? "alerta" : "neutro"}
        titulo="Sin próximo control"
        sub={sinControl.length > 0 ? "Casos activos que no tienen ningún control agendado. Arriba, quien lleva más tiempo sin venir." : undefined}
        accion={
          sinControl.length > 0 ? (
            <span className={`${s.contador} ${s.contadorAlerta}`}>
              {sinControl.length}
              <span className={s.soloLector}> caso{sinControl.length === 1 ? "" : "s"}</span>
            </span>
          ) : undefined
        }
      >
        {sinControl.length === 0 ? (
          <p className={s.enOrden}>
            <CheckCircle2 size={15} strokeWidth={1.9} aria-hidden />
            {data.casosActivos === 0
              ? "Aún no hay casos activos."
              : "Todos los casos activos tienen su próximo control agendado."}
          </p>
        ) : (
          <ul className={s.tarjetaLista}>
            {sinControl.map((c) => (
              <li key={c.patientId} className={`${s.fila} ${s.filaApilable}`}>
                <div className={s.filaCuerpo}>
                  <Link
                    href={`/dashboard/patients/${c.patientId}?tab=ortodoncia`}
                    className={`${s.nombre} ${s.nombreEstirado}`}
                  >
                    {c.patientName}
                  </Link>
                  <div className={c.urgente || c.faltoAlUltimo ? `${s.detalle} ${s.detallePeligro}` : s.detalle}>
                    {fraseSinControl(c)}
                  </div>
                  {c.treatingDoctorName && <div className={s.detalle}>{c.treatingDoctorName}</div>}
                </div>
                {puedeAgendar && (
                  <div className={s.filaDerecha}>
                    <AgendarControlBoton patientId={c.patientId} patientName={c.patientName} doctorId={c.treatingDoctorId} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </Pantalla>
  );
}

function FilaDeControl({
  cita,
  zonaHoraria,
  esHoy = false,
}: {
  cita: CitaDeControl;
  zonaHoraria: string | null;
  /** M3 (Ronda 6): esta fila es la de HOY — habilita "Registrar control". */
  esHoy?: boolean;
}) {
  const estado = estadoDeCita(cita.status);
  const cancelada = cita.status === "CANCELLED";
  let hoja: ReactNode = null;
  if (cita.hoja === "SIGNED") {
    hoja = (
      <span className={`${s.nota} ${s.notaExito}`}>
        <ClipboardCheck size={13} strokeWidth={1.9} aria-hidden />
        Hoja de control firmada
      </span>
    );
  } else if (cita.hoja === "DRAFT") {
    hoja = <span className={s.nota}>Hoja de control sin firmar</span>;
  }
  // M3 (ws1-t8, Ronda 6): esta misma fila (usada por «Controles de hoy» Y
  // por «próximos 7 días») es de donde el reporte pide registrar el control
  // — solo tiene sentido HOY (sin hoja todavía, sin cancelar): un control de
  // dentro de tres días no se firma antes de que pase.
  const puedeRegistrarAqui =
    esHoy && !cancelada && cita.hoja === null && Boolean(cita.treatmentPlanId);

  return (
    <li className={cancelada ? `${s.fila} ${s.filaApilable} ${s.filaApagada}` : `${s.fila} ${s.filaApilable}`}>
      <span className={s.hora}>{horaEnZona(cita.startsAt, zonaHoraria)}</span>
      <div className={s.filaCuerpo}>
        <Link href={`/dashboard/patients/${cita.patientId}?tab=ortodoncia`} className={s.nombre}>
          {cita.patientName}
        </Link>
        {cita.doctorName && <div className={s.detalle}>{cita.doctorName}</div>}
        {/* ws1-t12: «Control 6 de 18», del plan de tratamiento del caso. */}
        {cita.progreso && !cancelada && (
          <div className={s.detalle}>{textoControlQueSigue(progresoDeControles(cita.progreso.numero - 1, cita.progreso.previstos))}</div>
        )}
      </div>
      <div className={s.filaDerecha}>
        <span className={`${s.etiqueta} ${CLASE_ESTADO[estado.tono]}`}>{estado.texto}</span>
        {puedeRegistrarAqui && cita.treatmentPlanId ? (
          <BotonHojaControl appointmentId={cita.appointmentId} treatmentPlanId={cita.treatmentPlanId} compacto firmada={cita.hojaFirmadaSinCita} />
        ) : (
          hoja
        )}
      </div>
    </li>
  );
}
