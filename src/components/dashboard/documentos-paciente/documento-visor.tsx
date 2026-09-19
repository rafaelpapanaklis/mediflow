"use client";

// El VISOR de un documento guardado: la barra de acciones arriba, fuera de la
// hoja, y debajo la hoja sobre su mesa. Además pinta la copia que se imprime
// (ver `impresion.ts`): la misma hoja, sin barra, en un portal a <body>.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DocumentoAcciones } from "./documento-acciones";
import { CLASES_DOCUMENTO, DocumentoCuerpo, DocumentoHoja, DocumentoMesa, DocumentoRaiz } from "./documento-hoja";
import { ATRIBUTO_IMPRESION, CSS_IMPRESION } from "./impresion";
import type { EncabezadoDocumento, RutasDeDocumento } from "./tipos";

export function DocumentoVisor({
  encabezado, titulo, tipo, html, firmado, rutas, inicio,
}: {
  encabezado: EncabezadoDocumento;
  titulo: string;
  tipo: string;
  /** HTML saneado por el servidor, tal y como se guardó. */
  html: string;
  firmado: boolean;
  rutas: RutasDeDocumento;
  inicio?: ReactNode;
}) {
  // El portal necesita <body>: solo en el cliente, después de montar.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const hoja = (
    <DocumentoHoja encabezado={encabezado} titulo={titulo} tipo={tipo} firmado={firmado}>
      <DocumentoCuerpo html={html} />
    </DocumentoHoja>
  );

  return (
    <DocumentoRaiz>
      <DocumentoMesa>
        <DocumentoAcciones rutas={rutas} puedeEnviar={firmado} inicio={inicio} />
        {hoja}
      </DocumentoMesa>
      {montado
        ? createPortal(
            // La copia de papel lleva SOLO la hoja: aquí no se monta la barra.
            <div className={CLASES_DOCUMENTO} {...{ [ATRIBUTO_IMPRESION]: "" }}>
              <style dangerouslySetInnerHTML={{ __html: CSS_IMPRESION }} />
              {hoja}
            </div>,
            document.body,
          )
        : null}
    </DocumentoRaiz>
  );
}
