"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tag, X } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import { MAX_NAME_LENGTH, type DocumentTemplateKindValue } from "@/lib/document-templates/kinds";
import { marcadoresPara } from "@/lib/document-templates/markers";
import { HOJA_CARTA, PPP } from "@/lib/documentos/hoja-carta";
import {
  EditorDocumento, type EditorDocumentoApi, type EstadoEditor, type MarcadorEditor, type MembreteDocumento,
} from "@/components/dashboard/editor-documento";
import type { PlantillaFila } from "./plantillas-client";
import { esPrecargada } from "./tarjeta";
import styles from "./plantillas.module.css";

interface Props {
  kind: DocumentTemplateKindValue;
  editing: PlantillaFila | null;
  /** El membrete de la clínica (nombre, logo, dirección, teléfono, fecha de hoy), para la hoja. */
  membrete: MembreteDocumento;
  onClose: () => void;
  onSaved: (guardada: PlantillaFila, eraNueva: boolean) => void;
  mensajeDeError: (data: unknown) => string;
}

// El editor de una plantilla es la HOJA en que va a salir (ws1-t10, editor de
// texto nuevo): pantalla completa, membrete de la clínica en todas las páginas,
// barra completa y marcadores como fichas. Lo que viaja al servidor es el HTML
// normalizado al contrato (`[NOMBRE_PACIENTE]` en texto, etiquetas de la lista
// blanca); el servidor lo vuelve a pasar por su lista blanca al guardar y
// devuelve lo que de verdad guardó. Las plantillas viejas (p/h1-h3/listas/b/i/u)
// abren idénticas: son el mismo formato.
//
// Salamanca (ws1-t6/t8): `body` solo viaja si cambió respecto a lo que se cargó,
// acompañado de `baseBody` (el servidor lo compara con lo vigente para que una
// pestaña vieja no pise lo de otra persona). Eso se conserva tal cual.

const TITULO_KEY: Record<DocumentTemplateKindValue, string> = {
  NOTA_EVOLUCION: "pages.plantillas.nuevaNota",
  CONSENTIMIENTO: "pages.plantillas.nuevaConsentimiento",
};
const KIND_KEY: Record<DocumentTemplateKindValue, string> = {
  NOTA_EVOLUCION: "pages.plantillas.kindNota",
  CONSENTIMIENTO: "pages.plantillas.kindConsentimiento",
};

const cm = (px: number) => ((px / PPP) * 2.54).toFixed(1);

export function PlantillaModal({ kind, editing, membrete, onClose, onSaved, mensajeDeError }: Props) {
  const t = useT();
  const askConfirm = useConfirm();
  const nombreRef = useRef<HTMLInputElement>(null);
  const api = useRef<EditorDocumentoApi | null>(null);
  // Lo último que el editor serializó, normalizado; y cómo estaba al abrir:
  // solo si cambia se manda el texto (una pestaña vieja no pisa lo de otra persona).
  const estado = useRef<EstadoEditor>({ html: "", vacio: !editing });
  const inicialRef = useRef<string | null>(null);
  const [name, setName] = useState(editing?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paginas, setPaginas] = useState(1);

  const tipoKind = editing?.kind ?? kind;
  const ejemplos: Record<string, string> = {
    NOMBRE_CLINICA: membrete.clinicaNombre,
    FECHA: membrete.fecha,
  };
  const marcadores: MarcadorEditor[] = marcadoresPara(tipoKind).map((m) => {
    const clave = m.token.replace(/^\[|\]$/g, "");
    return {
      clave,
      etiqueta: t(`pages.plantillas.marcadores.${m.labelKey}`),
      ejemplo: ejemplos[clave] ?? t(`editorDocumento.ejemplos.${clave}`),
    };
  });

  const alCambiar = useCallback((e: EstadoEditor) => {
    estado.current = e;
    if (inicialRef.current === null) inicialRef.current = e.html;
  }, []);

  const hayCambios = () =>
    name !== (editing?.name ?? "") || (inicialRef.current !== null && estado.current.html !== inicialRef.current);

  const cerrar = useCallback(async () => {
    if (saving) return;
    if (hayCambios()) {
      const ok = await askConfirm({
        title: t("pages.plantillas.cerrarSinGuardar"),
        description: t("pages.plantillas.cerrarSinGuardarTexto"),
        confirmText: t("pages.plantillas.cerrarDeTodosModos"),
        variant: "warning",
      });
      if (!ok) return;
    }
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, name, editing, onClose, askConfirm, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        // Un desplegable del editor abierto se cierra con su propio Escape; aquí solo si no hay ninguno.
        if (document.querySelector('[role="menu"]')) return;
        void cerrar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cerrar, saving]);

  useEffect(() => {
    if (!editing) nombreRef.current?.focus();
  }, [editing]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const nombre = name.replace(/\s+/g, " ").trim();
    if (!nombre) {
      setError(t("pages.plantillas.errores.NAME_REQUIRED"));
      nombreRef.current?.focus();
      return;
    }
    const body = api.current?.obtenerHtml() ?? estado.current.html;
    const vacio = api.current?.estaVacio() ?? estado.current.vacio;
    if (vacio) {
      setError(t("pages.plantillas.errores.BODY_REQUIRED"));
      api.current?.enfocar();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cambioTexto = inicialRef.current === null || body !== inicialRef.current;
      const res = await fetch(editing ? `/api/document-templates/${editing.id}` : "/api/document-templates", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { name: nombre, ...(cambioTexto ? { body, baseBody: editing.body } : {}) }
            : { kind, name: nombre, body },
        ),
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
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          precargada: esPrecargada(data.createdById),
          restaurable: data.restaurable === true,
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
  const tipoDocumento = t(KIND_KEY[tipoKind]);

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} aria-hidden />
      <div className={styles.lienzo} role="dialog" aria-modal="true" aria-labelledby="plantilla-modal-titulo">
        <header className={styles.lienzoCabecera}>
          <div className={styles.lienzoTitulos}>
            <h2 id="plantilla-modal-titulo" className={styles.modalTitle}>{titulo}</h2>
            <p className={styles.modalKind}>{tipoDocumento}</p>
          </div>
          <div className={styles.lienzoAcciones}>
            <button type="button" className={styles.btnGhost} onClick={() => void cerrar()} disabled={saving}>
              {t("pages.plantillas.cancelar")}
            </button>
            <button type="submit" form="plantilla-form" className={styles.btnPrimary} disabled={saving}>
              {t(saving ? "pages.plantillas.guardando" : "pages.plantillas.guardar")}
            </button>
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => void cerrar()}
              disabled={saving}
              aria-label={t("pages.plantillas.cerrar")}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </header>

        {error && (
          <p className={`${styles.error} ${styles.lienzoError}`} role="alert">
            {error}
          </p>
        )}

        <form id="plantilla-form" className={styles.lienzoCuerpo} onSubmit={guardar}>
          <div className={styles.lienzoMesa}>
            <span className="sr-only" id="plantilla-editor-label">{t("pages.plantillas.campoTexto")}</span>
            <EditorDocumento
              contexto="plantilla"
              html={editing?.body ?? ""}
              membrete={membrete}
              tipoDocumento={tipoDocumento}
              titulo={
                <input
                  ref={nombreRef}
                  className={styles.tituloHoja}
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("pages.plantillas.campoNombrePlaceholder")}
                  aria-label={t("pages.plantillas.nombreEnHoja")}
                  disabled={saving}
                />
              }
              marcadores={marcadores}
              onChange={alCambiar}
              onPaginas={setPaginas}
              alListo={(a) => {
                api.current = a;
              }}
              // P4 (ws1-t6) conecta aquí la subida real (`onSubirImagen`); sin ella el botón de imagen no sale.
              desactivado={saving}
              autoFoco={Boolean(editing)}
              idEtiqueta="plantilla-editor-label"
            />
          </div>

          <aside className={styles.lienzoRail}>
            <section className={styles.railTarjeta}>
              <h3 className={styles.railTitulo}>{t("pages.plantillas.marcadoresTitulo")}</h3>
              <p className={styles.markersHelp}>{t("pages.plantillas.marcadoresAyuda")}</p>
              <div className={styles.fichas}>
                {marcadores.map((m) => (
                  <button
                    type="button"
                    key={m.clave}
                    className={styles.ficha}
                    data-marcador={m.clave}
                    title={`[${m.clave}] · ${m.ejemplo}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => api.current?.insertarMarcador(m.clave)}
                    disabled={saving}
                  >
                    <Tag size={13} aria-hidden />
                    {m.etiqueta}
                  </button>
                ))}
              </div>
            </section>
            <section className={styles.railTarjeta}>
              <h3 className={styles.railTitulo}>{t("pages.plantillas.hojaTitulo")}</h3>
              <div className={styles.dato}><span>{t("pages.plantillas.hojaTamano")}</span><b>{t("pages.plantillas.hojaTamanoValor")}</b></div>
              <div className={styles.dato}>
                <span>{t("pages.plantillas.hojaMargenes")}</span>
                <b>{t("pages.plantillas.hojaMargenesValor", { arriba: cm(HOJA_CARTA.margenSuperior), lados: cm(HOJA_CARTA.margenLateral) })}</b>
              </div>
              <div className={styles.dato}>
                <span>{t("pages.plantillas.hojaPaginas")}</span>
                <b data-paginas={paginas}>{paginas > 0 ? paginas : t("pages.plantillas.hojaPaginasFluida")}</b>
              </div>
            </section>
            <p className={styles.markerNota}>{t("pages.plantillas.editorAyuda")}</p>
          </aside>
        </form>
      </div>
    </div>
  );
}
