"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import {
  Play,
  CalendarClock,
  CreditCard,
  MoreHorizontal,
  Edit,
  ExternalLink,
  Send,
  UserCheck,
  Printer,
  Calendar,
  Phone,
  Mail,
  AlertTriangle,
  HeartPulse,
  Pill,
  Check,
  History,
  Activity,
  Building2,
  Trash2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ageFromDob } from "@/lib/format";
import { RISK_FLAG_LABELS } from "@/lib/health-questionnaire";
import { construirAlertas, hayRiesgo } from "@/components/dashboard/pacientes-rediseno/alertas";
import { fechaCorta } from "@/components/dashboard/pacientes-rediseno/fechas";
import { ROPA_MENU_FICHA } from "@/components/dashboard/portales-rediseno/ropa";
import { useT } from "@/i18n/i18n-provider";
import styles from "./patient-detail.module.css";

export interface HeroCardProps {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    patientNumber: string;
    gender: string;
    dob: string | null;
    phone: string | null;
    email: string | null;
    bloodType: string | null;
    status: string;
    allergies: string[];
    chronicConditions: string[];
    currentMedications: string[];
  };
  nextAppointment: {
    id: string;
    date: string;
    startTime: string;
    type?: string;
    doctorName?: string;
  } | null;
  lastVisitDate: string | null;
  visitCount: number;
  pendingBalance: number;
  /** Link LEGACY de solo lectura (portalToken). Independiente de la cuenta real. */
  portalUrl: string | null;
  /** Estado del portal con CUENTA REAL: "none" sin cuenta, "invited" invitación
   *  pendiente, "active" ya tiene acceso. Default "none". */
  portalAccountStatus?: "none" | "invited" | "active";
  /** true mientras se envía/reenvía la invitación (deshabilita la acción). */
  invitingPortal?: boolean;
  /** Invita/reenvía al portal con cuenta real (correo para fijar contraseña). */
  onInvitePortal?: () => void;
  /** Genera/copia el link LEGACY de solo lectura (portalToken, POST /api/portal). */
  onGeneratePortal?: () => void;
  onEdit: () => void;
  /** Permiso granular "patients.edit" (P1-3): sin él se oculta "Editar
   *  paciente" del menú; la API lo revalida con 403. */
  canEdit?: boolean;
  onStartConsult: () => void;
  onReschedule: () => void;
  onCharge: () => void;
  /** Abre el modal de eliminar. Solo se llama si `canDelete` es true. */
  onDelete?: () => void;
  /**
   * ¿El usuario tiene el permiso "patients.delete"? Lo resuelve el server
   * component de la ficha (page.tsx) — el cliente NO lo deduce del rol. Si es
   * false, el ítem "Eliminar paciente" ni siquiera se renderiza; el endpoint
   * vuelve a validarlo por su cuenta con 403.
   */
  canDelete?: boolean;
  riskFlags?: string[];
  emergencyContact?: { name?: string | null; phone?: string | null; relation?: string | null } | null;
  /** Sede de origen cuando el paciente viene prestado de otra sucursal (Fase 2). null = paciente propio. */
  originClinicName?: string | null;
  /**
   * ¿Diseño nuevo? (interruptor `menu-dos-niveles` de la clínica). Cambia tres
   * cosas y ninguna más:
   *  · la pintura — la cabecera respira y «Iniciar consulta» manda de verdad;
   *  · los chips de alerta dejan de salir DOS VECES («Alergia a penicilina» +
   *    «Penicilina»), que es el defecto fotografiado;
   *  · de las tres píldoras solo queda «Próxima cita» —ya no como píldora sino
   *    como una línea bajo los datos del paciente—, y solo si HAY próxima
   *    cita: «Última visita» y «Visitas totales» sobraban (lo pidió Rafael), y
   *    sin cita no se pinta ni un hueco ni un «—». Agendar sigue a un clic, en
   *    el botón «Agendar próxima» de al lado, que llama al mismo `onReschedule`.
   * Los tres botones, su orden y el sitio de los chips no se mueven: es lo que
   * la gente encuentra sin leer.
   */
  rediseno?: boolean;
}

function fmtShortDate(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" })
    .format(new Date(iso))
    .replace(/\./g, "");
}

/**
 * La fecha de una cita, en el día que es.
 *
 * `fmtShortDate` recibe un día suelto («2026-09-24») y `new Date()` lo lee
 * como medianoche EN GREENWICH; pintado en la hora de México sale el día
 * anterior. Está fotografiado: la cabecera dice «8 oct» y la línea de tiempo
 * de Historia clínica, «9 oct», de la misma cita y en la misma pantalla.
 *
 * Con el rediseño encendido ese defecto se vería aún peor, porque la tarjeta
 * «Tratamiento activo» del Resumen nuevo SÍ pinta el día correcto y quedaría
 * contradiciendo a la cabecera dos centímetros más arriba. Así que con la
 * bandera se pinta bien; sin ella, exactamente lo de hoy — arreglarlo para
 * todo el mundo toca `formatDate` de `src/lib/utils.ts`, que usa medio panel,
 * y eso es otra tarea.
 */
function fechaCabecera(iso: string, rediseno: boolean): string {
  return rediseno ? fechaCorta(iso) : fmtShortDate(iso);
}

function patientInitials(first: string, last: string): string {
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "?";
}

export function HeroCard({
  patient,
  nextAppointment,
  lastVisitDate,
  visitCount,
  pendingBalance,
  portalUrl,
  portalAccountStatus = "none",
  invitingPortal = false,
  onInvitePortal,
  onGeneratePortal,
  onEdit,
  canEdit = true,
  onStartConsult,
  onReschedule,
  onCharge,
  onDelete,
  canDelete = false,
  riskFlags = [],
  emergencyContact,
  originClinicName = null,
  rediseno = false,
}: HeroCardProps) {
  const t = useT();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const age = ageFromDob(patient.dob);
  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const initials = patientInitials(patient.firstName, patient.lastName);
  const genderShort = patient.gender === "F" ? "F" : patient.gender === "M" ? "M" : "O";

  const hasBalance = pendingBalance > 0;
  const hasNextAppt = nextAppointment !== null;

  // Los chips, SIN repetidos: ver `construirAlertas`. Solo con el rediseño —
  // apagado, la cabecera pinta exactamente las mismas listas de siempre.
  const alertasTodas = rediseno
    ? construirAlertas({
        riskFlags,
        allergies: patient.allergies,
        chronicConditions: patient.chronicConditions,
        currentMedications: patient.currentMedications,
      })
    : [];
  // Las de riesgo (banderas y alergias) se pintan TODAS: son dato de
  // seguridad. Padecimientos y medicación se cortan en seis entre las dos,
  // como la cabecera de siempre cortaba en tres cada una — un paciente con
  // doce crónicas y diez medicamentos metía veintidós chips y se comía la
  // pantalla del teléfono entera.
  const alertas = alertasTodas.filter((c) => c.esRiesgo);
  const noRiesgo = alertasTodas.filter((c) => !c.esRiesgo);
  const noRiesgoVisibles = noRiesgo.slice(0, 6);
  const noRiesgoOcultos = noRiesgo.slice(6);
  const tonoChip: Record<string, string> = {
    peligro: styles.danger,
    alerta: styles.warning,
    violeta: styles.brand,
    exito: styles.success,
  };

  // Fecha, hora, doctor y tipo de la próxima cita. Solo se usa si la hay.
  const citaAgendada = hasNextAppt && (
    <>
      <div className={`${styles.metricValue} ${styles.brand}`}>
        {fechaCabecera(nextAppointment!.date, rediseno)}
      </div>
      {nextAppointment!.startTime && (
        <div className={styles.metricSub}>
          {t("patients.heroCard.timeSuffix", { time: nextAppointment!.startTime })}{nextAppointment!.doctorName ? ` · ${nextAppointment!.doctorName}` : ""}
        </div>
      )}
      {nextAppointment!.type && (
        <div className={styles.metricSub}>{nextAppointment!.type}</div>
      )}
    </>
  );
  // «Próxima cita» con el rediseño: UNA línea de texto, la tercera de la columna
  // del nombre (nombre → datos → cita). Antes era una píldora de cuatro
  // renglones al lado de botones de uno, y no había forma de alinearlos: los
  // botones flotaban a media altura y el icono, centrado contra cuatro
  // renglones, no quedaba junto a ninguno. En línea, el icono va pegado a su
  // rótulo y las tres líneas miden lo que el avatar. Mismos datos, mismo orden.
  const lineaCita = rediseno && hasNextAppt && (
    <div className={styles.heroCita}>
      <span className={styles.heroCitaRotulo}>
        <CalendarClock size={13} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.nextAppointment")}
      </span>
      <span className={styles.heroCitaFecha}>{fechaCabecera(nextAppointment!.date, rediseno)}</span>
      {nextAppointment!.startTime && (
        <>
          <span className={styles.heroMetaSep}>·</span>
          <span className={styles.heroCitaDato}>
            {t("patients.heroCard.timeSuffix", { time: nextAppointment!.startTime })}{nextAppointment!.doctorName ? ` · ${nextAppointment!.doctorName}` : ""}
          </span>
        </>
      )}
      {nextAppointment!.type && (
        <>
          <span className={styles.heroMetaSep}>·</span>
          <span className={styles.heroCitaDato}>{nextAppointment!.type}</span>
        </>
      )}
    </div>
  );

  // Los botones. Una sola definición para los dos caminos: «Iniciar consulta»
  // hace lo mismo con la bandera que sin ella porque ES el mismo botón.
  const acciones = (
    <div className={styles.heroActions}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        onClick={onStartConsult}
        disabled={!hasNextAppt}
        title={hasNextAppt ? t("patients.heroCard.startConsultTitle") : t("patients.heroCard.startConsultDisabledTitle")}
      >
        <Play size={13} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.startConsult")}
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={onReschedule}
        title={hasNextAppt ? t("patients.heroCard.rescheduleTitle") : t("patients.heroCard.scheduleNextTitle")}
      >
        <CalendarClock size={13} strokeWidth={1.75} aria-hidden /> {hasNextAppt ? t("patients.heroCard.rescheduleNext") : t("patients.heroCard.scheduleNext")}
      </button>
      <button
        type="button"
        className={`${styles.btn} ${hasBalance ? styles.btnSuccess : ""}`}
        onClick={onCharge}
        disabled={!hasBalance}
      >
        <CreditCard size={13} strokeWidth={1.75} aria-hidden /> {hasBalance ? t("patients.heroCard.chargeAmount", { amount: formatCurrency(pendingBalance) }) : t("patients.heroCard.charge")}
      </button>

      <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnIcon}`}
            aria-label={t("patients.heroCard.moreActionsAria")}
            title={t("patients.heroCard.moreActions")}
          >
            <MoreHorizontal size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          {/* Sale por un portal, fuera de la ficha: con el rediseño lleva
              los tokens del menú puestos a mano (ROPA_MENU_FICHA), como
              todo lo que el menú pinta en portales. Apagado, la clase de
              siempre y nada más. */}
          <Popover.Content
            align="end"
            sideOffset={6}
            className={rediseno ? `${styles.heroMenuPopover} ${ROPA_MENU_FICHA.caja}` : styles.heroMenuPopover}
          >
            {canEdit && (
              <button
                type="button"
                className={styles.heroMenuItem}
                onClick={() => {
                  setMoreOpen(false);
                  onEdit();
                }}
              >
                <Edit size={12} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.editPatient")}
              </button>
            )}
            {/* Acceso al portal con CUENTA REAL: el paciente define su
                propia contraseña desde un correo (la clínica nunca la ve). */}
            {portalAccountStatus === "active" ? (
              <div
                className={styles.heroMenuItem}
                aria-disabled
                style={{ opacity: 0.65, cursor: "default", pointerEvents: "none" }}
              >
                <UserCheck size={12} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.portalActive")}
              </div>
            ) : (
              <button
                type="button"
                className={styles.heroMenuItem}
                disabled={invitingPortal}
                onClick={() => {
                  setMoreOpen(false);
                  onInvitePortal?.();
                }}
              >
                <Send size={12} strokeWidth={1.75} aria-hidden />{" "}
                {portalAccountStatus === "invited"
                  ? t("patients.heroCard.portalResend")
                  : t("patients.heroCard.portalInvite")}
              </button>
            )}
            {portalAccountStatus === "invited" && (
              <div className={styles.heroMenuHint} {...(rediseno ? { "data-nota": "" } : {})}>{t("patients.heroCard.portalInvitedHint")}</div>
            )}

            {/* Link LEGACY de SOLO LECTURA (portalToken) — opción aparte,
                sin cuenta ni contraseña. */}
            {portalUrl ? (
              <button
                type="button"
                className={styles.heroMenuItem}
                onClick={() => {
                  setMoreOpen(false);
                  navigator.clipboard.writeText(portalUrl);
                }}
              >
                <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.copyReadonlyLink")}
              </button>
            ) : (
              <button
                type="button"
                className={styles.heroMenuItem}
                onClick={() => {
                  setMoreOpen(false);
                  onGeneratePortal?.();
                }}
              >
                <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.generateReadonlyLink")}
              </button>
            )}
            <button
              type="button"
              className={styles.heroMenuItem}
              onClick={() => {
                setMoreOpen(false);
                window.print();
              }}
            >
              <Printer size={12} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.printSummary")}
            </button>
            <button
              type="button"
              className={styles.heroMenuItem}
              onClick={() => {
                setMoreOpen(false);
                router.push(
                  hasNextAppt
                    ? `/dashboard/agenda?highlight=${nextAppointment!.id}`
                    : "/dashboard/agenda",
                );
              }}
            >
              <Calendar size={12} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.viewInAgenda")}
            </button>
            {canDelete && onDelete && (
              <>
                <div className={styles.heroMenuDivider} role="separator" />
                <button
                  type="button"
                  className={`${styles.heroMenuItem} ${styles.heroMenuItemDanger}`}
                  {...(rediseno ? { "data-tono": "peligro" } : {})}
                  onClick={() => {
                    setMoreOpen(false);
                    onDelete();
                  }}
                >
                  <Trash2 size={12} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.deletePatient")}
                </button>
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );

  return (
    <section
      className={[styles.hero, rediseno ? styles.heroRediseno : ""].filter(Boolean).join(" ")}
      aria-label={t("patients.heroCard.summaryAria")}
    >
      <div className={styles.heroMain}>
        <div className={styles.heroAvatarRing} aria-hidden>
          <div className={styles.heroAvatar}>{initials}</div>
        </div>

        <div className={styles.heroInfo}>
          <h1 className={styles.heroName}>{fullName}</h1>
          {originClinicName && (
            <span
              className={`${styles.alertChip} ${styles.brand}`}
              title={t("patients.row.fromBranch", { name: originClinicName })}
              style={{ marginBottom: 6 }}
            >
              <Building2 size={11} strokeWidth={1.75} aria-hidden /> {originClinicName}
            </span>
          )}
          <div className={styles.heroMeta}>
            <span className={styles.mono}>#{patient.patientNumber}</span>
            <span className={styles.heroMetaSep}>·</span>
            {age !== null && (
              <>
                <span className={styles.mono}>{t("patients.heroCard.ageSuffix", { age })}</span>
                <span className={styles.heroMetaSep}>·</span>
              </>
            )}
            <span className={styles.mono}>{genderShort}</span>
            {patient.phone && (
              <>
                <span className={styles.heroMetaSep}>·</span>
                <span className={styles.metaItem}>
                  <Phone size={11} strokeWidth={1.75} aria-hidden /> {patient.phone}
                </span>
              </>
            )}
            {patient.email && (
              <>
                <span className={styles.heroMetaSep}>·</span>
                <span className={styles.metaItem}>
                  <Mail size={11} strokeWidth={1.75} aria-hidden /> {patient.email}
                </span>
              </>
            )}
            {patient.bloodType && (
              <>
                <span className={styles.heroMetaSep}>·</span>
                <span className={styles.mono}>{patient.bloodType}</span>
              </>
            )}
          </div>
          {lineaCita}
        </div>

        {/* Stats como píldoras con icono (pasada estética v3). Con el rediseño
            no van: solo queda «Próxima cita», en línea bajo los datos (`lineaCita`). */}
        {rediseno ? null : (
        <div className={styles.heroMetrics}>
          <div className={styles.metric}>
            <span className={`${styles.metricIcon} ${styles.brand}`}>
              <CalendarClock size={15} strokeWidth={1.75} aria-hidden />
            </span>
            <div className={styles.metricBody}>
              <div className={styles.metricLabel}>{t("patients.heroCard.nextAppointment")}</div>
              {hasNextAppt ? (
                citaAgendada
              ) : (
                <>
                  <div className={styles.metricValue}>—</div>
                  <div className={styles.metricSub}>
                    <button
                      type="button"
                      onClick={onReschedule}
                      className={styles.sideCardLink}
                    >
                      {t("patients.heroCard.schedule")} →
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricIcon}>
              <History size={15} strokeWidth={1.75} aria-hidden />
            </span>
            <div className={styles.metricBody}>
              <div className={styles.metricLabel}>{t("patients.heroCard.lastVisit")}</div>
              <div className={styles.metricValue}>{lastVisitDate ? fechaCabecera(lastVisitDate, rediseno) : "—"}</div>
              <div className={styles.metricSub}>{lastVisitDate ? "" : t("patients.heroCard.noVisits")}</div>
            </div>
          </div>
          <div className={styles.metric}>
            <span className={`${styles.metricIcon} ${styles.success}`}>
              <Activity size={15} strokeWidth={1.75} aria-hidden />
            </span>
            <div className={styles.metricBody}>
              <div className={styles.metricLabel}>{t("patients.heroCard.totalVisits")}</div>
              <div className={styles.metricValue}>{visitCount}</div>
              <div className={styles.metricSub}>{t("patients.heroCard.consultationsLabel", { count: visitCount })}</div>
            </div>
          </div>
        </div>
        )}

        {/* Los botones, los mismos en los dos caminos. Con el rediseño van a la
            derecha del nombre si caben y, si no, bajan a una fila propia. */}
        {acciones}
      </div>

      <div className={styles.heroAlerts} role="group" aria-label={t("patients.heroCard.alertsAria")}>
        {/* ── Rediseño: una sola lista, ya sin repetidos ─────────────── */}
        {rediseno && alertas.concat(noRiesgoVisibles).map((c) => (
          <span key={c.clave} className={`${styles.alertChip} ${tonoChip[c.tono] ?? ""}`}>
            {c.tono === "peligro" ? (
              <AlertTriangle size={11} strokeWidth={1.75} aria-hidden />
            ) : c.tono === "alerta" ? (
              <HeartPulse size={11} strokeWidth={1.75} aria-hidden />
            ) : (
              <Pill size={11} strokeWidth={1.75} aria-hidden />
            )}{" "}
            {c.texto}
          </span>
        ))}
        {rediseno && noRiesgoOcultos.length > 0 && (
          <span className={styles.alertChip} title={noRiesgoOcultos.map((c) => c.texto).join(", ")}>
            {t("patients.heroCard.moreCount", { count: noRiesgoOcultos.length })}
          </span>
        )}
        {/* «Sin alergias conocidas» habla de ALERGIAS, no de todo lo demás:
            un paciente asmático sin ninguna alergia tiene que seguir viendo
            este chip. El chip existe justo para distinguir «se le preguntó y
            no tiene» de «no lo sabemos». */}
        {rediseno && !hayRiesgo(alertas) && (
          <span className={`${styles.alertChip} ${styles.success}`}>
            <Check size={11} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.noAllergies")}
          </span>
        )}

        {/* ── Lo de siempre, intacto ─────────────────────────────────── */}
        {!rediseno && riskFlags.map((f) => (
          <span key={`r-${f}`} className={`${styles.alertChip} ${styles.danger}`}>
            <AlertTriangle size={11} strokeWidth={1.75} aria-hidden /> {RISK_FLAG_LABELS[f] ?? f}
          </span>
        ))}
        {!rediseno && patient.allergies.map((a) => (
          <span key={`a-${a}`} className={`${styles.alertChip} ${styles.danger}`}>
            <AlertTriangle size={11} strokeWidth={1.75} aria-hidden /> {a}
          </span>
        ))}
        {!rediseno && riskFlags.length === 0 && patient.allergies.length === 0 && (
          <span className={`${styles.alertChip} ${styles.success}`}>
            <Check size={11} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.noAllergies")}
          </span>
        )}
        {!rediseno && patient.chronicConditions.slice(0, 3).map((c) => (
          <span key={`c-${c}`} className={`${styles.alertChip} ${styles.warning}`}>
            <HeartPulse size={11} strokeWidth={1.75} aria-hidden /> {c}
          </span>
        ))}
        {!rediseno && patient.chronicConditions.length > 3 && (
          <span
            className={styles.alertChip}
            title={patient.chronicConditions.slice(3).join(", ")}
          >
            {t("patients.heroCard.moreCount", { count: patient.chronicConditions.length - 3 })}
          </span>
        )}
        {!rediseno && patient.currentMedications.slice(0, 3).map((m) => (
          <span key={`m-${m}`} className={`${styles.alertChip} ${styles.brand}`}>
            <Pill size={11} strokeWidth={1.75} aria-hidden /> {m}
          </span>
        ))}
        {!rediseno && patient.currentMedications.length > 3 && (
          <span
            className={styles.alertChip}
            title={patient.currentMedications.slice(3).join(", ")}
          >
            {t("patients.heroCard.moreCount", { count: patient.currentMedications.length - 3 })}
          </span>
        )}
        {emergencyContact && (emergencyContact.name || emergencyContact.phone) && (
          <span className={styles.alertChip} title={emergencyContact.relation ?? undefined}>
            <Phone size={11} strokeWidth={1.75} aria-hidden /> {t("patients.heroCard.emergencyLabel")}: {[emergencyContact.name, emergencyContact.phone].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
    </section>
  );
}
