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
import { HomeQuickActions } from "./parts/home-quick-actions";
import {
  EmptyAppointmentsToday,
  EmptyActionItemsAllClear,
} from "@/components/dashboard/empty-states";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { ChevronRight, Clock } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type { HomeReceptionistData } from "@/lib/home/types";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeReceptionistData;
}

export function HomeReceptionist({ user, data }: Props) {
  const t = useT();
  const router = useRouter();
  const waiting = data.checkedInPatients.length;

  const handleCheckIn = async (id: string) => {
    try {
      await fetch(`/api/dashboard/appointments/${id}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      toast.success(t("home.recep.checkInOk"));
      router.refresh();
    } catch {
      toast.error(t("home.recep.checkInError"));
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
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 24,
      }}>
        <Greeting
          userFullName={user.displayName}
          trailing={
            waiting > 0
              ? t("home.recep.patientsWaiting", { count: waiting })
              : undefined
          }
        />
        <HomeQuickActions />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
        className="mf-home-receptionist-grid"
      >
        <HomeSection
          title={t("home.recep.todayTitle")}
          subtitle={
            data.todayAppointments.length === 0
              ? t("home.recep.todayEmpty")
              : t("home.recep.todayCount", { count: data.todayAppointments.length })
          }
          action={
            <ButtonNew
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard/appointments")}
            >
              {t("home.recep.viewFullAgenda")}
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
          title={t("home.recep.actionTitle")}
          subtitle={
            data.actionItems.length === 0
              ? t("home.recep.actionEmpty")
              : t("home.recep.actionCount", { count: data.actionItems.length })
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
                padding: "12px 16px",
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
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--brand)",
                  marginBottom: 6,
                }}
              >
                <Clock size={11} aria-hidden />
                {t("home.recep.waitingRoom")}
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
                      color: "var(--text-3)",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 12,
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
