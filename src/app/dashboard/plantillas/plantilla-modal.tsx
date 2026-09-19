"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Underline,
  X,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MAX_NAME_LENGTH, type DocumentTemplateKindValue } from "@/lib/document-templates/kinds";
import { DOCUMENT_MARKERS } from "@/lib/document-templates/markers";
import { sanitizeTemplateHtml } from "@/lib/document-templates/sanitize";
import type { PlantillaFila } from "./plantillas-client";
import styles from "./plantillas.module.css";

interface Props {
  kind: DocumentTemplateKindValue;
  editing: PlantillaFila | null;
  onClose: () => void;
  onSaved: (guardada: PlantillaFila, eraNueva: boolean) => void;
  mensajeDeError: (data: unknown) => string;
}

// Un recuadro de texto con lo básico, y nada más: no es un procesador de
// textos. Cada botón es una orden de edición del navegador sobre el
// contenteditable. Lo que salga de aquí NO es de fiar por sí mismo: el
// servidor lo vuelve a pasar por la lista blanca al guardar
// (src/lib/document-templates/sanitize.ts) y devuelve lo que de verdad guardó.
interface Herramienta {
  id: string;
  icon: LucideIcon;
  comando: string;
  valor?: string;
  /** Para `queryCommandState`; los de bloque se miran con `formatBlock`. */
  estado?: boolean;
}

const HERRAMIENTAS: readonly (Herramienta | "sep")[] = [
  { id: "negrita", icon: Bold, comando: "bold", estado: true },
  { id: "cursiva", icon: Italic, comando: "italic", estado: true },
  { id: "subrayado", icon: Underline, comando: "underline", estado: true },
  "sep",
  { id: "titulo1", icon: Heading1, comando: "formatBlock", valor: "h1" },
  { id: "titulo2", icon: Heading2, comando: "formatBlock", valor: "h2" },
  { id: "titulo3", icon: Heading3, comando: "formatBlock", valor: "h3" },
  { id: "parrafo", icon: Pilcrow, comando: "formatBlock", valor: "p" },
  "sep",
  { id: "lista", icon: List, comando: "insertUnorderedList", estado: true },
  { id: "listaNumerada", icon: ListOrdered, comando: "insertOrderedList", estado: true },
];

const TITULO_KEY: Record<DocumentTemplateKindValue, string> = {
  NOTA_EVOLUCION: "pages.plantillas.nuevaNota",
  CONSENTIMIENTO: "pages.plantillas.nuevaConsentimiento",
};
const KIND_KEY: Record<DocumentTemplateKindValue, string> = {
  NOTA_EVOLUCION: "pages.plantillas.kindNota",
  CONSENTIMIENTO: "pages.plantillas.kindConsentimiento",
};

export function PlantillaModal({ kind, editing, onClose, onSaved, mensajeDeError }: Props) {
  const t = useT();
  const editorRef = useRef<HTMLDivElement>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  const seleccion = useRef<Range | null>(null);
  const [name, setName] = useState(editing?.name ?? "");
  const [vacio, setVacio] = useState(!editing);
  const [activos, setActivos] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El cuerpo inicial viene del servidor, ya saneado al guardarse; se vuelve a
  // sanear aquí porque esto es un innerHTML y una fila puede haber llegado a la
  // base por otro camino (un seed, una migración). Se pone una sola vez:
  // después manda lo que la persona escribe, no React.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = sanitizeTemplateHtml(editing?.body ?? "");
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
      // <b>/<i>/<u> y no <span style>: la lista blanca tira los atributos, y el
      // formato se perdería al guardar sin que nadie lo notara.
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* navegadores que no lo conocen: el servidor convierte <div> en <p> */
    }
    nombreRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  function leerEstado() {
    const el = editorRef.current;
    if (!el) return;
    setVacio((el.textContent ?? "").trim().length === 0 && !el.querySelector("li"));
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      seleccion.current = sel.getRangeAt(0).cloneRange();
    }
    const nuevo: Record<string, boolean> = {};
    let bloque = "";
    try {
      bloque = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
    } catch {
      /* sin soporte: los botones de bloque no se marcan, pero funcionan */
    }
    for (const h of HERRAMIENTAS) {
      if (h === "sep") continue;
      try {
        nuevo[h.id] = h.estado ? document.queryCommandState(h.comando) : bloque === h.valor;
      } catch {
        nuevo[h.id] = false;
      }
    }
    setActivos(nuevo);
  }

  function devolverSeleccion() {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (seleccion.current && el.contains(seleccion.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(seleccion.current);
    } else {
      // Nunca se ha puesto el cursor: se escribe al final.
      const fin = document.createRange();
      fin.selectNodeContents(el);
      fin.collapse(false);
      sel.removeAllRanges();
      sel.addRange(fin);
    }
  }

  function ejecutar(h: Herramienta) {
    devolverSeleccion();
    // Pulsar un título que ya está puesto lo devuelve a texto normal.
    const valor = h.comando === "formatBlock" && activos[h.id] && h.valor !== "p" ? "p" : h.valor;
    document.execCommand(h.comando, false, valor);
    leerEstado();
  }

  function insertarMarcador(token: string) {
    devolverSeleccion();
    document.execCommand("insertText", false, token);
    leerEstado();
  }

  // Pegar desde Word o una web trae estilos, tablas e imágenes. Aquí entra
  // solo el texto; el formato se pone con los botones.
  function alPegar(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const texto = e.clipboardData.getData("text/plain");
    if (texto) document.execCommand("insertText", false, texto);
    leerEstado();
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const nombre = name.replace(/\s+/g, " ").trim();
    if (!nombre) {
      setError(t("pages.plantillas.errores.NAME_REQUIRED"));
      nombreRef.current?.focus();
      return;
    }
    if (vacio) {
      setError(t("pages.plantillas.errores.BODY_REQUIRED"));
      editorRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = editorRef.current?.innerHTML ?? "";
      const res = await fetch(editing ? `/api/document-templates/${editing.id}` : "/api/document-templates", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { name: nombre, body } : { kind, name: nombre, body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        setError(mensajeDeError(data));
        return;
      }
      // Se guarda en pantalla lo que DEVOLVIÓ el servidor (ya saneado), no lo que se envió.
      onSaved(
        {
          id: data.id,
          kind: data.kind,
          name: data.name,
          body: data.body,
          isActive: data.isActive,
          updatedAt: data.updatedAt,
        },
        !editing,
      );
    } catch {
      setError(t("pages.plantillas.errores.generico"));
    } finally {
      setSaving(false);
    }
  }

  const titulo = editing ? t("pages.plantillas.editar") : t(TITULO_KEY[kind]);

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={() => !saving && onClose()} aria-hidden />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="plantilla-modal-titulo">
        <div className={styles.modalHead}>
          <div>
            <h2 id="plantilla-modal-titulo" className={styles.modalTitle}>{titulo}</h2>
            {editing && <p className={styles.modalKind}>{t(KIND_KEY[kind])}</p>}
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} disabled={saving} aria-label={t("pages.plantillas.cerrar")}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <form className={styles.modalForm} onSubmit={guardar}>
          <div className={styles.modalBody}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("pages.plantillas.campoNombre")}</span>
              <input
                ref={nombreRef}
                className={styles.input}
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("pages.plantillas.campoNombrePlaceholder")}
              />
            </label>

            <div className={styles.field}>
              <span className={styles.fieldLabel} id="plantilla-editor-label">{t("pages.plantillas.campoTexto")}</span>
              <div className={styles.editorBox}>
                <div className={styles.toolbar} role="toolbar" aria-label={t("pages.plantillas.campoTexto")}>
                  {HERRAMIENTAS.map((h, i) =>
                    h === "sep" ? (
                      <span key={`sep-${i}`} className={styles.toolbarSep} aria-hidden />
                    ) : (
                      <button
                        key={h.id}
                        type="button"
                        className={`${styles.toolBtn} ${activos[h.id] ? styles.toolBtnActive : ""}`}
                        // mousedown y no click: así el recuadro no pierde el cursor.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          ejecutar(h);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            ejecutar(h);
                          }
                        }}
                        aria-pressed={Boolean(activos[h.id])}
                        title={t(`pages.plantillas.barra.${h.id}`)}
                        aria-label={t(`pages.plantillas.barra.${h.id}`)}
                      >
                        <h.icon size={16} aria-hidden />
                      </button>
                    ),
                  )}
                </div>
                <div
                  ref={editorRef}
                  className={`${styles.editor} ${vacio ? styles.editorEmpty : ""}`}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-labelledby="plantilla-editor-label"
                  data-placeholder={t("pages.plantillas.editorPlaceholder")}
                  onInput={leerEstado}
                  onKeyUp={leerEstado}
                  onMouseUp={leerEstado}
                  onBlur={leerEstado}
                  onPaste={alPegar}
                />
              </div>
            </div>

            <div className={styles.markers}>
              <p className={styles.markersTitle}>{t("pages.plantillas.marcadoresTitulo")}</p>
              <p className={styles.markersHelp}>{t("pages.plantillas.marcadoresAyuda")}</p>
              <ul className={styles.markerList}>
                {DOCUMENT_MARKERS.map((m) => (
                  <li key={m.token}>
                    <button
                      type="button"
                      className={styles.markerBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertarMarcador(m.token);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          insertarMarcador(m.token);
                        }
                      }}
                      title={t(`pages.plantillas.marcadores.${m.labelKey}`)}
                    >
                      <span className={styles.markerToken}>{m.token}</span>
                      <span className={styles.markerLabel}>{t(`pages.plantillas.marcadores.${m.labelKey}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className={styles.error} role="alert">{error}</p>}
          </div>

          <div className={styles.modalFoot}>
            <button type="button" className={styles.btnGhost} onClick={onClose} disabled={saving}>
              {t("pages.plantillas.cancelar")}
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {t(saving ? "pages.plantillas.guardando" : "pages.plantillas.guardar")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
