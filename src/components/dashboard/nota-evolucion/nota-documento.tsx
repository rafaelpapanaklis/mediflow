"use client";

// La nota de evolución vista como documento. Lo que pinta —la hoja, la barra de
// acciones, la copia que se imprime— es lo COMÚN de los documentos del paciente
// (`documentos-paciente/`); aquí solo se dice que esto es una nota y a qué rutas
// pegan sus acciones.

import type { ReactNode } from "react";
import { useT } from "@/i18n/i18n-provider";
import { DocumentoVisor } from "@/components/dashboard/documentos-paciente/documento-visor";
import type { RutasDeDocumento } from "@/components/dashboard/documentos-paciente/tipos";
import type { NotaCompleta } from "./tipos";

/** Enviar pide el mismo permiso que firmar: sin él, los dos botones ni se pintan. */
export function rutasDeNota(id: string, puedeEnviar: boolean): RutasDeDocumento {
  const base = `/api/patient-documents/${encodeURIComponent(id)}`;
  return {
    pdf: `${base}/pdf`,
    whatsapp: puedeEnviar ? `${base}/whatsapp` : null,
    correo: puedeEnviar ? `${base}/email` : null,
  };
}

/** Una nota guardada (firmada, o un borrador ajeno): se lee, se imprime y se manda. */
export function NotaVisor({
  nota, canWrite, inicio,
}: { nota: NotaCompleta; canWrite: boolean; inicio?: ReactNode }) {
  const t = useT();
  return (
    <DocumentoVisor
      encabezado={nota.encabezado}
      titulo={nota.title}
      tipo={t("notaEvolucionDoc.kind")}
      html={nota.body}
      firmado={nota.status === "SIGNED"}
      rutas={rutasDeNota(nota.id, canWrite)}
      inicio={inicio}
    />
  );
}
