"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { formatCurrency } from "@/lib/utils";
import { descuentoAnualPct, validarPrecioModulo, type PrecioModulo } from "@/lib/marketplace/module-price-admin-core";

/** Un módulo que hoy se vende, con su precio y quién lo tiene. */
export interface ModuloEditable extends PrecioModulo {
  key: string;
  name: string;
  isActive: boolean;
  /** La columna del precio anual existe. Sin ella el anual no se puede guardar. */
  anualDisponible: boolean;
  /** Clínicas que lo tienen vigente, las que pagan y las de cortesía. `null` = no se midió. */
  uso: { clinicas: number; pagando: number; cortesia: number; total: number } | null;
}

type Guardar = (moduleKey: string, precio: { priceMxnMonthly: string; priceMxnAnnual: string }) => Promise<PrecioModulo>;

const guardarEnServidor: Guardar = async (moduleKey, precio) => {
  const res = await fetch(`/api/admin/module-price/${moduleKey}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(precio),
  });
  const d = (await res.json().catch(() => ({}))) as { error?: string } & Partial<PrecioModulo>;
  if (!res.ok) throw new Error(d.error ?? "No se pudo guardar");
  return { priceMxnMonthly: Number(d.priceMxnMonthly), priceMxnAnnual: d.priceMxnAnnual ?? null };
};

/**
 * «Módulos» dentro de /admin/settings → Planes: el precio de cada módulo que
 * se vende solo (hoy, Ortodoncia). Se guarda en la tabla `modules` y aplica al
 * instante en la página de contratar y en el checkout, sin pegar SQL ni
 * redeploy. Ningún precio está escrito aquí: salen de la base.
 */
export function PrecioModulosEditor({
  modulos,
  guardar = guardarEnServidor,
}: {
  modulos: ModuloEditable[];
  /** Solo para la vista previa: sustituye al guardado real. */
  guardar?: Guardar;
}) {
  return (
    <CardNew
      title="Módulos"
      sub="Precio de los módulos que una clínica contrata aparte de su plan. Se cobra más IVA. Aplica al guardar, sin redeploy."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
        {modulos.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
            No hay módulos a la venta en el catálogo.
          </p>
        )}
        {modulos.map((m) => (
          <PrecioModuloCard key={m.key} modulo={m} guardar={guardar} />
        ))}
        <div
          style={{
            padding: "10px 14px",
            background: "var(--brand-soft)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          El precio nuevo rige para quien contrate a partir de ahora. Quien ya paga el módulo
          conserva su importe: Stripe lo fijó al comprar y no cambia hasta que cancele y vuelva
          a contratar. Lo que paga cada clínica está en su ficha, pestaña Módulos.
        </div>
      </div>
    </CardNew>
  );
}

function PrecioModuloCard({ modulo, guardar }: { modulo: ModuloEditable; guardar: Guardar }) {
  const [guardado, setGuardado] = useState<PrecioModulo>({
    priceMxnMonthly: modulo.priceMxnMonthly,
    priceMxnAnnual: modulo.priceMxnAnnual,
  });
  const [mensual, setMensual] = useState(String(modulo.priceMxnMonthly));
  const [anual, setAnual] = useState(modulo.priceMxnAnnual === null ? "" : String(modulo.priceMxnAnnual));
  const [guardando, setGuardando] = useState(false);

  const validado = validarPrecioModulo({ priceMxnMonthly: mensual, priceMxnAnnual: modulo.anualDisponible ? anual : null });
  const sinCambios =
    validado.ok === true &&
    validado.precio.priceMxnMonthly === guardado.priceMxnMonthly &&
    validado.precio.priceMxnAnnual === guardado.priceMxnAnnual;
  const descuento = validado.ok === true ? descuentoAnualPct(validado.precio) : null;
  const idMensual = `precio-modulo-${modulo.key}-mensual`;
  const idAnual = `precio-modulo-${modulo.key}-anual`;
  const idError = `precio-modulo-${modulo.key}-error`;

  async function onGuardar() {
    if (validado.ok === false) return;
    setGuardando(true);
    try {
      const nuevo = await guardar(modulo.key, {
        priceMxnMonthly: mensual,
        priceMxnAnnual: modulo.anualDisponible ? anual : "",
      });
      setGuardado(nuevo);
      setMensual(String(nuevo.priceMxnMonthly));
      setAnual(nuevo.priceMxnAnnual === null ? "" : String(nuevo.priceMxnAnnual));
      toast.success(`Precio de ${modulo.name} guardado. Ya es el que ve quien entra a contratarlo.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      data-precio-modulo={modulo.key}
      style={{ border: "1px solid var(--border-soft)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{modulo.name}</span>
        {!modulo.isActive && <BadgeNew tone="warning">Fuera del catálogo</BadgeNew>}
        {modulo.uso && (
          <span style={{ fontSize: 12, color: "var(--text-3)" }} data-uso-modulo>
            {modulo.uso.clinicas === 0
              ? "Ninguna clínica lo tiene todavía"
              : `${modulo.uso.clinicas} ${modulo.uso.clinicas === 1 ? "clínica lo tiene" : "clínicas lo tienen"} · ` +
                `${modulo.uso.pagando} ${modulo.uso.pagando === 1 ? "paga" : "pagan"} (${formatCurrency(modulo.uso.total, "MXN")} al mes)` +
                (modulo.uso.cortesia > 0 ? ` · ${modulo.uso.cortesia} de cortesía` : "")}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div className="field-new">
          <label className="field-new__label" htmlFor={idMensual}>Precio al mes (MXN, sin IVA)</label>
          <input
            id={idMensual}
            className="input-new"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={mensual}
            onChange={(e) => setMensual(e.target.value)}
            aria-invalid={validado.ok === false}
            aria-describedby={validado.ok === false ? idError : undefined}
          />
        </div>
        <div className="field-new">
          <label className="field-new__label" htmlFor={idAnual}>Precio al año (MXN, sin IVA)</label>
          <input
            id={idAnual}
            className="input-new"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={modulo.anualDisponible ? anual : ""}
            disabled={!modulo.anualDisponible}
            placeholder={modulo.anualDisponible ? "Vacío = no se ofrece pago anual" : "Falta pegar el SQL del precio anual"}
            onChange={(e) => setAnual(e.target.value)}
            aria-invalid={validado.ok === false}
            aria-describedby={validado.ok === false ? idError : undefined}
          />
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
        {!modulo.anualDisponible
          ? "El precio anual no se puede guardar todavía: falta pegar sql/marketplace-modulo-ortodoncia-precio.sql."
          : validado.ok === true && validado.precio.priceMxnAnnual === null
            ? "Sin precio anual: la clínica solo podrá contratarlo con pago mensual."
            : descuento !== null
              ? `El anual ahorra ${descuento} % frente a doce meses.`
              : "El anual cuesta lo mismo que doce meses: no hay ahorro."}
      </div>

      {validado.ok === false && (
        <div id={idError} role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>
          {validado.error}
        </div>
      )}

      <div>
        <ButtonNew variant="primary" onClick={onGuardar} disabled={guardando || sinCambios || validado.ok === false}>
          {guardando ? "Guardando…" : sinCambios ? "Sin cambios" : `Guardar precio de ${modulo.name}`}
        </ButtonNew>
      </div>
    </div>
  );
}
