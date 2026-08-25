"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft } from "lucide-react";
import {
  REALTY_FEATURES,
  REALTY_UNLIMITED,
  type RealtyResolvedPlan,
} from "@/lib/realty/plan-shared";
import { formatMoney, formatQuota } from "@/components/admin/inmobiliarias/shared";
import "@/components/admin/inmobiliarias/inmobiliarias.css";

/**
 * Editor de los 3 planes de inmuebles.
 *
 * 🔴 El contrato de "ilimitado" en este vertical es **-1**, no null (así lo
 * declara plan-shared y así está el seed). La casilla "Ilimitado" manda -1;
 * el dental usa null y NO se pueden mezclar.
 *
 * Al guardar un precio nuevo, el servidor limpia `stripeLookupKey`: la clave
 * lleva el importe dentro, así que la vieja ya no sirve y el siguiente
 * checkout crea el precio correcto en Stripe.
 */
function NumField({
  label,
  value,
  onChange,
  hint,
  step,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <div className="dcin-modal__field">
      <label className="dcin-label">{label}</label>
      <input
        className="dcin-control"
        type="number"
        step={step ?? "1"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {hint ? <span className="dcin-counter">{hint}</span> : null}
    </div>
  );
}

/** Campo de cupo con casilla "Ilimitado" que manda -1. */
function LimitField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const unlimited = value === REALTY_UNLIMITED;
  return (
    <div className="dcin-modal__field">
      <label className="dcin-label">{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="dcin-control"
          type="number"
          min={0}
          value={unlimited ? "" : String(value)}
          onChange={(e) => onChange(Number(e.target.value || 0))}
          disabled={disabled || unlimited}
          style={{ minWidth: 0, flex: 1 }}
        />
        <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={unlimited}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? REALTY_UNLIMITED : 1)}
          />
          Ilimitado
        </label>
      </div>
    </div>
  );
}

function PlanEditor({ plan, onSaved }: { plan: RealtyResolvedPlan; onSaved: () => void }) {
  const [name, setName] = useState(plan.name);
  const [priceMonthly, setPriceMonthly] = useState(String(plan.priceMonthly));
  const [priceYearly, setPriceYearly] = useState(
    plan.priceYearly === null ? "" : String(plan.priceYearly),
  );
  const [maxUsers, setMaxUsers] = useState(plan.maxUsers);
  const [maxOffices, setMaxOffices] = useState(plan.maxOffices);
  const [maxProperties, setMaxProperties] = useState(plan.maxProperties);
  const [storageQuotaMb, setStorageQuotaMb] = useState(String(plan.storageQuotaMb));
  const [messageQuota, setMessageQuota] = useState(String(plan.messageQuota));
  const [features, setFeatures] = useState<Record<string, boolean>>({ ...plan.features });
  const [isActive, setIsActive] = useState(plan.isActive);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/inmobiliarias/planes/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          priceMonthly: Number(priceMonthly),
          priceYearly: priceYearly === "" ? null : Number(priceYearly),
          maxUsers,
          maxOffices,
          maxProperties,
          storageQuotaMb: Number(storageQuotaMb),
          messageQuota: Number(messageQuota),
          features,
          isActive,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(`Plan ${name} actualizado.`);
      onSaved();
    } catch {
      toast.error("No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dcin-card">
      <h2 className="dcin-cardtitle">
        {plan.name} <code style={{ opacity: 0.6, fontSize: 11 }}>{plan.id}</code>
      </h2>
      <p className="dcin-note">
        Hoy: {formatMoney(plan.priceMonthly)} al mes ·{" "}
        {formatQuota(plan.storageQuotaMb)} de archivos ·{" "}
        {plan.messageQuota === 0 ? "sin WhatsApp" : `${plan.messageQuota} mensajes`}.
        {plan.stripeLookupKey ? (
          <>
            {" "}
            Precio en Stripe: <code>{plan.stripeLookupKey}</code>.
          </>
        ) : (
          " Todavía no se ha creado su precio en Stripe (nace en el primer checkout)."
        )}
      </p>

      <div className="dcin-fields">
        <div className="dcin-modal__field">
          <label className="dcin-label">Nombre visible</label>
          <input
            className="dcin-control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>
        <NumField
          label="Precio mensual (MXN)"
          value={priceMonthly}
          onChange={setPriceMonthly}
          step="0.01"
          hint="En pesos, no en centavos."
          disabled={busy}
        />
        <NumField
          label="Precio anual (MXN)"
          value={priceYearly}
          onChange={setPriceYearly}
          step="0.01"
          hint="Vacío = el plan no ofrece ciclo anual."
          disabled={busy}
        />
        <LimitField
          label="Usuarios"
          value={maxUsers}
          onChange={setMaxUsers}
          disabled={busy}
        />
        <LimitField
          label="Oficinas"
          value={maxOffices}
          onChange={setMaxOffices}
          disabled={busy}
        />
        <LimitField
          label="Inmuebles"
          value={maxProperties}
          onChange={setMaxProperties}
          disabled={busy}
        />
        <NumField
          label="Espacio de archivos (MB)"
          value={storageQuotaMb}
          onChange={setStorageQuotaMb}
          hint="1 GB = 1024 MB. Se guarda en MB para no perder precisión."
          disabled={busy}
        />
        <NumField
          label="Mensajes de WhatsApp al mes"
          value={messageQuota}
          onChange={setMessageQuota}
          hint="0 = el plan NO incluye WhatsApp."
          disabled={busy}
        />
      </div>

      <div>
        <div className="dcin-label" style={{ marginBottom: 6 }}>
          Qué incluye este plan
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 4,
          }}
        >
          {REALTY_FEATURES.map((f) => (
            <label
              key={f.key}
              style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}
            >
              <input
                type="checkbox"
                checked={features[f.key] === true}
                disabled={busy}
                onChange={(e) =>
                  setFeatures((prev) => ({ ...prev, [f.key]: e.target.checked }))
                }
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <div className="dcin-actions" style={{ justifyContent: "space-between" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={isActive}
            disabled={busy}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Se puede contratar
        </label>
        <button
          type="button"
          className="dcin-btn dcin-btn--primary"
          onClick={save}
          disabled={busy}
        >
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </section>
  );
}

export function RealtyPlanConfigClient({ plans }: { plans: RealtyResolvedPlan[] }) {
  const router = useRouter();

  return (
    <div className="dcin">
      <header className="dcin-head">
        <div>
          <Link className="dcin-backlink" href="/admin/inmobiliarias">
            <ArrowLeft size={12} style={{ verticalAlign: "-1px" }} aria-hidden /> Volver a
            inmobiliarias
          </Link>
          <h1 className="dcin-title" style={{ marginTop: 4 }}>
            Planes y precios de Inmuebles
          </h1>
          <p className="dcin-sub">
            Fuente única de los precios y los cupos del vertical. Lo que
            cambies aquí lo ve la pantalla de suscripción de cada inmobiliaria
            en menos de un minuto, sin desplegar nada. No afecta al dental ni a
            barberías.
          </p>
        </div>
      </header>

      <div className="dcin-card">
        <p className="dcin-note">
          <strong>Qué pasa con Stripe al cambiar un precio.</strong> Los
          precios de Stripe son inmutables, así que no se edita el que ya
          existe: la clave de búsqueda lleva el importe dentro
          (<code>dcrealty_&lt;plan&gt;_month_&lt;importe en centavos&gt;</code>), de modo
          que al cambiar el precio nace uno nuevo en el siguiente checkout y el
          viejo se queda con las suscripciones que ya lo pagaban. Nadie ve un
          cobro distinto de un día para otro; quien quiera el precio nuevo
          cambia de plan.
        </p>
      </div>

      {plans.map((plan) => (
        <PlanEditor key={plan.id} plan={plan} onSaved={() => router.refresh()} />
      ))}
    </div>
  );
}
