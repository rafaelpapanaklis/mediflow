// src/components/dashboard/home/home-doctor.tsx
"use client";
import { useRouter } from "next/navigation";
import { ChevronRight, FileText, Camera, FileSignature } from "lucide-react";
import { HomeSection } from "./home-section";
import { Greeting } from "./parts/greeting";
import { HeroNextPatient } from "./parts/hero-next-patient";
import { TodayAppointmentRow } from "./parts/today-appointment-row";
import { TaskRow } from "./parts/task-row";
import { RecentPatientsCarousel } from "./parts/recent-patients-carousel";
import { HomeShortcutBar } from "./parts/home-shortcut-bar";
import { EmptyAppointmentsToday } from "@/components/dashboard/empty-states";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import type { HomeDoctorData } from "@/lib/home/types";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeDoctorData;
}

export function HomeDoctor({ user, data }: Props) {
  const router = useRouter();
  const totalToday = data.todayAppointments.length;
  const { draftNotes, unanalyzedXrays, unsignedConsents } = data.pendingTasks;
  const noTasks = draftNotes + unanalyzedXrays + unsignedConsents === 0;

  const trailing =
    totalToday > 0
      ? `${totalToday} paciente${totalToday === 1 ? "" : "s"} hoy · ${
          data.completedToday
        } completado${data.completedToday === 1 ? "" : "s"}`
      : "Sin citas hoy";

  const restOfDay = data.nextAppointment
    ? data.todayAppointments.filter((a) => a.id !== data.nextAppointment!.id)
    : data.todayAppointments;

  return (
    <>
      <Greeting userFullName={`Dr. ${user.displayName}`} trailing={trailing} />

      {data.nextAppointment && <HeroNextPatient appt={data.nextAppointment} />}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 18,
          marginBottom: 18,
        }}
        className="mf-home-doctor-grid"
      >
        <HomeSection
          title="Resto del día"
          subtitle={
            restOfDay.length === 0
              ? data.nextAppointment
                ? "No hay más citas después de esta"
                : "Sin citas"
              : `${restOfDay.length} cita${restOfDay.length === 1 ? "" : "s"}`
          }
          action={
            <ButtonNew
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard/appointments")}
            >
              Ver agenda
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
                <TodayAppointmentRow key={appt.id} appt={appt} compact />
              ))}
            </div>
          )}
        </HomeSection>

        <HomeSection
          title="Tareas pendientes"
          subtitle={
            noTasks
              ? "Todo al día"
              : "Acciones que puedes cerrar en minutos"
          }
          noPad
        >
          {noTasks ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--text-2)",
                fontSize: 13,
              }}
            >
              Sin tareas pendientes 🎉
            </div>
          ) : (
            <div>
              <TaskRow
                icon={FileText}
                label={`nota${draftNotes === 1 ? "" : "s"} SOAP en borrador`}
                count={draftNotes}
                href="/dashboard/clinical?filter=draft"
                ctaLabel="Completar"
                tone="brand"
              />
              <TaskRow
                icon={Camera}
                label={`radiografía${unanalyzedXrays === 1 ? "" : "s"} sin analizar`}
                count={unanalyzedXrays}
                href="/dashboard/xrays?filter=unanalyzed"
                ctaLabel="Analizar con IA"
                tone="brand"
              />
              <TaskRow
                icon={FileSignature}
                label={`consentimiento${unsignedConsents === 1 ? "" : "s"} sin firma`}
                count={unsignedConsents}
                href="/dashboard/clinical?filter=unsigned"
                ctaLabel="Enviar firma digital"
                tone="warning"
              />
            </div>
          )}
        </HomeSection>
      </div>

      {data.recentPatients.length > 0 && (
        <HomeSection
          title="Pacientes recientes"
          subtitle="Últimos expedientes que atendiste"
        >
          <RecentPatientsCarousel patients={data.recentPatients} />
        </HomeSection>
      )}

      <HomeShortcutBar />
    </>
  );
}
