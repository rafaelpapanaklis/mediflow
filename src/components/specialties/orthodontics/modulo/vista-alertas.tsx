// Módulo de Ortodoncia — la vista de Alertas (ws1-t3). Solo pinta lo que
// recibe: las alertas las carga la página (`alertas/page.tsx`) con
// `alerts-data.ts`, igual que antes. Arriba, un resumen con el conteo de cada
// tipo que salta a su sección; debajo, las secciones en el orden de
// siempre. Una sección sin casos se queda en una línea.
//
// ws1-t4 ronda 6 (revisión de lógica de uso, filas 21 y 22):
//  - «Sin próximo control» se llama igual que en Controles (antes aquí era
//    «Falta de control») y lleva el MISMO botón «Agendar control»: quien
//    llega por la alerta ya no se queda sin poder hacer nada.
//  - Quien no asistió a su control también se puede reagendar desde aquí.
//  - El estado se dice como en la Agenda y en la ficha: «No asistió».
//  - Un solo nombre para el expediente de ortodoncia: «caso».
//
// ws1-t5 ronda 6 (hallazgo 96): sexta sección, «Fotos del paciente por
// revisar». El portal le dice al paciente «tu clínica la revisará» y aquí
// nadie se enteraba de que había llegado una foto.
//
// ws1-t4 ronda 6 (fila 22, segunda mitad): «Posponer 7 días» en las cuatro
// secciones que no son dinero ni fotos. Lo pospuesto ya llega quitado de
// `alerts` y aquí solo se cuenta en el subtítulo.
"use client";
import { Children, useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarX,
  Camera,
  CheckCircle2,
  Clock,
  Hourglass,
  ClipboardCheck,
  ScanLine,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type {
  DurationAlertEntry,
  MissingNextControlEntry,
  OverduePatientEntry,
} from "@/lib/orthodontics/specialty-kpis";
import type { NoShowEntry, OrthoAlertsData, ReevaluacionRadiograficaEntry } from "@/lib/orthodontics/alerts-data";
import { notaCorta, resumenDeFotos, type FotosPorRevisarEntry } from "@/lib/orthodontics/fotos-paciente";
import { EnviarRecordatorioButton } from "@/components/specialties/orthodontics/EnviarRecordatorioButton";
import { AgendarControlBoton } from "./agendar-control";
import { FilaDeCasoIncompleto } from "./casos-incompletos";
import { PosponerAlertaBoton } from "./posponer-alerta";
import { ListaDePospuestas } from "./lista-de-pospuestas";
import { RefrescarAlertasContext } from "./refrescar-alertas";
import { cargarAlertasDeOrtodoncia } from "@/app/actions/orthodontics/modulo/cargarAlertas";
import { isFailure } from "@/app/actions/orthodontics/result";
import { useRouter } from "next/navigation";
import { DIAS_DE_POSPOSICION } from "@/lib/orthodontics/alertas-pospuestas";
import { fechaEnZona } from "./fechas";
import { Pantalla, Tarjeta, type Tono } from "./piezas";
import s from "./modulo.module.css";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

const CLASE_TONO: Record<Tono, string> = {
  violeta: "",
  exito: s.tonoExito,
  alerta: s.tonoAlerta,
  peligro: s.tonoPeligro,
  neutro: s.tonoNeutro,
};

export function VistaAlertas({
  alerts: alertsDelServidor,
  zonaHoraria,
  puedeAgendar = false,
  puedePosponer = false,
  puedeEditarCasos = false,
}: {
  alerts: OrthoAlertsData;
  /** Permiso `agenda.create`, decidido en el servidor: sin él no sale «Agendar control». */
  puedeAgendar?: boolean;
  /** Permiso `medicalRecord.view` (el que pide `posponerAlerta`): sin él no sale «Posponer 7 días». */
  puedePosponer?: boolean;
  /** Permiso `medicalRecord.edit`: sin él no salen los accesos directos «Completar diagnóstico / plan». */
  puedeEditarCasos?: boolean;
  /** `clinic.timezone`: el día de una falta se pinta en la zona de la clínica, no en la del servidor. */
  zonaHoraria: string | null;
}) {
  // Las alertas viven en el estado: tras posponer o deshacer se piden de nuevo y la pantalla se repinta al instante
  // (antes dependía de que `router.refresh()` trajera la página y el caso no volvía a su sección hasta recargar).
  const router = useRouter();
  const [alerts, setAlerts] = useState<OrthoAlertsData>(alertsDelServidor);
  const refrescar = useCallback(async () => {
    const r = await cargarAlertasDeOrtodoncia();
    if (isFailure(r)) router.refresh(); // sin permiso para leerlas de nuevo o base caída: como antes
    else setAlerts(r.data);
  }, [router]);
  const fmtDate = (d: Date | string | null) => fechaEnZona(d, zonaHoraria);
  const fotos: FotosPorRevisarEntry[] = alerts.patientPhotos ?? [];
  const reevaluaciones: ReevaluacionRadiograficaEntry[] = alerts.reevaluacionRadiografica ?? [];
  const incompletos = alerts.incompletos ?? [];
  const totalAlerts =
    fotos.length +
    incompletos.length +
    reevaluaciones.length +
    alerts.overduePayments.length +
    alerts.missingNextControl.length +
    alerts.noShows.length +
    alerts.finishingSoon.length +
    alerts.pastDue.length;
  const pospuestas = alerts.pospuestas ?? 0;

  const resumen: { id: string; etiqueta: string; cuenta: number; icono: LucideIcon; tono: Tono }[] = [
    { id: "mensualidad-vencida", etiqueta: "Mensualidad vencida", cuenta: alerts.overduePayments.length, icono: AlertTriangle, tono: "peligro" },
    { id: "falta-de-control", etiqueta: "Sin próximo control", cuenta: alerts.missingNextControl.length, icono: Clock, tono: "alerta" },
    { id: "no-se-presento", etiqueta: "No asistió", cuenta: alerts.noShows.length, icono: UserX, tono: "alerta" },
    { id: "proximo-a-terminar", etiqueta: "Próximo a terminar", cuenta: alerts.finishingSoon.length, icono: Hourglass, tono: "violeta" },
    { id: "pasado-de-fecha", etiqueta: "Pasado de su fecha", cuenta: alerts.pastDue.length, icono: CalendarX, tono: "peligro" },
    { id: "casos-incompletos", etiqueta: "Diagnóstico o plan incompleto", cuenta: incompletos.length, icono: ClipboardCheck, tono: "alerta" },
    { id: "reevaluacion-radiografica", etiqueta: "Reevaluación radiográfica", cuenta: reevaluaciones.length, icono: ScanLine, tono: "alerta" },
    { id: "fotos-del-paciente", etiqueta: "Fotos por revisar", cuenta: fotos.length, icono: Camera, tono: "violeta" },
  ];

  return (
    <RefrescarAlertasContext.Provider value={refrescar}>
    <Pantalla
      titulo="Alertas"
      sub={
        (totalAlerts === 0
          ? "Sin alertas pendientes."
          : `${totalAlerts} caso${totalAlerts === 1 ? "" : "s"} que revisar.`) +
        (pospuestas > 0
          ? ` ${pospuestas} pospuesta${pospuestas === 1 ? "" : "s"}: vuelve${pospuestas === 1 ? "" : "n"} sola${pospuestas === 1 ? "" : "s"} a los ${DIAS_DE_POSPOSICION} días.`
          : "")
      }
    >
      <ListaDePospuestas pospuestas={alerts.pospuestasLista ?? []} />

      <nav className={s.resumen} aria-label="Alertas por tipo">
        {resumen.map((r) => (
          <a
            key={r.id}
            href={`#${r.id}`}
            className={r.cuenta === 0 ? `${s.resumenItem} ${s.resumenItemVacio}` : s.resumenItem}
          >
            <span className={`${s.tarjetaIcono} ${r.cuenta === 0 ? s.tonoNeutro : CLASE_TONO[r.tono]}`} aria-hidden>
              <r.icono size={15} strokeWidth={1.9} />
            </span>
            <span className={s.resumenTextos}>
              <span className={s.resumenValor}>{r.cuenta}</span>
              <span className={s.resumenEtiqueta}>{r.etiqueta}</span>
            </span>
          </a>
        ))}
      </nav>

      <AlertSection
        id="mensualidad-vencida"
        icon={AlertTriangle}
        tono="peligro"
        title="Mensualidad vencida"
        sub="Casos con al menos una mensualidad sin cobrar después de su fecha."
        empty="Sin mensualidades vencidas."
      >
        {alerts.overduePayments.map((p: OverduePatientEntry) => (
          <PatientRow
            // Una fila por CASO, no por paciente: dos casos del mismo paciente
            // con deuda compartirían clave y el estado del botón se cruzaría.
            key={p.treatmentPlanId}
            patientId={p.patientId}
            patientName={p.patientName}
            detalle={`Vencida desde el ${fmtDate(p.oldestDueDate)}`}
          >
            <span className={`${s.importe} ${s.importePeligro}`}>{fmtMoney(p.amountMxn)}</span>
            <EnviarRecordatorioButton patientId={p.patientId} treatmentPlanId={p.treatmentPlanId} />
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection
        id="falta-de-control"
        icon={Clock}
        tono="alerta"
        title="Sin próximo control"
        sub="Casos activos que no tienen ningún control agendado."
        empty="Todos los casos activos tienen su próximo control agendado."
      >
        {alerts.missingNextControl.map((p: MissingNextControlEntry) => (
          <PatientRow
            key={p.patientId}
            patientId={p.patientId}
            patientName={p.patientName}
            detalle="Sin cita de control agendada"
          >
            {puedeAgendar && <AgendarControlBoton patientId={p.patientId} patientName={p.patientName} />}
            {puedePosponer && <PosponerAlertaBoton patientId={p.patientId} patientName={p.patientName} tipo="sin-proximo-control" />}
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection
        id="no-se-presento"
        icon={UserX}
        tono="alerta"
        title="No asistió a su control"
        sub="Faltas de los últimos 30 días."
        empty="Sin faltas en los últimos 30 días."
      >
        {alerts.noShows.map((n: NoShowEntry, i) => (
          <PatientRow
            key={`${n.patientId}-${i}`}
            patientId={n.patientId}
            patientName={n.patientName}
            detalle={`Faltó el ${fmtDate(n.scheduledAt)}`}
          >
            {puedeAgendar && <AgendarControlBoton patientId={n.patientId} patientName={n.patientName} />}
            {puedePosponer && <PosponerAlertaBoton patientId={n.patientId} patientName={n.patientName} tipo="no-asistio" />}
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection
        id="proximo-a-terminar"
        icon={Hourglass}
        tono="violeta"
        title="Caso próximo a terminar"
        sub="Para ir preparando el retiro y la retención."
        empty="Ningún caso por terminar en el corto plazo."
      >
        {alerts.finishingSoon.map((e: DurationAlertEntry) => (
          <PatientRow
            key={e.patientId}
            patientId={e.patientId}
            patientName={e.patientName}
            detalle={`Mes ${e.monthInTreatment} de ${e.estimatedDurationMonths}`}
          >
            {puedePosponer && <PosponerAlertaBoton patientId={e.patientId} patientName={e.patientName} tipo="proximo-a-terminar" />}
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection
        id="pasado-de-fecha"
        icon={CalendarX}
        tono="peligro"
        title="Caso pasado de su fecha"
        sub="Casos que ya rebasaron la duración estimada."
        empty="Ningún caso rebasó su duración estimada."
      >
        {alerts.pastDue.map((e: DurationAlertEntry) => (
          <PatientRow
            key={e.patientId}
            patientId={e.patientId}
            patientName={e.patientName}
            detalle={`${Math.abs(e.remainingMonths)} mes${Math.abs(e.remainingMonths) === 1 ? "" : "es"} de retraso`}
            detallePeligro
          >
            {puedePosponer && <PosponerAlertaBoton patientId={e.patientId} patientName={e.patientName} tipo="pasado-de-fecha" />}
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection
        id="casos-incompletos"
        icon={ClipboardCheck}
        tono="alerta"
        title="Casos con diagnóstico o plan incompleto"
        sub="Sobre todo los migrados de Dentalink, que entran casi vacíos. Cada uno lleva al paso que falta."
        empty="Todos los casos activos tienen su diagnóstico y su plan completos."
      >
        {incompletos.map((c) => (
          <FilaDeCasoIncompleto key={c.planId} caso={c} puedeEditar={puedeEditarCasos} />
        ))}
      </AlertSection>

      <AlertSection
        id="reevaluacion-radiografica"
        icon={ScanLine}
        tono="alerta"
        title="Reevaluación radiográfica"
        sub="Toca la fecha de reevaluación del plan de tratamiento, o pasó la periodicidad desde la última radiografía de ese tipo (o desde el inicio del caso)."
        empty="Ningún caso necesita reevaluación radiográfica."
      >
        {reevaluaciones.map((r: ReevaluacionRadiograficaEntry) => (
          <PatientRow
            // Una fila por CASO, no por paciente.
            key={r.treatmentPlanId}
            patientId={r.patientId}
            patientName={r.patientName}
            detalle={r.textos.join(" · ")}
          >
            {puedePosponer && <PosponerAlertaBoton patientId={r.patientId} patientName={r.patientName} tipo="reevaluacion-radiografica" />}
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection
        id="fotos-del-paciente"
        icon={Camera}
        tono="violeta"
        title="Fotos del paciente por revisar"
        sub="Las mandó el paciente desde su portal. Se revisan en la pestaña Ortodoncia de su ficha, en «Alineadores y cumplimiento»."
        empty="Sin fotos del paciente por revisar."
      >
        {fotos.map((f: FotosPorRevisarEntry) => {
          const nota = notaCorta(f.nota);
          return (
            <PatientRow
              // Una fila por CASO: es donde se revisan.
              key={f.treatmentPlanId}
              patientId={f.patientId}
              patientName={f.patientName}
              detalle={`${resumenDeFotos(f.pendientes)} · desde el ${fmtDate(f.primeraAt)}${nota ? ` · «${nota}»` : ""}`}
            />
          );
        })}
      </AlertSection>
    </Pantalla>
    </RefrescarAlertasContext.Provider>
  );
}

function AlertSection({
  id,
  icon,
  tono,
  title,
  sub,
  empty,
  children,
}: {
  id: string;
  icon: LucideIcon;
  tono: Tono;
  title: string;
  sub: string;
  empty: string;
  children: ReactNode[];
}) {
  const hasItems = children.length > 0;
  return (
    <Tarjeta
      id={id}
      icono={icon}
      tono={hasItems ? tono : "neutro"}
      titulo={title}
      sub={hasItems ? sub : undefined}
      accion={
        hasItems ? (
          <span
            className={`${s.contador} ${tono === "peligro" ? s.contadorPeligro : tono === "alerta" ? s.contadorAlerta : ""}`}
          >
            {children.length}
            <span className={s.soloLector}> caso{children.length === 1 ? "" : "s"}</span>
          </span>
        ) : undefined
      }
    >
      {hasItems ? (
        <ul className={s.tarjetaLista}>{children}</ul>
      ) : (
        <p className={s.enOrden}>
          <CheckCircle2 size={15} strokeWidth={1.9} aria-hidden />
          {empty}
        </p>
      )}
    </Tarjeta>
  );
}

function PatientRow({
  patientId,
  patientName,
  detalle,
  detallePeligro,
  children,
}: {
  patientId: string;
  patientName: string;
  detalle: string;
  detallePeligro?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={`${s.fila} ${s.filaApilable}`}>
      <div className={s.filaCuerpo}>
        <Link
          href={`/dashboard/patients/${patientId}?tab=ortodoncia`}
          className={`${s.nombre} ${s.nombreEstirado}`}
        >
          {patientName}
        </Link>
        <div className={detallePeligro ? `${s.detalle} ${s.detallePeligro}` : s.detalle}>{detalle}</div>
      </div>
      {/* `children` puede llegar como `false` (sin permiso), o como varios
          `false`: ahí no se pinta la caja. */}
      {Children.toArray(children).length > 0 ? <div className={s.filaDerecha}>{children}</div> : null}
    </li>
  );
}
