// src/components/dashboard/home/home-receptionist.tsx
"use client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { HomeSection } from "./home-section";
import { Greeting } from "./parts/greeting";
import { TodayAppointmentRow } from "./parts/today-appointment-row";
import { ActionItemRow } from "./parts/action-item-row";
import { WaitlistCard } from "./parts/waitlist-card";
import { HomeShortcutBar } from "./parts/home-shortcut-bar";
import {
  EmptyAppointmentsToday,
  EmptyActionItemsAllClear,
} from "@/components/dashboard/empty-states";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { ChevronRight, Clock } from "lucide-react";
import type { HomeReceptionistData } from "@/lib/home/types";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeReceptionistData;
}

export function HomeReceptionist({ user, data }: Props) {
  const router = useRouter();
  const waiting = data.checkedInPatients.length;

  const handleCheckIn = async (id: string) => {
    try {
      await fetch(`/api/dashboard/appointments/${id}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      toast.success("Paciente registrado en sala");
      router.refresh();
    } catch {
      toast.error("No se pudo registrar el check-in");
    }
  };

  const handleWhatsApp = (id: string) => {
    router.push(`/dashboard/whatsapp?appt=${id}`);
  };

  const handleCall = (id: string) => {
    router.push(`/dashboard/appointments/${id}?action=call`);
  };

  return (
    <>
      <Greeting
        userFullName={user.displayName}
        trailing={
          waiting > 0
            ? `${waiting} paciente${waiting === 1 ? "" : "s"} en sala`
            : undefined
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 18,
          marginBottom: 18,
        }}
        className="mf-home-receptionist-grid"
      >
        <HomeSection
          title="Agenda de hoy"
          subtitle={
            data.todayAppointments.length === 0
              ? "Sin citas programadas"
              : `${data.todayAppointments.length} cita${
                  data.todayAppointments.length === 1 ? "" : "s"
                }`
          }
          action={
            <ButtonNew
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard/appointments")}
            >
              Ver agenda completa
              <ChevronRight size={12} />
            </ButtonNew>
          }
          noPad
        >
          {data.todayAppointments.length === 0 ? (
            <EmptyAppointmentsToday size="md" />
          ) : (
            <div>
              {data.todayAppointments.map((appt, i) => (
                <div
                  key={appt.id}
                  style={{
                    borderBottom:
                      i === data.todayAppointments.length - 1
                        ? "none"
                        : undefined,
                  }}
                >
                  <TodayAppointmentRow
                    appt={appt}
                    onCheckIn={handleCheckIn}
                    onCall={handleCall}
                    onWhatsApp={handleWhatsApp}
                  />
                </div>
              ))}
            </div>
          )}
        </HomeSection>

        <HomeSection
          title="Acción inmediata"
          subtitle={
            data.actionItems.length === 0
              ? "Todo al día"
              : `${data.actionItems.length} pendiente${
                  data.actionItems.length === 1 ? "" : "s"
                }`
          }
          noPad
        >
          {data.actionItems.length === 0 ? (
            <EmptyActionItemsAllClear size="sm" />
          ) : (
            <div>
              {data.actionItems.map((item, i) => (
                <div
                  key={item.id}
                  style={{
                    borderBottom:
                      i === data.actionItems.length - 1 ? "none" : undefined,
                  }}
                >
                  <ActionItemRow item={item} />
                </div>
              ))}
            </div>
          )}

          {data.checkedInPatients.length > 0 && (
            <div
              style={{
                padding: "12px 14px",
                background: "var(--brand-softer)",
                borderTop: "1px solid var(--border-soft)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--trial-accent-calm)",
                  marginBottom: 6,
                }}
              >
                <Clock size={11} aria-hidden />
                En sala de espera
              </div>
              {data.checkedInPatients.map((p) => (
                <div
                  key={p.id}
                  style={{
                    fontSize: 12,
                    color: "var(--text-1)",
                    padding: "4px 0",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{p.patient.name}</span>
                  <span
                    style={{
                      color: "var(--text-2)",
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
                      fontSize: 11,
                    }}
                  >
                    {p.minutesWaiting ?? 0} min
                  </span>
                </div>
              ))}
            </div>
          )}
        </HomeSection>
      </div>

      <WaitlistCard
        items={data.waitlist}
        onAdd={() => router.push("/dashboard/walkin?waitlist=1")}
      />

      <HomeShortcutBar />
    </>
  );
}
