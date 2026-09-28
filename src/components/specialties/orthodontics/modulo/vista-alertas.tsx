// Módulo de Ortodoncia — la vista de Alertas (ws1-t3). Solo pinta lo que
// recibe: las alertas las carga la página (`alertas/page.tsx`) con
// `alerts-data.ts`, igual que antes. Arriba, un resumen con el conteo de cada
// tipo que salta a su sección; debajo, las cinco secciones en el orden de
// siempre. Una sección sin casos se queda en una línea.
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarX,
  CheckCircle2,
  Clock,
  Hourglass,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type {
  DurationAlertEntry,
  MissingNextControlEntry,
  OverduePatientEntry,
} from "@/lib/orthodontics/specialty-kpis";
import type { NoShowEntry, OrthoAlertsData } from "@/lib/orthodontics/alerts-data";
import { EnviarRecordatorioButton } from "@/components/specialties/orthodontics/EnviarRecordatorioButton";
import { Pantalla, Tarjeta, type Tono } from "./piezas";
import s from "./modulo.module.css";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

const CLASE_TONO: Record<Tono, string> = {
  violeta: "",
  exito: s.tonoExito,
  alerta: s.tonoAlerta,
  peligro: s.tonoPeligro,
  neutro: s.tonoNeutro,
};

export function VistaAlertas({ alerts }: { alerts: OrthoAlertsData }) {
  const totalAlerts =
    alerts.overduePayments.length +
    alerts.missingNextControl.length +
    alerts.noShows.length +
    alerts.finishingSoon.length +
    alerts.pastDue.length;

  const resumen: { id: string; etiqueta: string; cuenta: number; icono: LucideIcon; tono: Tono }[] = [
    { id: "mensualidad-vencida", etiqueta: "Mensualidad vencida", cuenta: alerts.overduePayments.length, icono: AlertTriangle, tono: "peligro" },
    { id: "falta-de-control", etiqueta: "Falta de control", cuenta: alerts.missingNextControl.length, icono: Clock, tono: "alerta" },
    { id: "no-se-presento", etiqueta: "No se presentó", cuenta: alerts.noShows.length, icono: UserX, tono: "alerta" },
    { id: "proximo-a-terminar", etiqueta: "Próximo a terminar", cuenta: alerts.finishingSoon.length, icono: Hourglass, tono: "violeta" },
    { id: "pasado-de-fecha", etiqueta: "Pasado de su fecha", cuenta: alerts.pastDue.length, icono: CalendarX, tono: "peligro" },
  ];

  return (
    <Pantalla
      titulo="Alertas"
      sub={
        totalAlerts === 0
          ? "Sin alertas pendientes."
          : `${totalAlerts} caso${totalAlerts === 1 ? "" : "s"} que revisar.`
      }
    >
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
        title="Falta de control"
        sub="Casos activos sin su próximo control en la agenda."
        empty="Todos los casos activos tienen su próximo control agendado."
      >
        {alerts.missingNextControl.map((p: MissingNextControlEntry) => (
          <PatientRow
            key={p.patientId}
            patientId={p.patientId}
            patientName={p.patientName}
            detalle="Sin cita de control agendada"
          />
        ))}
      </AlertSection>

      <AlertSection
        id="no-se-presento"
        icon={UserX}
        tono="alerta"
        title="No se presentó a su control"
        sub="Faltas de los últimos 30 días."
        empty="Sin faltas en los últimos 30 días."
      >
        {alerts.noShows.map((n: NoShowEntry, i) => (
          <PatientRow
            key={`${n.patientId}-${i}`}
            patientId={n.patientId}
            patientName={n.patientName}
            detalle={`Faltó el ${fmtDate(n.scheduledAt)}`}
          />
        ))}
      </AlertSection>

      <AlertSection
        id="proximo-a-terminar"
        icon={Hourglass}
        tono="violeta"
        title="Tratamiento próximo a terminar"
        sub="Para ir preparando el retiro y la retención."
        empty="Sin tratamientos por terminar en el corto plazo."
      >
        {alerts.finishingSoon.map((e: DurationAlertEntry) => (
          <PatientRow
            key={e.patientId}
            patientId={e.patientId}
            patientName={e.patientName}
            detalle={`Mes ${e.monthInTreatment} de ${e.estimatedDurationMonths}`}
          />
        ))}
      </AlertSection>

      <AlertSection
        id="pasado-de-fecha"
        icon={CalendarX}
        tono="peligro"
        title="Tratamiento pasado de su fecha"
        sub="Casos que ya rebasaron la duración estimada."
        empty="Ningún tratamiento rebasó su duración estimada."
      >
        {alerts.pastDue.map((e: DurationAlertEntry) => (
          <PatientRow
            key={e.patientId}
            patientId={e.patientId}
            patientName={e.patientName}
            detalle={`${Math.abs(e.remainingMonths)} mes${Math.abs(e.remainingMonths) === 1 ? "" : "es"} de retraso`}
            detallePeligro
          />
        ))}
      </AlertSection>
    </Pantalla>
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
      {children && <div className={s.filaDerecha}>{children}</div>}
    </li>
  );
}
