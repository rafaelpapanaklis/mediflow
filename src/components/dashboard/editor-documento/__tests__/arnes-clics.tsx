// El arnés que monta el editor REAL en Chromium para `clics-chromium.test.ts`.
// Dos escenarios, por la URL: `?e=editor` (EditorDocumento solo, con el HTML
// que llegue en `html`) y `?e=modal` (el modal de Plantillas entero, con la fila
// que llegue en `editing`). Lo que el editor emite se deja en `window.__estado`
// para que la prueba lo lea; nada de esto se usa en el producto.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { PlantillaModal } from "@/app/dashboard/plantillas/plantilla-modal";
import type { PlantillaFila } from "@/app/dashboard/plantillas/plantillas-client";
import { EditorDocumentoInterno } from "../editor-documento";
import type { EditorDocumentoApi, EstadoEditor, MarcadorEditor, MembreteDocumento } from "../tipos";

declare global {
  interface Window {
    __estado?: EstadoEditor;
    __paginas?: number;
    __api?: EditorDocumentoApi;
    __cerrado?: boolean;
    __guardado?: unknown;
    __subidas?: string[];
  }
}

const params = new URLSearchParams(window.location.search);
const escenario = params.get("e") ?? "editor";

const MEMBRETE: MembreteDocumento = {
  clinicaNombre: "Clínica de Prueba QA",
  logoUrl: null,
  clinicaDireccion: "Av. Reforma 1234, Col. Centro, Guadalajara",
  clinicaTelefono: "33 1234 5678",
  fecha: "21 de octubre de 2026",
};

const MARCADORES: MarcadorEditor[] = [
  { clave: "NOMBRE_PACIENTE", etiqueta: "Nombre del paciente", ejemplo: "María Fernanda López Ruiz" },
  { clave: "EDAD_PACIENTE", etiqueta: "Edad del paciente", ejemplo: "34 años" },
  { clave: "EXPEDIENTE_PACIENTE", etiqueta: "Número de expediente", ejemplo: "P0142" },
  { clave: "NOMBRE_DOCTOR", etiqueta: "Nombre del doctor", ejemplo: "Dra. Ana Sofía Beltrán" },
  { clave: "CEDULA_DOCTOR", etiqueta: "Cédula profesional del doctor", ejemplo: "12345678" },
  { clave: "NOMBRE_CLINICA", etiqueta: "Nombre de la clínica", ejemplo: MEMBRETE.clinicaNombre },
  { clave: "FECHA", etiqueta: "Fecha", ejemplo: MEMBRETE.fecha },
];

function Editor() {
  const [, setN] = useState(0);
  const conImagen = params.get("imagen") === "1";
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", padding: 8, boxSizing: "border-box" }}>
      <EditorDocumentoInterno
        contexto="plantilla"
        html={params.get("html") ?? ""}
        membrete={MEMBRETE}
        tipoDocumento="Nota de evolución"
        titulo={<h2 style={{ margin: "4px 0 0", fontSize: 26 }}>Control de resina</h2>}
        marcadores={MARCADORES}
        onChange={(e) => {
          window.__estado = e;
          setN((v) => v + 1);
        }}
        onPaginas={(p) => {
          window.__paginas = p;
        }}
        alListo={(api) => {
          window.__api = api;
        }}
        onSubirImagen={
          conImagen
            ? async (archivo) => {
                (window.__subidas ??= []).push(`${archivo.name}:${archivo.type}:${archivo.size}`);
                return { clave: "documentos/cl_qa/subida-1.webp" };
              }
            : undefined
        }
        autoFoco
      />
    </div>
  );
}

function Modal() {
  const editing = params.get("editing") ? (JSON.parse(params.get("editing")!) as PlantillaFila) : null;
  const [abierto, setAbierto] = useState(true);
  if (!abierto) return <p id="cerrado">cerrado</p>;
  return (
    <PlantillaModal
      kind={(params.get("kind") as "NOTA_EVOLUCION" | "CONSENTIMIENTO") ?? "NOTA_EVOLUCION"}
      editing={editing}
      membrete={MEMBRETE}
      onClose={() => {
        window.__cerrado = true;
        setAbierto(false);
      }}
      onSaved={(fila) => {
        window.__guardado = fila;
        setAbierto(false);
      }}
      mensajeDeError={(data) => `error:${JSON.stringify(data)}`}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <Toaster />
    {escenario === "modal" ? <Modal /> : <Editor />}
  </>,
);
