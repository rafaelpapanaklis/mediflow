export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { getServerT } from "@/i18n/server";
import Link from "next/link";
import { ArrowRight, Plus, Video } from "lucide-react";
import styles from "./teleconsulta.module.css";

export default async function TeleconsultaPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  const tz = user.clinic.timezone;
  const appointments = await prisma.appointment.findMany({
    where: { clinicId: user.clinicId, mode: "TELECONSULTATION" },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startsAt: "desc" },
    take: 50,
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <span className={styles.titleIcon}><Video size={20} strokeWidth={1.75} aria-hidden /></span>
            {t("pages.teleconsulta.title")}
          </h1>
          <p className={styles.subtitle}>{t("pages.teleconsulta.registeredCount", { count: appointments.length })}</p>
        </div>
        <Link href="/dashboard/appointments?new=1" className={styles.newBtn}>
          <Plus size={16} strokeWidth={1.75} aria-hidden /> {t("pages.teleconsulta.newTeleconsultation")}
        </Link>
      </div>

      <div className={styles.card}>
        <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {[t("pages.teleconsulta.colPatient"),t("pages.teleconsulta.colDoctor"),t("common.date"),t("pages.teleconsulta.colTime"),t("pages.teleconsulta.colPayment"),t("common.status"),""].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {appointments.length === 0 ? (
              <tr><td colSpan={7} className={styles.empty}>
                <div className={styles.emptyIcon}><Video size={20} strokeWidth={1.75} aria-hidden /></div>
                <div className={styles.emptyTitle}>{t("pages.teleconsulta.emptyTitle")}</div>
                <div className={styles.emptyHint}>{t("pages.teleconsulta.emptyHint")}</div>
              </td></tr>
            ) : appointments.map(a => (
              <tr key={a.id}>
                <td className={styles.cellStrong}>{a.patient.firstName} {a.patient.lastName}</td>
                <td className={styles.cellMuted}>{t("pages.teleconsulta.doctorPrefix")} {a.doctor.firstName} {a.doctor.lastName}</td>
                <td className={styles.cellMuted}>{new Intl.DateTimeFormat("es-MX", { timeZone: tz, day: "numeric", month: "short" }).format(a.startsAt)}</td>
                <td className={styles.cellTime}>{timeHHMMInTz(a.startsAt, tz)}</td>
                <td>
                  <span className={`${styles.pill} ${a.paymentStatus === "paid" ? styles.pillPaid : styles.pillPending}`}>
                    {a.paymentStatus === "paid" ? t("pages.teleconsulta.paid") : t("pages.teleconsulta.pending")}
                  </span>
                </td>
                <td>
                  <span className={`${styles.pill} ${a.status === "COMPLETED" ? styles.pillDone : styles.pillActive}`}>
                    {a.status === "COMPLETED" ? t("pages.teleconsulta.completed") : a.status}
                  </span>
                </td>
                <td>
                  {a.paymentStatus === "paid" && a.status !== "COMPLETED" && (
                    <Link href={`/teleconsulta/${a.id}?role=doctor`} target="_blank" className={styles.joinLink}>
                      {t("pages.teleconsulta.join")} <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
