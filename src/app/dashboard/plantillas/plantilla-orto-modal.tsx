"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import {
  MARCADORES_NOTA,
  MAX_NOMBRE_NOTA,
  MAX_TEXTO_SECCION,
  SECCIONES_SOAP,
  marcadoresDesconocidos,
  type CuerpoSoap,
  type SeccionSoap,
} from "@/lib/orthodontics/plantillas-nota";
import type { PlantillaNotaDTO } from "@/lib/orthodontics/plantillas-nota-service";
import type { ModalOrto } from "./plantillas-orto";
import styles from "./plantillas.module.css";

interface Props {
  modal: ModalOrto;
  nombreSugeridoDeCopia: (original: string) => string;
  onClose: () => void;
  /** Desde la vista de una de fábrica: pasar a «Copiar y editar». */
  onCopiar: (fila: PlantillaNotaDTO) => void;
  onSaved: (guardada: PlantillaNotaDTO, eraNueva: boolean) => void;
  mensajeDeError: (data: unknown) => string;
}

const VACIO: CuerpoSoap = { S: "", O: "", A: "", P: "" };

export function PlantillaOrtoModal({ modal, nombreSugeridoDeCopia, onClose, onCopiar, onSaved, mensajeDeError }: Props) {
  const t = useT();
  const fila = modal.modo === "nueva" ? null : modal.fila;
  const soloVer = modal.modo === "ver";
  const esCopia = modal.modo === "copia";
  const editando = modal.modo === "editar";
  const nombreRef = useRef<HTMLInputElement>(null);
  const campos = useRef<Partial<Record<SeccionSoap, HTMLTextAreaElement | null>>>({});
  const ultimo = useRef<SeccionSoap>("S");
  const [name, setName] = useState(() => (esCopia && fila ? nombreSugeridoDeCopia(fila.name) : (fila?.name ?? "")));
  const [soap, setSoap] = useState<CuerpoSoap>(() => (fila ? { ...fila.soap } : { ...VACIO }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nombreRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const desconocidos = marcadoresDesconocidos(soap);

  function insertarMarcador(token: string) {
    if (soloVer) return;
    const seccion = ultimo.current;
    const el = campos.current[seccion];
    const ini = el?.selectionStart ?? soap[seccion].length;
    const fin = el?.selectionEnd ?? ini;
    const nuevo = soap[seccion].slice(0, ini) + token + soap[seccion].slice(fin);
    setSoap((prev) => ({ ...prev, [seccion]: nuevo }));
    // El cursor queda justo después del marcador.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + token.length, ini + token.length);
    });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (saving || soloVer) return;
    const nombre = name.replace(/\s+/g, " ").trim();
    if (!nombre) {
      setError(t("pages.plantillas.errores.NAME_REQUIRED"));
      nombreRef.current?.focus();
      return;
    }
    if (SECCIONES_SOAP.every((s) => soap[s].trim() === "")) {
      setError(t("pages.plantillas.orto.errores.SOAP_EMPTY"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(editando && fila ? `/api/orthodontics/note-templates/${fila.id}` : "/api/orthodontics/note-templates", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editando ? { name: nombre, soap } : { name: nombre, soap, ...(esCopia && fila ? { copiaDe: fila.id } : {}) },
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        setError(mensajeDeError(data));
        return;
      }
      onSaved(data as PlantillaNotaDTO, !editando);
    } catch {
      setError(t("pages.plantillas.errores.generico"));
    } finally {
      setSaving(false);
    }
  }

  const titulo = soloVer
    ? t("pages.plantillas.orto.ver")
    : editando
      ? t("pages.plantillas.editar")
      : esCopia
        ? t("pages.plantillas.orto.tituloCopia")
        : t("pages.plantillas.orto.nueva");

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={() => !saving && onClose()} aria-hidden />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="plantilla-orto-titulo">
        <div className={styles.modalHead}>
          <div>
            <h2 id="plantilla-orto-titulo" className={styles.modalTitle}>{titulo}</h2>
            <p className={styles.modalKind}>{t("pages.plantillas.orto.tipo")}</p>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} disabled={saving} aria-label={t("pages.plantillas.cerrar")}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <form className={styles.modalForm} onSubmit={guardar}>
          <div className={styles.modalBody}>
            {soloVer && <p className={styles.avisoInfo}>{t("pages.plantillas.orto.avisoFabrica")}</p>}
            {esCopia && <p className={styles.avisoInfo}>{t("pages.plantillas.orto.avisoCopia")}</p>}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("pages.plantillas.campoNombre")}</span>
              <input
                ref={nombreRef}
                className={styles.input}
                value={name}
                maxLength={MAX_NOMBRE_NOTA}
                disabled={soloVer}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("pages.plantillas.orto.nombrePlaceholder")}
              />
            </label>

            {SECCIONES_SOAP.map((s) => (
              <label key={s} className={styles.field}>
                <span className={styles.fieldLabel}>
                  <span className={styles.seccionLetra}>{s}</span>
                  {t(`pages.plantillas.orto.seccion.${s}`)}
                </span>
                <textarea
                  ref={(el) => {
                    campos.current[s] = el;
                  }}
                  className={styles.textarea}
                  value={soap[s]}
                  maxLength={MAX_TEXTO_SECCION}
                  disabled={soloVer}
                  rows={s === "P" ? 5 : 3}
                  onFocus={() => {
                    ultimo.current = s;
                  }}
                  onChange={(e) => setSoap((prev) => ({ ...prev, [s]: e.target.value }))}
                />
              </label>
            ))}

            <div className={styles.markers}>
              <p className={styles.markersTitle}>{t("pages.plantillas.orto.marcadoresTitulo")}</p>
              <p className={styles.markersHelp}>{t("pages.plantillas.orto.marcadoresAyuda")}</p>
              <ul className={styles.markerList}>
                {MARCADORES_NOTA.map((m) => (
                  <li key={m.token}>
                    <button
                      type="button"
                      className={styles.markerBtn}
                      disabled={soloVer}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertarMarcador(m.token)}
                      title={t(`pages.plantillas.orto.marcadores.${m.labelKey}`)}
                    >
                      <span className={styles.markerToken}>{m.token}</span>
                      <span className={styles.markerLabel}>{t(`pages.plantillas.orto.marcadores.${m.labelKey}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className={styles.markerNota}>{t("pages.plantillas.orto.marcadoresHueco")}</p>
            </div>

            {desconocidos.length > 0 && !soloVer && (
              <p className={styles.aviso} role="status">
                {t("pages.plantillas.orto.marcadorDesconocido", { lista: desconocidos.map((d) => `{{${d}}}`).join(", ") })}
              </p>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
          </div>

          <div className={styles.modalFoot}>
            <button type="button" className={styles.btnGhost} onClick={onClose} disabled={saving}>
              {t(soloVer ? "pages.plantillas.cerrar" : "pages.plantillas.cancelar")}
            </button>
            {soloVer && fila ? (
              <button type="button" className={styles.btnPrimary} onClick={() => onCopiar(fila)}>
                {t("pages.plantillas.orto.copiarYEditar")}
              </button>
            ) : (
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {t(saving ? "pages.plantillas.guardando" : "pages.plantillas.guardar")}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
