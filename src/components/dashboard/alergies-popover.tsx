"use client";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, Pill, Heart, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { ROPA_ALERTAS, type AparienciaPortal } from "@/components/dashboard/portales-rediseno/ropa";

interface AlergiesPopoverProps {
  trigger: React.ReactNode;
  alerts: {
    allergies?: string[];
    medications?: string[];
    conditions?: string[];
  };
  /**
   * La ROPA (ws1-t4, hallazgo 15). «clasica» pinta exactamente lo de hoy: los
   * `style` en línea de siempre. «nueva» monta las clases de
   * `portales-rediseno/ropa.tsx` (los tokens del menú de dos niveles): lo
   * ponen Hoy y el expediente rediseñados. Qué alertas se enseñan y en qué
   * orden no cambia.
   */
  apariencia?: AparienciaPortal;
}

export function AlergiesPopover({ trigger, alerts, apariencia = "clasica" }: AlergiesPopoverProps) {
  const t = useT();
  const nueva = apariencia === "nueva";
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
          {...(nueva ? { className: ROPA_ALERTAS.caja } : {
            style: {
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
              fontFamily: "var(--font-sans, system-ui, sans-serif)",
            },
          })}
        >
          <div
            {...(nueva ? { className: ROPA_ALERTAS.titulo } : {
              style: {
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-2)",
                marginBottom: 10,
              },
            })}
          >
            {t("shell.alergiesPopover.title")}
          </div>

          {!hasAny && (
            <div {...(nueva ? { className: ROPA_ALERTAS.vacio } : { style: { fontSize: 12, color: "var(--text-2)", padding: "4px 0" } })}>
              {t("shell.alergiesPopover.empty")}
            </div>
          )}

          {hasAllergies && (
            <AlertsSection
              Icon={AlertTriangle}
              color="var(--danger)"
              tono={ROPA_ALERTAS.peligro}
              nueva={nueva}
              title={t("shell.alergiesPopover.allergies")}
              items={alerts.allergies!}
            />
          )}
          {hasMeds && (
            <AlertsSection
              Icon={Pill}
              color="var(--warning)"
              tono={ROPA_ALERTAS.aviso}
              nueva={nueva}
              title={t("shell.alergiesPopover.activeMeds")}
              items={alerts.medications!}
            />
          )}
          {hasConditions && (
            <AlertsSection
              Icon={Heart}
              color="var(--info)"
              tono={ROPA_ALERTAS.info}
              nueva={nueva}
              title={t("shell.alergiesPopover.conditions")}
              items={alerts.conditions!}
            />
          )}

          <div
            {...(nueva ? { className: ROPA_ALERTAS.fuente } : {
              style: {
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid var(--border-soft)",
                fontSize: 10,
                color: "var(--text-3)",
                lineHeight: 1.5,
              },
            })}
          >
            {t("shell.alergiesPopover.source")}
          </div>

          <Popover.Arrow width={10} height={5} {...(nueva ? { className: ROPA_ALERTAS.flecha } : { style: { fill: "var(--bg-elev)" } })} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AlertsSection({
  Icon, color, tono, nueva, title, items,
}: {
  Icon: LucideIcon;
  color: string;
  /** La clase del color del ícono en la ropa nueva (peligro, aviso, info). */
  tono: string;
  nueva: boolean;
  title: string;
  items: string[];
}) {
  return (
    <div {...(nueva ? { className: ROPA_ALERTAS.seccion } : { style: { marginBottom: 8 } })}>
      <div
        {...(nueva ? { className: ROPA_ALERTAS.seccionTitulo } : {
          style: {
            display: "flex", alignItems: "center", gap: 6,
            marginBottom: 4, fontSize: 11, fontWeight: 600,
            color: "var(--text-1)",
          },
        })}
      >
        {nueva ? <Icon size={12} className={tono} /> : <Icon size={12} color={color} />}
        {title}
      </div>
      <ul {...(nueva ? { className: ROPA_ALERTAS.lista } : { style: { listStyle: "none", padding: 0, margin: 0, paddingLeft: 18 } })}>
        {items.map((it, i) => (
          <li
            key={i}
            {...(nueva ? { className: ROPA_ALERTAS.item } : {
              style: {
                fontSize: 12, color: "var(--text-1)",
                lineHeight: 1.5, position: "relative",
              },
            })}
          >
            <span
              aria-hidden
              {...(nueva ? { className: ROPA_ALERTAS.punto } : {
                style: {
                  position: "absolute", left: -12, top: 7,
                  width: 4, height: 4, borderRadius: "50%",
                  background: "var(--text-3)",
                },
              })}
            />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
