// Módulo de Ortodoncia — la vista del Tablero (ws1-t3). Solo pinta lo que
// recibe: los datos los carga la página (`tablero/page.tsx`) con
// `tablero-data.ts`, igual que antes. Las barras son el mismo importe
// dibujado en proporción al mayor de su lista; no se calcula dinero aquí.
import {
  Activity,
  AlertCircle,
  BellRing,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Smile,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import type { OrthoTableroData, TodayControlEntry } from "@/lib/orthodontics/tablero-data";
import { EnviarIndicacionesButton } from "@/components/specialties/orthodontics/EnviarIndicacionesButton";
import { horaEnZona } from "./fechas";
import { Pantalla, Tarjeta, Vacio } from "./piezas";
import s from "./modulo.module.css";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function fmtMonthKey(monthKey: string): string {
  const [, m] = monthKey.split("-").map((x) => parseInt(x, 10));
  return MESES[(m ?? 1) - 1] ?? monthKey;
}

/** Ancho de una barra: el importe en proporción al mayor de su lista. */
function anchoBarra(importe: number, mayor: number): string {
  if (mayor <= 0 || importe <= 0) return "0%";
  return `${Math.max(2, Math.round((importe / mayor) * 100))}%`;
}

export function VistaTablero({
  data,
  controlesHoy,
  zonaHoraria,
}: {
  data: OrthoTableroData;
  controlesHoy: TodayControlEntry[];
  /** `clinic.timezone`: la hora de cada control se pinta en la zona de la clínica, no en la del servidor. */
  zonaHoraria: string | null;
}) {
  const mayorProduccion = Math.max(0, ...data.productionByDoctor.map((p) => p.amountMxn));
  const mayorProyeccion = Math.max(0, ...data.monthlyProjection.map((b) => b.amountMxn));

  return (
    <Pantalla
      titulo="Tablero"
      sub="Casos activos, cobranza al corriente y alertas de un vistazo."
      acciones={
        <>
          <Link href="/dashboard/orthodontics/alertas" className={s.boton}>
            <BellRing size={15} strokeWidth={1.9} aria-hidden />
            Alertas
          </Link>
          <Link href="/dashboard/orthodontics/pacientes" className={s.boton}>
            <Users size={15} strokeWidth={1.9} aria-hidden />
            Pacientes en tratamiento
          </Link>
        </>
      }
    >
      <section className={s.kpis} aria-label="Indicadores">
        <KpiCard label="Pacientes activos" value={String(data.activeCasesCount)} icon={Activity} hero />
        <KpiCard label="Controles de hoy" value={String(data.controlsToday)} icon={CalendarCheck} />
        <KpiCard
          label="Saldos vencidos"
          value={String(data.overdue.count)}
          icon={AlertCircle}
          accent={data.overdue.count > 0 ? "danger" : undefined}
          delta={
            data.overdue.amountMxn > 0
              ? { value: fmtMoney(data.overdue.amountMxn), direction: "down", sub: " adeudo" }
              : undefined
          }
        />
        <KpiCard
          label="Colocaciones este mes"
          value={String(data.placementsAndRemovals.placements)}
          icon={Wrench}
        />
        <KpiCard
          label="Retiros este mes"
          value={String(data.placementsAndRemovals.removals)}
          icon={Smile}
        />
      </section>

      <div className={s.rejillaPrincipal}>
        <Tarjeta
          icono={CalendarCheck}
          titulo="Controles de hoy"
          sub="Manda por WhatsApp las indicaciones que ya están en la hoja de control."
          accion={
            <Link href="/dashboard/agenda" className={s.enlace}>
              Ver agenda
              <ChevronRight size={14} aria-hidden />
            </Link>
          }
        >
          {controlesHoy.length === 0 ? (
            <div className={s.tarjetaCuerpo}>
              <Vacio
                icono={CalendarCheck}
                titulo="Hoy no hay controles de ortodoncia"
                pista="Aquí aparecen las citas de tipo «Control de ortodoncia» de hoy, con su botón para mandar las indicaciones."
              />
            </div>
          ) : (
            <ul className={s.tarjetaLista}>
              {controlesHoy.map((c) => (
                <li key={c.appointmentId} className={`${s.fila} ${s.filaApilable}`}>
                  <span className={s.hora}>{horaEnZona(c.startsAt, zonaHoraria)}</span>
                  <div className={s.filaCuerpo}>
                    <span className={s.nombre}>{c.patientName}</span>
                  </div>
                  <div className={s.filaDerecha}>
                    {c.indications ? (
                      <EnviarIndicacionesButton appointmentId={c.appointmentId} />
                    ) : (
                      <span className={s.nota}>Sin indicaciones cargadas</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta
          icono={ClipboardList}
          titulo="Valoraciones"
          sub="Las que se convierten en tratamiento."
        >
          <div className={s.tarjetaCuerpo}>
            <div className={s.cifras}>
              <div className={s.cifra}>
                <div className={s.cifraValor}>{data.valoraciones.total}</div>
                <div className={s.cifraEtiqueta}>
                  valoraci{data.valoraciones.total === 1 ? "ón" : "ones"}
                </div>
              </div>
              <div className={s.cifra}>
                <div className={s.cifraValor}>{data.valoraciones.aceptadas}</div>
                <div className={s.cifraEtiqueta}>
                  aceptada{data.valoraciones.aceptadas === 1 ? "" : "s"}
                </div>
              </div>
              <div className={s.cifra}>
                <div className={s.cifraValor}>{data.valoraciones.pendientes}</div>
                <div className={s.cifraEtiqueta}>por llamar</div>
              </div>
            </div>
            <p className={s.pie}>Valoraciones de pacientes con caso de ortodoncia.</p>
          </div>
        </Tarjeta>
      </div>

      <div className={s.rejillaPar}>
        <Tarjeta icono={TrendingUp} tono="exito" titulo="Producción del mes" sub="Cobros de ortodoncia, por doctor tratante.">
          <div className={s.tarjetaCuerpo}>
            {data.productionByDoctor.length === 0 ? (
              <Vacio
                icono={TrendingUp}
                tono="neutro"
                titulo="Sin cobros de ortodoncia este mes"
                pista="En cuanto se cobre una mensualidad o un anticipo de un caso, aparece aquí por doctor."
              />
            ) : (
              <ul className={s.barras}>
                {data.productionByDoctor.map((p) => (
                  <li key={p.doctorId ?? "sin-doctor"} className={s.barraFila}>
                    <span className={s.barraEtiqueta}>{p.doctorName}</span>
                    <span className={s.importe}>{fmtMoney(p.amountMxn)}</span>
                    <span className={s.barraPista} aria-hidden>
                      <span
                        className={`${s.barraRelleno} ${s.barraRellenoExito}`}
                        style={{ width: anchoBarra(p.amountMxn, mayorProduccion) }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Tarjeta>

        <Tarjeta icono={Wallet} titulo="Lo que va a entrar por mensualidades" sub="Los próximos seis meses.">
          <div className={s.tarjetaCuerpo}>
            {mayorProyeccion <= 0 ? (
              <Vacio
                icono={Wallet}
                tono="neutro"
                titulo="Sin mensualidades por cobrar en los próximos seis meses"
                pista="Cuando un caso tenga su plan de pagos, aquí se ve cuánto va a entrar cada mes."
              />
            ) : (
              <ul className={s.barras}>
                {data.monthlyProjection.map((b) => (
                  <li key={b.monthKey} className={s.barraFila}>
                    <span className={s.barraEtiqueta}>{fmtMonthKey(b.monthKey)}</span>
                    <span className={b.amountMxn > 0 ? s.importe : `${s.importe} ${s.importeApagado}`}>
                      {fmtMoney(b.amountMxn)}
                    </span>
                    <span className={s.barraPista} aria-hidden>
                      <span className={s.barraRelleno} style={{ width: anchoBarra(b.amountMxn, mayorProyeccion) }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Tarjeta>
      </div>
    </Pantalla>
  );
}
