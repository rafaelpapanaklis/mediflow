"use client";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X, CreditCard, CalendarPlus, LogOut, type LucideIcon } from "lucide-react";
import toast from "react-hot-toast";
import { useActiveConsult } from "@/hooks/use-active-consult";

interface PatientContextEndModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PatientContextEndModal({
  open, onOpenChange,
}: PatientContextEndModalProps) {
  const router = useRouter();
  const { consult, elapsedSeconds, endConsult } = useActiveConsult();

  if (!consult) return null;

  const mm = Math.floor(elapsedSeconds / 60);
  const ss = elapsedSeconds % 60;
  const duration = `${mm} min ${ss}s`;

  const handleCharge = async () => {
    const patientId = consult.patientId;
    await endConsult();
    onOpenChange(false);
    router.push(`/dashboard/patients/${patientId}?charge=1`);
  };

  const handleScheduleNext = async () => {
    const patientId = consult.patientId;
    await endConsult();
    onOpenChange(false);
    router.push(`/dashboard/appointments?new=1&patient=${patientId}`);
  };

  const handleJustClose = async () => {
    await endConsult();
    onOpenChange(false);
    toast.success("Consulta cerrada");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          style={{
            background: "rgba(5,5,10,0.72)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        />
        <Dialog.Content
          aria-labelledby="end-consult-title"
          className="fixed z-50"
          style={{
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(460px, 92vw)",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            boxShadow: "0 24px 60px -12px rgba(0,0,0,0.4)",
            overflow: "hidden",
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
          }}
        >
          <header
            style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              padding: "18px 22px 14px",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <div>
              <Dialog.Title
                id="end-consult-title"
                style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}
              >
                Terminar consulta
              </Dialog.Title>
              <Dialog.Description
                style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}
              >
                <strong style={{ color: "var(--text-1)", fontWeight: 600 }}>
                  {consult.patientName}
                </strong>
                {" · "}
                <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                  {duration}
                </span>
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Cerrar"
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                color: "var(--text-2)",
                display: "grid", placeItems: "center",
                cursor: "pointer",
              }}
            >
              <X size={14} />
            </Dialog.Close>
          </header>

          <div style={{ padding: "18px 22px 22px" }}>
            <p style={{
              fontSize: 13, color: "var(--text-2)",
              margin: 0, marginBottom: 14, lineHeight: 1.55,
            }}>
              ¿Qué sigue después de esta consulta?
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <EndAction Icon={CreditCard} title="Cobrar ahora"
                sub="Abre factura o pago en efectivo"
                variant="primary" onClick={handleCharge} />
              <EndAction Icon={CalendarPlus} title="Agendar siguiente cita"
                sub="Crea nueva cita con el paciente"
                variant="secondary" onClick={handleScheduleNext} />
              <EndAction Icon={LogOut} title="Solo cerrar consulta"
                sub="Sin acciones adicionales"
                variant="ghost" onClick={handleJustClose} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EndAction({
  Icon, title, sub, variant, onClick,
}: {
  Icon: LucideIcon;
  title: string;
  sub: string;
  variant: "primary" | "secondary" | "ghost";
  onClick: () => void;
}) {
  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px",
        border: `1px solid ${isPrimary ? "transparent" : "var(--border-soft)"}`,
        borderRadius: 10,
        background: isPrimary ? "var(--brand)" : isGhost ? "transparent" : "var(--bg-elev-2)",
        color: isPrimary ? "#fff" : "var(--text-1)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        width: "100%",
        boxShadow: isPrimary
          ? "0 0 0 1px rgba(124,58,237,0.5), 0 4px 16px -4px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)"
          : "none",
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => {
        if (isPrimary) e.currentTarget.style.background = "#8b5cf6";
        else if (isGhost) e.currentTarget.style.background = "var(--bg-hover)";
        else e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
      onMouseLeave={(e) => {
        if (isPrimary) e.currentTarget.style.background = "var(--brand)";
        else if (isGhost) e.currentTarget.style.background = "transparent";
        else e.currentTarget.style.borderColor = "var(--border-soft)";
      }}
    >
      <Icon size={18} style={{ color: isPrimary ? "#fff" : "var(--text-2)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: isPrimary ? "#fff" : "var(--text-1)",
        }}>
          {title}
        </div>
        <div style={{
          fontSize: 11,
          color: isPrimary ? "rgba(255,255,255,0.85)" : "var(--text-2)",
          marginTop: 2,
        }}>
          {sub}
        </div>
      </div>
    </button>
  );
}
