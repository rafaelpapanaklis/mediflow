// Módulo de Ortodoncia — la vista del Tablero (ws1-t3). Solo pinta lo que
// recibe: los datos los carga la página (`tablero/page.tsx`) con
// `tablero-data.ts`, igual que antes. Las barras son el mismo importe
// dibujado en proporción al mayor de su lista; no se calcula dinero aquí.
//
// Sin atajos a otros apartados del módulo (Rafael, 28-sep-2026): «Alertas» y
// «Pacientes en tratamiento» salían como botones en la cabecera y repetían el
// submenú, que está justo encima. Para moverse por el módulo, el submenú.
//
// ws1-t4 ronda 6 (revisión de lógica de uso, filas 14, 16 y 17):
//  - Cada indicador LLEVA a la lista que lo explica, ya filtrada (los casos
//    con vencido, los colocados este mes…). Antes era un número sin salida.
//    No es un atajo que repita el submenú: cada uno lleva su filtro o su
//    ancla, y un candado en `modulo-diseno.test.ts` vigila que siga así.
//  - «Valoraciones» son citas de valoración de los últimos 90 días y cuántas
//    abrieron caso (antes, presupuestos de cualquier cosa y fecha).
//  - «Cobrado este mes»: es dinero que entró, no producción.
//  - El primer pago de un caso es el «enganche»: «anticipo» ya significa otra
//    cosa en Caja.
//  - El nombre de cada control de hoy abre el caso del paciente.
// «Ver agenda» se queda como está: es la salida a la Agenda que Rafael dejó.
import {
  Activity,
  AlertCircle,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Smile,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import type { OrthoTableroData, TodayControlEntry } from "@/lib/orthodontics/tablero-data";
import { DIAS_VENTANA_VALORACIONES } from "@/lib/orthodontics/valoraciones-tablero";
import { EnviarIndicacionesButton } from "@/components/specialties/orthodontics/EnviarIndicacionesButton";
import { BotonHojaControl } from "@/components/specialties/orthodontics/agenda/BotonHojaControl";
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
/** «No cuenta $8,000 de 1 caso en pausa y 1 abandonado.» — o nada, si no se dejó nada fuera. */
function fraseDeExcluidos(fuera: OrthoTableroData["projectionExcluded"]): string | null {
  if (!fuera || fuera.amountMxn <= 0) return null;
  const partes: string[] = [];
  if (fuera.enPausa > 0) partes.push(`${fuera.enPausa} ${fuera.enPausa === 1 ? "caso en pausa" : "casos en pausa"}`);
  if (fuera.abandonados > 0) partes.push(`${fuera.abandonados} ${fuera.abandonados === 1 ? "abandonado" : "abandonados"}`);
  return `No cuenta ${fmtMoney(fuera.amountMxn)} de ${partes.join(" y ")}: esa deuda sigue en Cobranza.`;
}

/** Un indicador que lleva a su lista. El nombre accesible dice a dónde va. */
function Indicador({ href, destino, children }: { href: string; destino: string; children: ReactNode }) {
  return (
    <Link href={href} className={s.kpiEnlace} aria-label={destino}>
      {children}
    </Link>
  );
}

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
    >
      <section className={s.kpis} aria-label="Indicadores">
        <Indicador
          href="/dashboard/orthodontics/pacientes?estado=activos"
          destino={`Casos activos: ${data.activeCasesCount}. Ver los casos activos`}
        >
          <KpiCard label="Casos activos" value={String(data.activeCasesCount)} icon={Activity} hero />
        </Indicador>
        <Indicador
          href="/dashboard/orthodontics/controles#controles-de-hoy"
          destino={`Controles de hoy: ${data.controlsToday}. Ver los controles de hoy`}
        >
          <KpiCard label="Controles de hoy" value={String(data.controlsToday)} icon={CalendarCheck} />
        </Indicador>
        <Indicador
          href="/dashboard/orthodontics/cobranza?filtro=vencido"
          destino={`Casos con mensualidades vencidas: ${data.overdue.count}. Ver quién debe`}
        >
          <KpiCard
            label="Casos con vencido"
            value={String(data.overdue.count)}
            icon={AlertCircle}
            accent={data.overdue.count > 0 ? "danger" : undefined}
            delta={
              data.overdue.amountMxn > 0
                ? { value: fmtMoney(data.overdue.amountMxn), direction: "down", sub: " vencido" }
                : undefined
            }
          />
        </Indicador>
        <Indicador
          href="/dashboard/orthodontics/pacientes?ver=colocados-este-mes"
          destino={`Colocaciones este mes: ${data.placementsAndRemovals.placements}. Ver esos casos`}
        >
          <KpiCard
            label="Colocaciones este mes"
            value={String(data.placementsAndRemovals.placements)}
            icon={Wrench}
          />
        </Indicador>
        <Indicador
          href="/dashboard/orthodontics/pacientes?ver=retirados-este-mes"
          destino={`Retiros este mes: ${data.placementsAndRemovals.removals}. Ver esos casos`}
        >
          <KpiCard
            label="Retiros este mes"
            value={String(data.placementsAndRemovals.removals)}
            icon={Smile}
          />
        </Indicador>
      </section>

      <div className={s.rejillaPrincipal}>
        <Tarjeta
          icono={CalendarCheck}
          titulo="Controles de hoy"
          sub="Manda por WhatsApp las indicaciones que ya están en la hoja de control."
          accion={
            // Fila 15 (ws1-t4 ronda 6, decisión del gerente): «Ver controles»
            // lleva a Controles dentro del módulo; a la Agenda se sale desde ahí.
            <Link href="/dashboard/orthodontics/controles#controles-de-hoy" className={s.enlace}>
              Ver controles
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
                    <Link href={`/dashboard/patients/${c.patientId}?tab=ortodoncia`} className={s.nombre}>
                      {c.patientName}
                    </Link>
                  </div>
                  <div className={s.filaDerecha}>
                    {/* M3 (Ronda 6, «El día de la ortodoncista»): la fila del
                        control de hoy es de donde MÁS falta hacía el botón —
                        es la lista completa del día. Sin hoja todavía, se
                        registra desde aquí mismo; con hoja ya hecha, el hueco
                        vuelve a ser "Enviar indicaciones". */}
                    {!c.hasCard && c.treatmentPlanId ? (
                      <BotonHojaControl appointmentId={c.appointmentId} treatmentPlanId={c.treatmentPlanId} />
                    ) : c.indications ? (
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
          sub={`Citas de valoración de los últimos ${data.valoraciones.dias ?? DIAS_VENTANA_VALORACIONES} días.`}
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
                  {data.valoraciones.aceptadas === 1 ? "abrió caso" : "abrieron caso"}
                </div>
              </div>
              <div className={s.cifra}>
                <div className={s.cifraValor}>{data.valoraciones.pendientes}</div>
                <div className={s.cifraEtiqueta}>por llamar</div>
              </div>
            </div>
            <p className={s.pie}>
              Pacientes que vinieron a su valoración. «Por llamar» son los que todavía no abren caso.
              {(data.valoraciones.agendadas ?? 0) > 0 &&
                ` Además hay ${data.valoraciones.agendadas} ${
                  data.valoraciones.agendadas === 1 ? "valoración agendada" : "valoraciones agendadas"
                }.`}
            </p>
          </div>
        </Tarjeta>
      </div>

      <div className={s.rejillaPar}>
        <Tarjeta icono={TrendingUp} tono="exito" titulo="Cobrado este mes" sub="Cobros de ortodoncia menos reembolsos, para el doctor que llevaba el caso el día del pago.">
          <div className={s.tarjetaCuerpo}>
            {data.productionByDoctor.length === 0 ? (
              <Vacio
                icono={TrendingUp}
                tono="neutro"
                titulo="Sin cobros de ortodoncia este mes"
                pista="En cuanto se cobre una mensualidad o el enganche de un caso, aparece aquí por doctor."
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

        <Tarjeta icono={Wallet} titulo="Lo que va a entrar por mensualidades" sub="Los próximos seis meses, de los casos en curso.">
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
            {fraseDeExcluidos(data.projectionExcluded) ? (
              <p className={s.pie}>{fraseDeExcluidos(data.projectionExcluded)}</p>
            ) : null}
          </div>
        </Tarjeta>
      </div>
    </Pantalla>
  );
}
