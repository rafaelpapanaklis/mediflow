"use client";

// La puerta de entrada al editor de documentos: SIEMPRE sin SSR (Tiptap vive
// en el DOM) y con su silueta mientras llega el paquete. Importa esto, nunca
// `./editor-documento` directo, salvo desde una prueba que monte el componente.
//
//   import { EditorDocumento } from "@/components/dashboard/editor-documento";
//   <EditorDocumento contexto="plantilla" html={body} membrete={…} tipoDocumento="Nota de evolución"
//                    marcadores={…} onChange={({ html, vacio }) => …} alListo={(api) => …} />

import dynamic from "next/dynamic";
import { EsqueletoEditor } from "./esqueleto";

export const EditorDocumento = dynamic(() => import("./editor-documento").then((m) => m.EditorDocumentoInterno), {
  ssr: false,
  loading: () => <EsqueletoEditor />,
});

export { EsqueletoEditor };
export type {
  ContextoEditor, EditorDocumentoApi, EditorDocumentoProps, EstadoEditor, MarcadorEditor, MembreteDocumento,
} from "./tipos";
