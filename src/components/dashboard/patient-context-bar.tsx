"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Stethoscope,
  FlaskConical,
  Camera,
  CreditCard,
  Sparkles,
  XCircle,
  MoreHorizontal,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { AlergiesPopover } from "./alergies-popover";
import { PatientContextEndModal } from "./patient-context-end-modal";

export function PatientContextBar() {
  const router = useRouter();
  const { consult, elapsedSeconds, loading } = useActiveConsult();
  const [endModalOpen, setEndModalOpen] = useState(false);

  // Early returns DESPUÉS de todos los hooks
  if (loading) return null;
  if (!consult) return null;

  // Cálculos puros (no son hooks, pueden ir después del return)
  const timerText = formatTime(elapsedSeconds);
  const genderAge = [
    consult.patientAge != null ? `${consult.patientAge}a` : null,
    consult.patientGender ?? null,
  ].filter(Boolean).join(" · ");

  const firstAllergy = consult.patientAlerts.allergies?.[0];
  const totalAlerts =
    (consult.patientAlerts.allergies?.length ?? 0) +
    (consult.patientAlerts.medications?.length ?? 0) +
    (consult.patientAlerts.conditions?.length ?? 0);

  const actions = buildActions(router, consult.patientId, () => setEndModalOpen(true));

  return (
    <>
      <div
        role="region"
        aria-label={`Consulta activa con ${consult.patientName}`}
        className="mf-context-bar"
        style={{
          position: "sticky",
          top: 52,
          zIndex: 4,
          background: "var(--consult-active-bg)",
          borderBottom: "1px solid var(--consult-active-border)",
          borderLeft: "3px solid var(--brand)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 clamp(12px, 1.5vw, 24px)",
          fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        }}
      >
        {/* LEFT */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10,
            minWidth: 0, flex: "1 1 auto",
          }}
        >
          <span
            aria-hidden
            className="mf-pulse-dot"
            style={{
              width: 10, height: 10, borderRadius: "50%",
              background: "var(--consult-active-dot)",
              flexShrink: 0,
            }}
          />
          <span
            className="mf-ctx-bar__status"
            style={{
              fontSize: 10, fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--consult-active-accent)",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            En consulta
          </span>
          <span
            aria-hidden
            className="mf-ctx-bar__sep"
            style={{
              width: 1, height: 16,
              background: "var(--border-strong)",
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
            <button
              type="button"
              onClick={() => router.push(`/dashboard/patients/${consult.patientId}`)}
              aria-label={`Ver expediente de ${consult.patientName}`}
              style={{
                background: "transparent", border: "none", padding: 0,
                cursor: "pointer",
                fontSize: 13, fontWeight: 600,
                color: "var(--text-1)",
                fontFamily: "inherit",
                overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "clamp(120px, 25vw, 240px)",
                textAlign: "left",
              }}
            >
              {consult.patientName}
            </button>
            {genderAge && (
              <span
                className="mf-ctx-bar__meta"
                style={{
                  fontSize: 11,
                  color: "var(--text-2)",
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  flexShrink: 0,
                }}
              >
                {genderAge}
              </span>
            )}
          </div>
          {firstAllergy && (
            <div className="mf-ctx-bar__allergy" style={{ flexShrink: 0 }}>
              <AlergiesPopover
                alerts={consult.patientAlerts}
                trigger={
                  <button
                    type="button"
                    aria-label={`${totalAlerts} alerta${totalAlerts === 1 ? "" : "s"} médica${totalAlerts === 1 ? "" : "s"}. Abrir detalles.`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      height: 24, padding: "0 8px", borderRadius: 20,
                      background: "var(--danger-soft-strong)",
                      border: "1px solid var(--danger-border-strong)",
                      color: "var(--danger)",
                      fontSize: 11, fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                      maxWidth: "clamp(140px, 20vw, 260px)",
                      overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    <AlertTriangle size={11} style={{ flexShrink: 0 }} aria-hidden />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Alergia: {firstAllergy}
                      {totalAlerts > 1 ? ` +${totalAlerts - 1}` : ""}
                    </span>
                  </button>
                }
              />
            </div>
          )}
        </div>

        {/* TIMER */}
        <div
          className="mf-ctx-bar__timer"
          aria-live="off"
          aria-label={`Tiempo de consulta: ${timerText}`}
          style={{
            fontFamily: "var(--font-jetbrains-mono, monospace)",
            fontSize: 13, fontWeight: 500,
            color: "var(--text-1)",
            padding: "4px 10px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 6,
            letterSpacing: "0.04em",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {timerText}
        </div>

        {/* ACTIONS DESKTOP */}
        <div
          className="mf-ctx-bar__actions-desktop"
          style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
        >
          {actions.main.map((a) => (
            <ActionButton key={a.id} action={a} />
          ))}
          <div
            aria-hidden
            style={{
              width: 1, height: 20,
              background: "var(--border-strong)",
              margin: "0 6px",
            }}
          />
          <ActionButton action={actions.end} />
        </div>

        {/* ACTIONS MOBILE */}
        <div className="mf-ctx-bar__actions-mobile" style={{ display: "none", flexShrink: 0 }}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Más acciones"
                style={{
                  width: 32, height: 32,
                  display: "grid", placeItems: "center",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid var(--border-soft)",
                  color: "var(--text-1)",
                  cursor: "pointer",
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end" sideOffset={6}
                style={{
                  zIndex: 50, minWidth: 200,
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 10, padding: 4,
                  boxShadow:
                    "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
                  fontFamily: "inherit",
                }}
              >
                {[...actions.main, actions.end].map((a) => (
                  <DropdownMenu.Item
                    key={a.id}
                    onSelect={a.run}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", fontSize: 13,
                      color: a.tone === "danger" ? "var(--danger)" : "var(--text-1)",
                      borderRadius: 6, cursor: "pointer", outline: "none",
                    }}
                  >
                    <a.Icon
                      size={14}
                      style={{
                        color: a.tone === "danger" ? "var(--danger)" : "var(--text-2)",
                      }}
                    />
                    {a.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <PatientContextEndModal open={endModalOpen} onOpenChange={setEndModalOpen} />
    </>
  );
}

// Helpers

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

interface ActionDef {
  id: string;
  label: string;
  ariaLabel: string;
  Icon: LucideIcon;
  tone?: "brand" | "danger";
  run: () => void;
}

function buildActions(
  router: ReturnType<typeof useRouter>,
  patientId: string,
  openEndModal: () => void,
): { main: ActionDef[]; end: ActionDef } {
  const main: ActionDef[] = [
    { id: "soap", label: "Nota SOAP", ariaLabel: "Iniciar nueva nota SOAP",
      Icon: Stethoscope,
      run: () => router.push(`/dashboard/patients/${patientId}?tab=soap&new=1`) },
    { id: "prescribe", label: "Receta", ariaLabel: "Generar receta",
      Icon: FlaskConical,
      run: () => router.push(`/dashboard/patients/${patientId}?prescribe=1`) },
    { id: "xray", label: "Radiografía", ariaLabel: "Subir o ver radiografías",
      Icon: Camera,
      run: () => router.push(`/dashboard/xrays?patient=${patientId}`) },
    { id: "charge", label: "Cobrar", ariaLabel: "Registrar cobro",
      Icon: CreditCard,
      run: () => router.push(`/dashboard/patients/${patientId}?charge=1`) },
    { id: "ai", label: "IA asistente", ariaLabel: "Consultar IA con contexto",
      Icon: Sparkles, tone: "brand",
      run: () => router.push(`/dashboard/ai-assistant?patient=${patientId}`) },
  ];
  const end: ActionDef = {
    id: "end", label: "Terminar consulta", ariaLabel: "Terminar consulta",
    Icon: XCircle, tone: "danger", run: openEndModal,
  };
  return { main, end };
}

function ActionButton({ action }: { action: ActionDef }) {
  const isDanger = action.tone === "danger";
  const isBrand = action.tone === "brand";
  return (
    <button
      type="button"
      onClick={action.run}
      aria-label={action.ariaLabel}
      title={action.label}
      style={{
        width: 32, height: 32,
        display: "grid", placeItems: "center",
        borderRadius: 8,
        background: "transparent",
        border: "1px solid transparent",
        color: isDanger
          ? "var(--danger)"
          : isBrand
            ? "var(--consult-active-accent)"
            : "var(--text-2)",
        cursor: "pointer",
        transition: "all 0.15s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isDanger ? "var(--danger-soft)" : "var(--bg-hover)";
        e.currentTarget.style.color = isDanger ? "var(--danger)" : "var(--text-1)";
        e.currentTarget.style.borderColor = isDanger
          ? "var(--danger-border-strong)"
          : "var(--border-soft)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = isDanger
          ? "var(--danger)"
          : isBrand
            ? "var(--consult-active-accent)"
            : "var(--text-2)";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <action.Icon size={16} aria-hidden />
    </button>
  );
}
