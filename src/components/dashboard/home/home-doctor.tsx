// src/components/dashboard/home/home-doctor.tsx
"use client";
import { useRouter } from "next/navigation";
import { ChevronRight, FileText, Camera, FileSignature } from "lucide-react";
import { HomeSection } from "./home-section";
import styles from "./home.module.css";
import { Greeting } from "./parts/greeting";
import { HeroNextPatient } from "./parts/hero-next-patient";
import { TodayAppointmentRow } from "./parts/today-appointment-row";
import { TaskRow } from "./parts/task-row";
import { RecentPatientsCarousel } from "./parts/recent-patients-carousel";
import { HomeShortcutBar } from "./parts/home-shortcut-bar";
import { HomeQuickActions } from "./parts/home-quick-actions";
import { EmptyAppointmentsToday } from "@/components/dashboard/empty-states";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";
import type { HomeDoctorData } from "@/lib/home/types";
import { OrtodonciaEnHoy } from "./ortodoncia-en-hoy";

interface Props {
  user: { displayName: string };
  clinic: { name: string; timezone?: string | null };
  data: HomeDoctorData;
}

export function HomeDoctor({ user, clinic, data }: Props) {
  const t = useT();
  const router = useRouter();
  const totalToday = data.todayAppointments.length;
  const { draftNotes, unanalyzedXrays, unsignedConsents } = data.pendingTasks;
  const noTasks = draftNotes + unanalyzedXrays + unsignedConsents === 0;

  const trailing =
    totalToday > 0
      ? `${t("home.doctor.patientsToday", { count: totalToday })} · ${t(
          "home.doctor.completedCount",
          { count: data.completedToday }
        )}`
      : t("home.doctor.noAppointmentsToday");

  const restOfDay = data.nextAppointment
    ? data.todayAppointments.filter((a) => a.id !== data.nextAppointment!.id)
    : data.todayAppointments;

  return (
    <>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 24,
      }}>
        <Greeting userFullName={user.displayName} trailing={trailing} clinicTimezone={clinic.timezone} />
        <HomeQuickActions />
      </div>

      {/* ws1-t5 — los controles de ortodoncia de hoy de este doctor. Se calla
          solo si no hay ninguno o si la sede no tiene el módulo. */}
      <OrtodonciaEnHoy soloControles />

      {data.nextAppointment && <HeroNextPatient appt={data.nextAppointment} timeZone={clinic.timezone} />}

      {/* Dos columnas iguales; colapsa por ancho de CONTENEDOR, no de
          viewport (ver home.module.css). */}
      <div className={`${styles.gridEven} mf-home-doctor-grid`}>
        <HomeSection
          title={t("home.doctor.restOfDayTitle")}
          subtitle={
            restOfDay.length === 0
              ? data.nextAppointment
                ? t("home.doctor.noMoreAppointments")
                : t("home.doctor.noAppointments")
              : t("home.doctor.appointmentsCount", { count: restOfDay.length })
          }
          action={
            <ButtonNew
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard/appointments")}
            >
              {t("home.doctor.viewAgenda")}
              <ChevronRight size={12} />
            </ButtonNew>
          }
          noPad
        >
          {restOfDay.length === 0 ? (
            !data.nextAppointment && <EmptyAppointmentsToday size="md" />
          ) : (
            <div>
              {restOfDay.map((appt) => (
                <TodayAppointmentRow key={appt.id} appt={appt} compact timeZone={clinic.timezone} />
              ))}
            </div>
          )}
        </HomeSection>

        <HomeSection
          title={t("home.doctor.pendingTasksTitle")}
          subtitle={
            noTasks
              ? t("home.recep.actionEmpty")
              : t("home.doctor.tasksSubtitle")
          }
          noPad
        >
          {noTasks ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              {t("home.doctor.noPendingTasks")}
            </div>
          ) : (
            <div>
              <TaskRow
                icon={FileText}
                label={t("home.doctor.draftSoapNotes", { count: draftNotes })}
                count={draftNotes}
                href="/dashboard/patients"
                ctaLabel={t("home.doctor.complete")}
                tone="brand"
              />
              <TaskRow
                icon={Camera}
                label={t("home.doctor.unanalyzedXrays", { count: unanalyzedXrays })}
                count={unanalyzedXrays}
                href="/dashboard/xrays?filter=unanalyzed"
                ctaLabel={t("home.doctor.analyzeWithAi")}
                tone="brand"
              />
              <TaskRow
                icon={FileSignature}
                label={t("home.doctor.unsignedConsents", { count: unsignedConsents })}
                count={unsignedConsents}
                href="/dashboard/patients"
                ctaLabel={t("home.doctor.sendDigitalSignature")}
                tone="warning"
              />
            </div>
          )}
        </HomeSection>
      </div>

      {data.recentPatients.length > 0 && (
        <HomeSection
          title={t("home.doctor.recentPatientsTitle")}
          subtitle={t("home.doctor.recentPatientsSubtitle")}
        >
          <RecentPatientsCarousel patients={data.recentPatients} />
        </HomeSection>
      )}

      <HomeShortcutBar />
    </>
  );
}
