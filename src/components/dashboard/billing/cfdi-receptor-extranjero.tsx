"use client";

// «Paciente extranjero» en el formulario de timbrado (ws1-t8, auditoría CFDI F-22). Reglas en
// lib/cfdi/extranjero.ts. Mientras RECEPTOR_EXTRANJERO_HABILITADO sea false (el timbrado aún no
// arma el cliente extranjero de Facturapi) el hook devuelve el receptor de siempre y el bloque no
// se pinta.

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/i18n/i18n-provider";
import {
  PAISES_FRECUENTES, RECEPTOR_EXTRANJERO_HABILITADO, USO_EXTRANJERO,
  errorDeReceptorExtranjero, receptorExtranjero, type ReceptorCfdi,
} from "@/lib/cfdi/extranjero";

export interface EstadoExtranjero { activo: boolean; pais: string; numRegIdTrib: string; zip: string }

const VACIO: EstadoExtranjero = { activo: false, pais: "USA", numRegIdTrib: "", zip: "" };

export function useReceptorExtranjero(invoiceId: string | null | undefined, habilitado = RECEPTOR_EXTRANJERO_HABILITADO) {
  const locale = useLocale();
  const [estado, setEstado] = useState<EstadoExtranjero>(VACIO);
  useEffect(() => { setEstado(VACIO); }, [invoiceId]);
  const activo = habilitado && estado.activo;

  /** El receptor que se manda: el nacional tal cual, o el del extranjero. */
  const receptor = useCallback((base: ReceptorCfdi): ReceptorCfdi => (activo
    ? receptorExtranjero({ nombre: base.nombre, zip: estado.zip, email: base.email, pais: estado.pais, numRegIdTrib: estado.numRegIdTrib })
    : base), [activo, estado]);

  /** Motivo por el que no se puede timbrar como extranjero (null si se puede o no aplica). */
  const error = useCallback((nombre: string): string | null => (activo
    ? errorDeReceptorExtranjero({ nombre, cp: estado.zip, extranjero: estado }, locale)
    : null), [activo, estado, locale]);

  return { habilitado, activo, estado, setEstado, receptor, error, usoForzado: activo ? USO_EXTRANJERO : null };
}

export function CamposReceptorExtranjero({ ext }: { ext: ReturnType<typeof useReceptorExtranjero> }) {
  const locale = useLocale();
  const en = (locale ?? "").startsWith("en");
  if (!ext.habilitado) return null;
  const { estado, setEstado } = ext;
  const conocido = PAISES_FRECUENTES.some((p) => p.clave === estado.pais);
  return (
    <fieldset className="space-y-2" data-cfdi-extranjero>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={estado.activo} onChange={(e) => setEstado({ ...estado, activo: e.target.checked })} />
        {en ? "Foreign patient (no Mexican RFC)" : "Paciente extranjero (sin RFC mexicano)"}
      </label>
      {estado.activo && (
        <>
          <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {en
              ? "The CFDI goes to the generic RFC XEXX010101000, regime 616 and use S01, with the country and tax ID below. RFC, regime and CFDI use are not needed."
              : "El CFDI sale al RFC genérico XEXX010101000, régimen 616 y uso S01, con el país y la identificación fiscal de abajo. No hace falta capturar RFC, régimen ni uso: los fija el SAT."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfdi-ext-pais">{en ? "Country of tax residence" : "País de residencia fiscal"}</Label>
              <select id="cfdi-ext-pais" className="input-new" value={conocido ? estado.pais : "OTRO"}
                onChange={(e) => setEstado({ ...estado, pais: e.target.value === "OTRO" ? "" : e.target.value })}>
                {PAISES_FRECUENTES.map((p) => <option key={p.clave} value={p.clave}>{en ? p.en : p.es} ({p.clave})</option>)}
                <option value="OTRO">{en ? "Other (ISO code)" : "Otro (clave ISO)"}</option>
              </select>
              {!conocido && (
                <Input aria-label={en ? "ISO 3166 alpha-3 code" : "Clave ISO 3166 de 3 letras"} maxLength={3} value={estado.pais}
                  onChange={(e) => setEstado({ ...estado, pais: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="NZL" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfdi-ext-zip">{en ? "ZIP / postal code" : "Código postal de su país"}</Label>
              <Input id="cfdi-ext-zip" maxLength={12} value={estado.zip} onChange={(e) => setEstado({ ...estado, zip: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfdi-ext-id">{en ? "Tax ID in their country (SSN/ITIN, SIN, NIF…)" : "Identificación fiscal en su país (SSN/ITIN, SIN, NIF…)"}</Label>
            <Input id="cfdi-ext-id" maxLength={40} value={estado.numRegIdTrib} onChange={(e) => setEstado({ ...estado, numRegIdTrib: e.target.value })} />
          </div>
        </>
      )}
    </fieldset>
  );
}
