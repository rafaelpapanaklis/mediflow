"use client";

// «¿Cómo le devolviste el dinero?» (ws1-t5, F5). Lo piden SIEMPRE el modal de
// reembolso y el «Ya lo devolví» de una cita cancelada: el corte de caja solo
// resta del efectivo esperado lo que salió en efectivo, y sin este dato no
// puede saberlo. Sin opción preseleccionada a propósito: elegir es obligatorio.

import { useLocale } from "@/i18n/i18n-provider";
import { METODOS_DE_DEVOLUCION, type MetodoDeDevolucion } from "@/lib/dinero/reembolsos";
import { textosDinero } from "@/lib/dinero/textos";

export function MetodoDevolucion({
  valor,
  onCambio,
  disabled,
  id = "metodo-devolucion",
}: {
  valor: MetodoDeDevolucion | "";
  onCambio: (m: MetodoDeDevolucion | "") => void;
  disabled?: boolean;
  id?: string;
}) {
  const tx = textosDinero(useLocale()).devolucion;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium" style={{ color: "var(--text-2)" }}>
        {tx.pregunta}
      </label>
      <select
        id={id}
        value={valor}
        disabled={disabled}
        required
        onChange={(e) => onCambio(e.target.value as MetodoDeDevolucion | "")}
        className="w-full text-sm rounded-md px-2 py-1.5"
        style={{ background: "var(--bg-elev)", color: "var(--text-1)", border: "1px solid var(--border-soft)" }}
      >
        <option value="">{tx.elige}</option>
        {METODOS_DE_DEVOLUCION.map((m) => (
          <option key={m} value={m}>{tx.metodos[m]}</option>
        ))}
      </select>
      {valor && (
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          {valor === "cash" ? tx.ayudaEfectivo : tx.ayudaOtro}
        </p>
      )}
    </div>
  );
}
