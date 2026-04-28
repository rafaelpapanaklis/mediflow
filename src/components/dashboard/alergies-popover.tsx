"use client";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, Pill, Heart, type LucideIcon } from "lucide-react";

interface AlergiesPopoverProps {
  trigger: React.ReactNode;
  alerts: {
    allergies?: string[];
    medications?: string[];
    conditions?: string[];
  };
}

export function AlergiesPopover({ trigger, alerts }: AlergiesPopoverProps) {
  const hasAllergies = (alerts.allergies?.length ?? 0) > 0;
  const hasMeds = (alerts.medications?.length ?? 0) > 0;
  const hasConditions = (alerts.conditions?.length ?? 0) > 0;
  const hasAny = hasAllergies || hasMeds || hasConditions;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={16}
          style={{
            zIndex: 50,
            minWidth: 280,
            maxWidth: 360,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            padding: 14,
            boxShadow:
              "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
            fontSize: 12,
            color: "var(--text-1)",
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-2)",
              marginBottom: 10,
            }}
          >
            Alertas médicas
          </div>

          {!hasAny && (
            <div style={{ fontSize: 12, color: "var(--text-2)", padding: "4px 0" }}>
              Sin alertas registradas.
            </div>
          )}

          {hasAllergies && (
            <AlertsSection
              Icon={AlertTriangle}
              color="var(--danger)"
              title="Alergias"
              items={alerts.allergies!}
            />
          )}
          {hasMeds && (
            <AlertsSection
              Icon={Pill}
              color="var(--warning)"
              title="Medicamentos activos"
              items={alerts.medications!}
            />
          )}
          {hasConditions && (
            <AlertsSection
              Icon={Heart}
              color="var(--info)"
              title="Condiciones"
              items={alerts.conditions!}
            />
          )}

          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--border-soft)",
              fontSize: 10,
              color: "var(--text-3)",
              lineHeight: 1.5,
            }}
          >
            Fuente: expediente del paciente. Verifica antes de cualquier prescripción.
          </div>

          <Popover.Arrow width={10} height={5} style={{ fill: "var(--bg-elev)" }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AlertsSection({
  Icon, color, title, items,
}: {
  Icon: LucideIcon;
  color: string;
  title: string;
  items: string[];
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          marginBottom: 4, fontSize: 11, fontWeight: 600,
          color: "var(--text-1)",
        }}
      >
        <Icon size={12} color={color} />
        {title}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, paddingLeft: 18 }}>
        {items.map((it, i) => (
          <li
            key={i}
            style={{
              fontSize: 12, color: "var(--text-1)",
              lineHeight: 1.5, position: "relative",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute", left: -12, top: 7,
                width: 4, height: 4, borderRadius: "50%",
                background: "var(--text-3)",
              }}
            />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
