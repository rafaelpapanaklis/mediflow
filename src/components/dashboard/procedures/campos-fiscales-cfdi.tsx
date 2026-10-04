"use client";

// «Clave SAT» e «IVA en el CFDI» de un procedimiento (ws1-t4, vuelta 2: F-11 y F-08).
// Vacío = por defecto: la clave de su categoría (dental 85122001, ortodoncia
// 85122005, cirugía/implantes 85122004) y el IVA de la factura. Se resuelven al
// timbrar: las facturas ya timbradas no cambian.

import { useLocale } from "@/i18n/i18n-provider";
import { CLAVES_SAT_DENTALES, claveSatPorDefecto, esClaveSat, type IvaConcepto } from "@/lib/cfdi/fiscal-concepto";

export interface FiscalDelFormulario {
  /** "" = por defecto. */
  claveSat: string;
  /** "" = el de la factura. */
  ivaCfdi: "" | IvaConcepto;
}

const OTRA = "__otra";

export function CamposFiscalesCfdi(props: {
  valor: FiscalDelFormulario;
  onCambio: (v: FiscalDelFormulario) => void;
  categoria: string;
  nombre: string;
  /** false = falta pegar sql/ws1-t4-cfdi-conceptos.sql: se ve, pero no se guarda. */
  disponible: boolean;
  clases: { fila?: string; campo?: string; etiqueta?: string; input?: string; ayuda?: string };
}) {
  const en = useLocale().startsWith("en");
  const { valor, onCambio, clases } = props;
  const porDefecto = claveSatPorDefecto({ category: props.categoria, name: props.nombre });
  const enLista = CLAVES_SAT_DENTALES.some((c) => c.clave === valor.claveSat);
  const seleccion = valor.claveSat === "" ? "" : enLista ? valor.claveSat : OTRA;
  const textoDefecto = CLAVES_SAT_DENTALES.find((c) => c.clave === porDefecto);

  return (
    <div className={clases.fila} data-campos-fiscales-cfdi>
      <div className={clases.campo}>
        <label className={clases.etiqueta} htmlFor="proc-clave-sat">{en ? "SAT product key (CFDI)" : "Clave SAT (CFDI)"}</label>
        <select
          id="proc-clave-sat"
          className={clases.input}
          value={seleccion}
          disabled={!props.disponible}
          onChange={(e) => {
            const v = e.target.value;
            onCambio({ ...valor, claveSat: v === OTRA ? (enLista || valor.claveSat === "" ? " " : valor.claveSat) : v });
          }}
        >
          <option value="">
            {en ? "Default" : "Por defecto"}: {textoDefecto ? (en ? textoDefecto.en : textoDefecto.es) : porDefecto}
          </option>
          {CLAVES_SAT_DENTALES.map((c) => (
            <option key={c.clave} value={c.clave}>{en ? c.en : c.es}</option>
          ))}
          <option value={OTRA}>{en ? "Other key…" : "Otra clave…"}</option>
        </select>
        {seleccion === OTRA && (
          <input
            className={clases.input}
            style={{ marginTop: 6 }}
            inputMode="numeric"
            maxLength={8}
            placeholder="8 dígitos"
            aria-label={en ? "Other SAT key (8 digits)" : "Otra clave SAT (8 dígitos)"}
            aria-invalid={!esClaveSat(valor.claveSat) || undefined}
            value={valor.claveSat.trim()}
            onChange={(e) => onCambio({ ...valor, claveSat: e.target.value.replace(/\D/g, "").slice(0, 8) || " " })}
          />
        )}
      </div>
      <div className={clases.campo}>
        <label className={clases.etiqueta} htmlFor="proc-iva-cfdi">{en ? "VAT on the CFDI" : "IVA en el CFDI"}</label>
        <select
          id="proc-iva-cfdi"
          className={clases.input}
          value={valor.ivaCfdi}
          disabled={!props.disponible}
          onChange={(e) => onCambio({ ...valor, ivaCfdi: e.target.value as FiscalDelFormulario["ivaCfdi"] })}
        >
          <option value="">{en ? "Same as the invoice" : "El de la factura"}</option>
          <option value="exento">{en ? "Exempt (dental services)" : "Exento (servicios dentales)"}</option>
          <option value="iva16">{en ? "16% VAT (products, cosmetic…)" : "IVA 16% (productos, estética…)"}</option>
        </select>
        <p className={clases.ayuda}>
          {props.disponible
            ? (en
              ? "Used when the invoice is stamped. Invoices already stamped don't change."
              : "Se usa al timbrar. Las facturas ya timbradas no cambian.")
            : (en
              ? "Not available yet: the database update (sql/ws1-t4-cfdi-conceptos.sql) is pending. The default key is used meanwhile."
              : "Todavía no se puede guardar: falta aplicar sql/ws1-t4-cfdi-conceptos.sql. Mientras, se usa la clave por defecto.")}
        </p>
      </div>
    </div>
  );
}

/** Lo que el formulario manda a la API: "" = por defecto (null). */
export function fiscalParaGuardar(v: FiscalDelFormulario): { claveSat: string | null; ivaCfdi: IvaConcepto | null } {
  const clave = v.claveSat.trim();
  return { claveSat: clave === "" ? null : clave, ivaCfdi: v.ivaCfdi === "" ? null : v.ivaCfdi };
}
