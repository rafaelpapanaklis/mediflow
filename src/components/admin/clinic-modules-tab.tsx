"use client";

/**
 * Tab "Módulos del marketplace" en /admin/clinics/[id]. Lista los módulos
 * dentales del catálogo (Module.isActive=true) con un toggle por cada uno.
 * El estado se lee de ClinicModule (status='active' && currentPeriodEnd>now)
 * y los toggles llaman a toggleClinicModule (server action). Si la clínica
 * no es categoría DENTAL, se muestra un empty state — los módulos del
 * marketplace hoy son todos dentales (ver prisma/seed.ts SEED_MODULES).
 */
import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { Baby, Bone, Layers, Smile, Syringe } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { toggleClinicModule } from "@/app/actions/admin/toggle-clinic-module";

const ICON_MAP: Record<string, typeof Smile> = {
  Smile,
  Layers,
  Syringe,
  Bone,
  Baby,
};

export interface ModuleCatalogRow {
  id:              string;
  key:             string;
  name:            string;
  description:     string;
  iconKey:         string;
  iconBg:          string;
  iconColor:       string;
  priceMxnMonthly: number;
}

export interface ClinicModuleRow {
  moduleKey:        string;
  status:           string;
  paymentMethod:    string;
  activatedAt:      string;        // ISO
  cancelledAt:      string | null; // ISO
  currentPeriodEnd: string;        // ISO
}

interface Props {
  clinicId:       string;
  clinicCategory: string;
  modules:        ModuleCatalogRow[];
  clinicModules:  ClinicModuleRow[];
}

interface RowState {
  enabled:       boolean;
  paymentMethod: string | null;
  lastChangedAt: string | null;
}

function deriveRowState(
  moduleKey: string,
  clinicModules: ClinicModuleRow[],
): RowState {
  const cm = clinicModules.find((c) => c.moduleKey === moduleKey);
  if (!cm) return { enabled: false, paymentMethod: null, lastChangedAt: null };

  const now = Date.now();
  const periodEndOk = new Date(cm.currentPeriodEnd).getTime() > now;
  const enabled = cm.status === "active" && periodEndOk;
  const lastChangedAt = cm.cancelledAt ?? cm.activatedAt;
  return { enabled, paymentMethod: cm.paymentMethod, lastChangedAt };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", {
    day:   "numeric",
    month: "short",
    year:  "numeric",
  });
}

export function ClinicModulesTab({
  clinicId,
  clinicCategory,
  modules,
  clinicModules,
}: Props) {
  const [rows, setRows] = useState<ClinicModuleRow[]>(clinicModules);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (clinicCategory !== "DENTAL") {
    return (
      <CardNew>
        <div className="form-section__title">
          Módulos del marketplace <span className="form-section__rule" />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          No hay módulos del marketplace disponibles para clínicas de categoría {clinicCategory}.
          Hoy el marketplace ofrece solamente módulos dentales.
        </p>
      </CardNew>
    );
  }

  if (modules.length === 0) {
    return (
      <CardNew>
        <div className="form-section__title">
          Módulos del marketplace <span className="form-section__rule" />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          No hay módulos activos en el catálogo (Module.isActive=true). Corre `npm run seed`.
        </p>
      </CardNew>
    );
  }

  async function handleToggle(moduleKey: string, nextEnabled: boolean) {
    setPendingKey(moduleKey);
    try {
      const res = await toggleClinicModule({ clinicId, moduleKey, enabled: nextEnabled });
      if (!res.ok) {
        toast.error(res.error ?? "Error");
        return;
      }
      // Optimistic local update — el revalidatePath del server action ya
      // refresca el RSC, pero queremos respuesta inmediata.
      startTransition(() => {
        setRows((prev) => {
          const without = prev.filter((r) => r.moduleKey !== moduleKey);
          if (nextEnabled) {
            return [
              ...without,
              {
                moduleKey,
                status:           "active",
                paymentMethod:    res.paymentMethod ?? "admin",
                activatedAt:      new Date().toISOString(),
                cancelledAt:      null,
                currentPeriodEnd: new Date("2099-12-31T23:59:59.999Z").toISOString(),
              },
            ];
          }
          // Marcamos cancelado pero no lo borramos para conservar el "última fecha de cambio".
          const existing = prev.find((r) => r.moduleKey === moduleKey);
          if (!existing) return prev;
          return [
            ...without,
            { ...existing, status: "cancelled", cancelledAt: new Date().toISOString() },
          ];
        });
      });
      toast.success(nextEnabled ? "Módulo activado" : "Módulo desactivado");
    } catch {
      toast.error("Error de red");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <CardNew>
      <div className="form-section__title">
        Módulos del marketplace <span className="form-section__rule" />
      </div>
      <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 0, marginBottom: 16 }}>
        Activa o desactiva los módulos del marketplace para esta clínica. Las activaciones
        manuales quedan marcadas como <span className="mono">paymentMethod=&quot;admin&quot;</span>{" "}
        para distinguirlas de suscripciones reales en reportes financieros.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {modules.map((mod) => {
          const Icon = ICON_MAP[mod.iconKey] ?? Smile;
          const state = deriveRowState(mod.key, rows);
          const isAdminGrant = state.enabled && state.paymentMethod === "admin";
          const isStripe = state.enabled && (state.paymentMethod === "stripe" || state.paymentMethod === "paypal");
          const isPending = pendingKey === mod.key;

          return (
            <div
              key={mod.id}
              className="list-row"
              style={{ alignItems: "center", gap: 12, padding: 12 }}
            >
              <div
                className={mod.iconBg}
                style={{
                  width:        36,
                  height:       36,
                  borderRadius: 8,
                  display:      "grid",
                  placeItems:   "center",
                  flexShrink:   0,
                }}
              >
                <Icon size={18} className={mod.iconColor} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
                    {mod.name}
                  </span>
                  {state.enabled && (
                    <BadgeNew tone={isAdminGrant ? "warning" : "success"} dot>
                      {isAdminGrant ? "Concedido por admin" : isStripe ? "Activo vía Stripe" : "Activo"}
                    </BadgeNew>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                  {mod.description}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span className="mono">${mod.priceMxnMonthly} MXN/mes</span>
                  <span>·</span>
                  <span>Último cambio: {formatDate(state.lastChangedAt)}</span>
                </div>
              </div>

              <SwitchToggle
                enabled={state.enabled}
                disabled={isPending}
                onChange={(next) => handleToggle(mod.key, next)}
                label={`${state.enabled ? "Desactivar" : "Activar"} ${mod.name}`}
              />
            </div>
          );
        })}
      </div>
    </CardNew>
  );
}

interface SwitchToggleProps {
  enabled:  boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label:    string;
}

function SwitchToggle({ enabled, disabled, onChange, label }: SwitchToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      style={{
        position:   "relative",
        width:      40,
        height:     22,
        borderRadius: 999,
        border:     "1px solid var(--border-soft)",
        background: enabled ? "var(--brand)" : "var(--bg-elev)",
        cursor:     disabled ? "wait" : "pointer",
        flexShrink: 0,
        opacity:    disabled ? 0.6 : 1,
        transition: "background 120ms ease",
        padding:    0,
      }}
    >
      <span
        style={{
          position:   "absolute",
          top:        1,
          left:       enabled ? 19 : 1,
          width:      18,
          height:     18,
          borderRadius: "50%",
          background: "var(--bg-1)",
          boxShadow:  "0 1px 2px rgba(0,0,0,0.2)",
          transition: "left 120ms ease",
        }}
      />
    </button>
  );
}
