// src/components/dashboard/home/parts/hero-next-patient.tsx
"use client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Play, FileText, Sparkles, AlertTriangle, Pill } from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { AlergiesPopover } from "@/components/dashboard/alergies-popover";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { formatShortTime, formatTimeUntil } from "@/lib/home/greet";
import type { HomeDoctorData } from "@/lib/home/types";

type NextAppt = NonNullable<HomeDoctorData["nextAppointment"]>;

export function HeroNextPatient({ appt }: { appt: NextAppt }) {
  const router = useRouter();
  const { startConsult, consult } = useActiveConsult();
  const isAlreadyActive = consult?.patientId === appt.patient.id;

  const handleStart = async () => {
    if (isAlreadyActive) {
      toast("Ya hay consulta activa con este paciente", { icon: "ℹ️" });
      return;
    }
    await startConsult(appt.patient.id);
    toast.success("Consulta iniciada");
  };

  const genderAge = [
    appt.patientAge != null ? `${appt.patientAge}a` : null,
    appt.patientGender ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  const firstAllergy = appt.patientAlerts?.allergies?.[0];
  const firstMed = appt.patientAlerts?.medications?.[0];
  const totalAlerts =
    (appt.patientAlerts?.allergies?.length ?? 0) +
    (appt.patientAlerts?.medications?.length ?? 0) +
    (appt.patientAlerts?.conditions?.length ?? 0);

  return (
    <section
      aria-label="Siguiente paciente"
      style={{
        position: "relative",
        background:
          "linear-gradient(135deg, var(--brand-softer), var(--bg-elev) 65%)",
        border: "1px solid var(--border-brand)",
        borderRadius: 14,
        padding: "clamp(18px, 2vw, 26px)",
        marginBottom: 18,
        boxShadow: "0 0 32px rgba(124,58,237,0.08)",
        overflow: "hidden",
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--trial-accent-calm)",
          marginBottom: 10,
        }}
      >
        Tu siguiente paciente · {formatTimeUntil(appt.startsAt)}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <AvatarNew name={appt.patient.name} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            style={{
              fontSize: "clamp(17px, 1.6vw, 22px)",
              fontWeight: 600,
              color: "var(--text-1)",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {appt.patient.name}
          </h2>
          {genderAge && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-2)",
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                marginTop: 4,
              }}
            >
              {genderAge}
            </div>
          )}
          <div
            style={{
              fontSize: 13,
              color: "var(--text-1)",
              marginTop: 8,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontWeight: 500 }}>
              {formatShortTime(appt.startsAt)}
            </strong>{" "}
            ·{" "}
            {appt.reason ?? "Consulta"}
          </div>

          {(firstAllergy || firstMed) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {firstAllergy && (
                <AlergiesPopover
                  alerts={appt.patientAlerts ?? {}}
                  trigger={
                    <button
                      type="button"
                      style={alertChipStyle("danger")}
                      aria-label={`${totalAlerts} alerta${
                        totalAlerts === 1 ? "" : "s"
                      } médica${totalAlerts === 1 ? "" : "s"}`}
                    >
                      <AlertTriangle size={11} aria-hidden />
                      Alergia: {firstAllergy}
                      {totalAlerts > 1 ? ` +${totalAlerts - 1}` : ""}
                    </button>
                  }
                />
              )}
              {firstMed && !firstAllergy && (
                <AlergiesPopover
                  alerts={appt.patientAlerts ?? {}}
                  trigger={
                    <button type="button" style={alertChipStyle("warning")}>
                      <Pill size={11} aria-hidden />
                      {firstMed}
                    </button>
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid var(--border-soft)",
        }}
      >
        <button
          type="button"
          onClick={handleStart}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 36,
            padding: "0 16px",
            borderRadius: 8,
            background: "var(--brand)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow:
              "0 0 0 1px rgba(124,58,237,0.5), 0 4px 16px -4px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#8b5cf6")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--brand)")}
        >
          <Play size={14} />
          {isAlreadyActive ? "Consulta en curso" : "Iniciar consulta"}
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(`/dashboard/patients/${appt.patient.id}`)
          }
          style={secondaryCtaStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-elev-2)";
            e.currentTarget.style.borderColor = "var(--border-brand)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--bg-elev)";
            e.currentTarget.style.borderColor = "var(--border-strong)";
          }}
        >
          <FileText size={14} />
          Ver expediente
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(`/dashboard/ai-assistant?patient=${appt.patient.id}`)
          }
          style={secondaryCtaStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-elev-2)";
            e.currentTarget.style.borderColor = "var(--border-brand)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--bg-elev)";
            e.currentTarget.style.borderColor = "var(--border-strong)";
          }}
        >
          <Sparkles size={14} />
          IA asistir
        </button>
      </div>
    </section>
  );
}

function alertChipStyle(tone: "danger" | "warning"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 22,
    padding: "0 8px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    maxWidth: "clamp(160px, 30vw, 320px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    border: "1px solid",
  };
  if (tone === "danger") {
    return {
      ...base,
      background: "var(--danger-soft-strong)",
      borderColor: "var(--danger-border-strong)",
      color: "var(--danger)",
    };
  }
  return {
    ...base,
    background: "var(--warning-soft-strong)",
    borderColor: "var(--warning-border-strong)",
    color: "var(--warning)",
  };
}

const secondaryCtaStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 36,
  padding: "0 14px",
  borderRadius: 8,
  background: "var(--bg-elev)",
  color: "var(--text-1)",
  fontSize: 13,
  fontWeight: 500,
  border: "1px solid var(--border-strong)",
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 0.15s",
};
