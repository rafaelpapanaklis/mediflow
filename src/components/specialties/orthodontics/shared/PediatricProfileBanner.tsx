"use client";
// Orthodontics — banner que sugiere/lee PediatricProfile cuando el paciente
// es menor. SPEC §1.5 + §7.2.

import { Baby } from "lucide-react";
import Link from "next/link";

export interface PediatricProfileBannerProps {
  patientId: string;
  hasProfile: boolean;
  /** Si Pediatría está activa en la clínica. Si no: solo muestra banner de captura inline. */
  pediatricsModuleActive: boolean;
  patientFirstName: string;
  guardianName?: string | null;
  habits?: readonly string[];
}

export function PediatricProfileBanner(props: PediatricProfileBannerProps) {
  if (!props.pediatricsModuleActive) {
    return (
      <div
        role="status"
        style={{
          padding: "10px 14px",
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.40)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--text-1)",
        }}
      >
        <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Baby size={14} aria-hidden /> Paciente menor
        </strong>
        Esta clínica no tiene módulo de Pediatría activo. Captura los datos
        mínimos requeridos directamente en el wizard de diagnóstico
        (consentimiento del tutor + asentimiento ≥12 años + hábitos).
      </div>
    );
  }

  if (props.hasProfile) {
    return (
      <div
        role="status"
        style={{
          padding: "10px 14px",
          background: "rgba(139,92,246,0.10)",
          border: "1px solid rgba(139,92,246,0.40)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--text-1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 6, color: "#8B5CF6" }}>
            <Baby size={14} aria-hidden /> Perfil pediátrico activo
          </strong>
          <Link
            href={`/dashboard/specialties/pediatrics/${props.patientId}`}
            style={{ fontSize: 11, color: "#8B5CF6", textDecoration: "underline" }}
          >
            Ver Pediatría →
          </Link>
        </div>
        <p style={{ margin: "4px 0 0", color: "var(--text-2)", fontSize: 11 }}>
          Tutor: {props.guardianName ?? "—"}.
          {props.habits && props.habits.length > 0
            ? ` Hábitos heredados: ${props.habits.join(", ")}.`
            : " Sin hábitos registrados."}
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        padding: "10px 14px",
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--text-1)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span>
          <Baby size={14} aria-hidden style={{ verticalAlign: -2 }} />{" "}
          {props.patientFirstName} es menor y aún no tiene perfil pediátrico.
        </span>
        <Link
          href={`/dashboard/specialties/pediatrics/${props.patientId}`}
          style={{ fontSize: 11, color: "var(--brand, #6366f1)", textDecoration: "underline" }}
        >
          Crear perfil pediátrico
        </Link>
      </div>
    </div>
  );
}
