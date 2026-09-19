"use client";

import type { ReactNode } from "react";
import { useT } from "@/i18n/i18n-provider";
import type { EncabezadoNota } from "./tipos";

/**
 * La hoja de la nota: cabecera + cuerpo. Pinta SOLO lo que recibe —la foto
 * guardada con el documento—, nunca los datos de hoy del doctor o la clínica.
 *
 * Lo que falta (logo, cédula) NO se pinta: ni "N/A", ni raya, ni hueco. Una
 * línea que no está es honesta; un dato de relleno no.
 */
export function NotaCabecera({ encabezado, titulo }: { encabezado: EncabezadoNota; titulo: string }) {
  const t = useT();
  return (
    <header className="flex items-start gap-4 border-b border-border pb-4">
      {encabezado.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- URL del logo de la clínica, dominio no fijo
        <img src={encabezado.logoUrl} alt={encabezado.clinicaNombre} className="h-14 w-14 flex-shrink-0 rounded-md object-contain" />
      )}
      <div className="min-w-0 flex-1">
        {encabezado.clinicaNombre && (
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
            {encabezado.clinicaNombre}
          </div>
        )}
        <h3 className="text-base font-semibold text-foreground">{titulo}</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Dato etiqueta={t("notaEvolucionDoc.header.patient")}>{encabezado.pacienteNombre}</Dato>
          <Dato etiqueta={t("notaEvolucionDoc.header.date")}>{encabezado.fecha}</Dato>
          <Dato etiqueta={t("notaEvolucionDoc.header.doctor")}>{encabezado.doctorNombre}</Dato>
          {encabezado.cedula && <Dato etiqueta={t("notaEvolucionDoc.header.license")}>{encabezado.cedula}</Dato>}
        </dl>
      </div>
    </header>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex gap-1.5">
      <dt style={{ color: "var(--text-3)" }}>{etiqueta}:</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Estilos del texto: la lista blanca del saneado son p, br, b, i, u, listas y h1-h3. */
export const CLASES_CUERPO =
  "text-sm leading-relaxed text-foreground [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold " +
  "[&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold";

/**
 * El cuerpo de una nota guardada. `html` viene SIEMPRE del servidor, que lo
 * reconstruye con la lista blanca de `@/lib/document-templates/sanitize`
 * (etiquetas sin ningún atributo + texto escapado) ANTES de guardarlo: en
 * `patient_documents.body` no entra nada que no haya pasado por ahí. Por eso,
 * y solo por eso, se puede inyectar.
 */
export function NotaCuerpo({ html }: { html: string }) {
  return <div className={CLASES_CUERPO} dangerouslySetInnerHTML={{ __html: html }} />;
}
