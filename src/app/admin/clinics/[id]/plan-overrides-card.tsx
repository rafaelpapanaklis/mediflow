"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";

/**
 * Condiciones CONSERVADAS de una clínica (planes nuevos de sep-2026): topes de
 * usuarios y sedes y precio mensual/anual que mandan sobre los de su plan.
 * Lógica y reglas en src/lib/billing/plan-overrides.ts; guarda en
 * PATCH /api/admin/clinics/[id]/plan-overrides (misma sesión de admin que el resto).
 */
export interface PlanOverridesDTO {
  /** ¿Hay overrides VIGENTES? (false si no hay, o si la clínica ya cambió de plan). */
  active: boolean;
  /** Plan para el que se conservan (la guarda). */
  planOverrideFor: string | null;
  maxUsersOverride: number | null;
  maxClinicsOverride: number | null;
  priceMxnMonthlyOverride: number | null;
  priceMxnAnnualOverride: number | null;
  /** Lo que dice el PLAN hoy en plan_configs (para comparar). null = ilimitado. */
  list: {
    maxUsers: number | null;
    maxClinics: number | null;
    priceMxnMonthly: number;
    priceMxnAnnual: number;
  };
}

const fmtLimit = (v: number | null) => (v === null ? "Ilimitado" : String(v));
const fmtMoney = (v: number) => `$${v.toLocaleString("es-MX")}`;

/** Un límite guardado → texto del input ("" = sigue el plan, "unlimited" = ilimitado). */
const limitToInput = (v: number | null) => (v === null ? "" : v < 0 ? "unlimited" : String(v));
const priceToInput = (v: number | null) => (v === null ? "" : String(v));

export function PlanOverridesCard({
  clinicId,
  plan,
  initial,
}: {
  clinicId: string;
  plan: string;
  initial: PlanOverridesDTO;
}) {
  const [data, setData] = useState(initial);
  // Si lo guardado es de OTRO plan (ya no vale), los campos arrancan vacíos: si
  // se precargaran los valores viejos, «Guardar» sin tocar nada los ataría al
  // plan actual y le regalaría a la clínica condiciones que ya no tenía.
  const seed = initial.active ? initial : null;
  const [users, setUsers] = useState(limitToInput(seed?.maxUsersOverride ?? null));
  const [branches, setBranches] = useState(limitToInput(seed?.maxClinicsOverride ?? null));
  const [monthly, setMonthly] = useState(priceToInput(seed?.priceMxnMonthlyOverride ?? null));
  const [annual, setAnnual] = useState(priceToInput(seed?.priceMxnAnnualOverride ?? null));
  const [saving, setSaving] = useState(false);

  const hasStored =
    data.maxUsersOverride !== null ||
    data.maxClinicsOverride !== null ||
    data.priceMxnMonthlyOverride !== null ||
    data.priceMxnAnnualOverride !== null;
  // Guardado para OTRO plan: la fila sigue ahí pero no vale (la clínica cambió de plan).
  const stale = hasStored && !data.active;

  async function send(body: Record<string, unknown>, okMsg: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}/plan-overrides`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error ?? "No se pudo guardar");
        return;
      }
      const o = json.overrides;
      setData((d) => ({
        ...d,
        active: !!json.active,
        planOverrideFor: o.planOverrideFor ?? null,
        maxUsersOverride: o.maxUsersOverride ?? null,
        maxClinicsOverride: o.maxClinicsOverride ?? null,
        priceMxnMonthlyOverride: o.priceMxnMonthlyOverride ?? null,
        priceMxnAnnualOverride: o.priceMxnAnnualOverride ?? null,
      }));
      setUsers(limitToInput(o.maxUsersOverride ?? null));
      setBranches(limitToInput(o.maxClinicsOverride ?? null));
      setMonthly(priceToInput(o.priceMxnMonthlyOverride ?? null));
      setAnnual(priceToInput(o.priceMxnAnnualOverride ?? null));
      toast.success(okMsg);
    } catch {
      toast.error("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  const row = (label: string, list: string, value: string) => (
    <div
      key={label}
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 0",
        borderBottom: "1px solid var(--border-soft)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span style={{ color: "var(--text-1)", fontWeight: 500 }}>
        {value}
        {value !== list && <span style={{ color: "var(--text-3)", fontWeight: 400 }}> (plan: {list})</span>}
      </span>
    </div>
  );

  const eff = {
    users: data.active && data.maxUsersOverride !== null ? (data.maxUsersOverride < 0 ? null : data.maxUsersOverride) : data.list.maxUsers,
    branches: data.active && data.maxClinicsOverride !== null ? (data.maxClinicsOverride < 0 ? null : data.maxClinicsOverride) : data.list.maxClinics,
    monthly: data.active && data.priceMxnMonthlyOverride ? data.priceMxnMonthlyOverride : data.list.priceMxnMonthly,
    annual: data.active && data.priceMxnAnnualOverride ? data.priceMxnAnnualOverride : data.list.priceMxnAnnual,
  };

  return (
    <CardNew>
      <div className="form-section__title">
        Condiciones conservadas <span className="form-section__rule" />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10, lineHeight: 1.5 }}>
        {data.active
          ? `Esta clínica conserva condiciones de antes de los planes nuevos (plan ${data.planOverrideFor}). Mandan sobre las del plan mientras siga en ese plan.`
          : stale
            ? `Tenía condiciones conservadas para el plan ${data.planOverrideFor}, pero ya está en ${plan}: no se aplican y se rige por el plan.`
            : "Sin condiciones conservadas: se rige por las del plan."}
      </div>

      <div style={{ marginBottom: 12 }}>
        {row("Usuarios", fmtLimit(data.list.maxUsers), fmtLimit(eff.users))}
        {row("Sedes", fmtLimit(data.list.maxClinics), fmtLimit(eff.branches))}
        {row("Precio mensual (+ IVA)", fmtMoney(data.list.priceMxnMonthly), fmtMoney(eff.monthly))}
        {row("Precio anual (+ IVA)", fmtMoney(data.list.priceMxnAnnual), fmtMoney(eff.annual))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field-new">
          <label className="field-new__label">Usuarios</label>
          <select value={users === "" || users === "unlimited" ? users : "n"} onChange={(e) => setUsers(e.target.value === "n" ? "1" : e.target.value)} className="input-new">
            <option value="">Sigue el plan</option>
            <option value="n">Un tope…</option>
            <option value="unlimited">Ilimitados</option>
          </select>
          {users !== "" && users !== "unlimited" && (
            <input className="input-new" style={{ marginTop: 6 }} type="number" min={1} value={users} onChange={(e) => setUsers(e.target.value)} />
          )}
        </div>
        <div className="field-new">
          <label className="field-new__label">Sedes</label>
          <select value={branches === "" || branches === "unlimited" ? branches : "n"} onChange={(e) => setBranches(e.target.value === "n" ? "1" : e.target.value)} className="input-new">
            <option value="">Sigue el plan</option>
            <option value="n">Un tope…</option>
            <option value="unlimited">Ilimitadas</option>
          </select>
          {branches !== "" && branches !== "unlimited" && (
            <input className="input-new" style={{ marginTop: 6 }} type="number" min={1} value={branches} onChange={(e) => setBranches(e.target.value)} />
          )}
        </div>
        <div className="field-new">
          <label className="field-new__label">Precio mensual (MXN)</label>
          <input className="input-new" type="number" min={1} placeholder="Sigue el plan" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </div>
        <div className="field-new">
          <label className="field-new__label">Precio anual (MXN)</label>
          <input className="input-new" type="number" min={1} placeholder="Sigue el plan" value={annual} onChange={(e) => setAnnual(e.target.value)} />
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-3)", margin: "8px 0 12px", lineHeight: 1.5 }}>
        Al guardar quedan atadas al plan actual ({plan}). Si la clínica cambia de plan, dejan de aplicarse solas.
        Precios sin IVA; lo que ya está contratado con tarjeta en Stripe conserva su importe.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ButtonNew
          variant="primary"
          disabled={saving}
          onClick={() =>
            send(
              {
                maxUsers: users === "" ? null : users,
                maxClinics: branches === "" ? null : branches,
                priceMxnMonthly: monthly === "" ? null : Number(monthly),
                priceMxnAnnual: annual === "" ? null : Number(annual),
              },
              "Condiciones guardadas",
            )
          }
        >
          {saving ? "Guardando…" : "Guardar condiciones"}
        </ButtonNew>
        {hasStored && (
          <ButtonNew variant="secondary" disabled={saving} onClick={() => send({ clear: true }, "Condiciones quitadas: rige el plan")}>
            Quitar condiciones
          </ButtonNew>
        )}
      </div>
    </CardNew>
  );
}
