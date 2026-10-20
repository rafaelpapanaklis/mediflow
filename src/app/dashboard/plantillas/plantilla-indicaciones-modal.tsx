"use client";

// El editor de una hoja (indicaciones o constancia). Cuatro modos:
//   · nueva   — vacía, del tipo de la pestaña;
//   · editar  — una propia: nombre, texto y procedimientos. En una de fábrica
//               (ws1-t6) el nombre es fijo y el texto se guarda como versión de
//               ESTA clínica;
//   · ver     — una de fábrica sin la tabla de versiones: el texto no se toca; sí
//               la liga a procedimientos («Guardar procedimientos») y «Copiar y editar»;
//   · copia   — nueva, con el texto y la liga de la original.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";
import { marcadoresDelTipo, marcadoresDesconocidos } from "@/lib/indicaciones/marcadores";
import { conValores, useTextosIndicaciones } from "@/lib/indicaciones/textos";
import {
  MAX_CUERPO_HOJA,
  MAX_NOMBRE_HOJA,
  type HojaDTO,
  type ProcedimientoLigable,
  type TipoHoja,
} from "@/lib/indicaciones/tipos";
import { cuerpoEdicionHoja } from "./cuerpo-edicion";
import styles from "./plantillas.module.css";
import propios from "./plantillas-indicaciones.module.css";

export type ModalHoja =
  | { modo: "nueva"; tipo: TipoHoja }
  | { modo: "ver" | "editar" | "copia"; hoja: HojaDTO };

interface Props {
  modal: ModalHoja;
  procedimientos: ProcedimientoLigable[];
  nombreSugeridoDeCopia: (original: string) => string;
  onClose: () => void;
  onCopiar: (hoja: HojaDTO) => void;
  onSaved: (guardada: HojaDTO, eraNueva: boolean) => void;
  mensajeDeError: (data: unknown) => string;
}

export function PlantillaIndicacionesModal({
  modal,
  procedimientos,
  nombreSugeridoDeCopia,
  onClose,
  onCopiar,
  onSaved,
  mensajeDeError,
}: Props) {
  const tx = useTextosIndicaciones();
  const hoja = modal.modo === "nueva" ? null : modal.hoja;
  const tipo: TipoHoja = modal.modo === "nueva" ? modal.tipo : modal.hoja.tipo;
  const soloVer = modal.modo === "ver";
  const esCopia = modal.modo === "copia";
  const editando = modal.modo === "editar";
  const fabricaEditable = editando && !!hoja?.deFabrica;
  const nombreRef = useRef<HTMLInputElement>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const [nombre, setNombre] = useState(() => (esCopia && hoja ? nombreSugeridoDeCopia(hoja.nombre) : (hoja?.nombre ?? "")));
  const [cuerpo, setCuerpo] = useState(() => hoja?.cuerpo ?? "");
  const [ligados, setLigados] = useState<string[]>(() => (hoja ? [...hoja.procedureIds] : []));
  const [buscar, setBuscar] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (soloVer || fabricaEditable ? textoRef : nombreRef).current?.focus();
  }, [soloVer, fabricaEditable]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const marcadores = marcadoresDelTipo(tipo);
  const desconocidos = marcadoresDesconocidos(cuerpo);
  const conLiga = tipo === "INDICACIONES";
  const ligaCambio = hoja ? JSON.stringify([...ligados].sort()) !== JSON.stringify([...hoja.procedureIds].sort()) : false;

  // Activos primero; los inactivos solo si ya estaban ligados (para poder quitarlos).
  const opciones = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return procedimientos
      .filter((p) => p.isActive || ligados.includes(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [procedimientos, ligados, buscar]);

  function insertarMarcador(token: string) {
    if (soloVer) return;
    const el = textoRef.current;
    const ini = el?.selectionStart ?? cuerpo.length;
    const fin = el?.selectionEnd ?? ini;
    setCuerpo(cuerpo.slice(0, ini) + token + cuerpo.slice(fin));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + token.length, ini + token.length);
    });
  }

  function alternar(id: string) {
    setLigados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!soloVer) {
      if (!nombre.replace(/\s+/g, " ").trim()) {
        setError(tx.errores.NOMBRE_REQUERIDO);
        nombreRef.current?.focus();
        return;
      }
      if (!cuerpo.trim()) {
        setError(tx.errores.CUERPO_REQUERIDO);
        textoRef.current?.focus();
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const url = hoja && (editando || soloVer) ? `/api/indicaciones/plantillas/${hoja.id}` : "/api/indicaciones/plantillas";
      const cuerpoPeticion = soloVer
        ? { procedureIds: ligados }
        : editando
          ? // Solo lo que la persona cambió (ws1-t8 · P1, N-P4): ver cuerpo-edicion.ts.
            hoja
            ? cuerpoEdicionHoja(
                { nombre: hoja.nombre, cuerpo: hoja.cuerpo, procedureIds: hoja.procedureIds },
                { nombre, cuerpo, procedureIds: ligados },
                conLiga,
              )
            : { nombre, cuerpo }
          : {
              tipo,
              nombre,
              cuerpo,
              ...(conLiga ? { procedureIds: ligados } : {}),
              ...(esCopia && hoja ? { copiaDe: hoja.id } : {}),
            };
      const res = await fetch(url, {
        method: editando || soloVer ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoPeticion),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        setError(mensajeDeError(data));
        return;
      }
      onSaved(data as HojaDTO, !(editando || soloVer));
    } catch {
      setError(tx.errores.generico);
    } finally {
      setSaving(false);
    }
  }

  const titulo = soloVer ? tx.tituloVer : editando ? tx.tituloEditar : esCopia ? tx.tituloCopia : tx.tituloNueva;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={() => !saving && onClose()} aria-hidden />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="hoja-modal-titulo">
        <div className={styles.modalHead}>
          <div>
            <h2 id="hoja-modal-titulo" className={styles.modalTitle}>
              {titulo}
            </h2>
            <p className={styles.modalKind}>{tipo === "CONSTANCIA" ? tx.tipoConstancia : tx.tipoIndicaciones}</p>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} disabled={saving} aria-label={tx.cerrar}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <form className={styles.modalForm} onSubmit={guardar}>
          <div className={styles.modalBody}>
            {soloVer && <p className={styles.avisoInfo}>{tx.avisoFabrica}</p>}
            {fabricaEditable && <p className={styles.avisoInfo}>{tx.avisoFabricaEditable}</p>}
            {esCopia && <p className={styles.avisoInfo}>{tx.avisoCopia}</p>}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tx.campoNombre}</span>
              <input
                ref={nombreRef}
                className={styles.input}
                value={nombre}
                maxLength={MAX_NOMBRE_HOJA}
                disabled={soloVer || fabricaEditable}
                onChange={(e) => setNombre(e.target.value)}
              />
            </label>

            <div className={styles.field}>
              <div className={propios.campoCabecera}>
                <label className={styles.fieldLabel} htmlFor="hoja-modal-texto">
                  {tx.campoTexto}
                </label>
                {!soloVer && (
                  <DictationMic onText={(txt) => setCuerpo((p) => appendDictado(p, txt, "\n", MAX_CUERPO_HOJA))} />
                )}
              </div>
              <textarea
                id="hoja-modal-texto"
                ref={textoRef}
                className={`${styles.textarea} ${propios.textoLargo}`}
                value={cuerpo}
                maxLength={MAX_CUERPO_HOJA}
                readOnly={soloVer}
                onChange={(e) => setCuerpo(e.target.value)}
              />
              <p className={propios.ayudaCampo}>{tx.ayudaTexto}</p>
              {!soloVer && <p className={propios.ayudaCampo}>{tx.avisoRevisa}</p>}
            </div>

            {!soloVer && (
              <div className={styles.markers}>
                <p className={styles.markersTitle}>{tx.marcadoresTitulo}</p>
                <p className={styles.markersHelp}>{tx.marcadoresAyuda}</p>
                <ul className={styles.markerList}>
                  {marcadores.map((m) => (
                    <li key={m.token}>
                      <button
                        type="button"
                        className={styles.markerBtn}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => insertarMarcador(m.token)}
                        title={tx.marcadores[m.clave]}
                      >
                        <span className={styles.markerToken}>{m.token}</span>
                        <span className={styles.markerLabel}>{tx.marcadores[m.clave]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {desconocidos.length > 0 && !soloVer && (
              <p className={styles.aviso} role="status">
                {conValores(tx.marcadorDesconocido, { lista: desconocidos.join(", ") })}
              </p>
            )}

            {conLiga && (
              <div className={styles.field}>
                <span className={styles.fieldLabel} id="hoja-modal-proc">
                  {tx.campoProcedimientos}
                </span>
                <div className={propios.proc} role="group" aria-labelledby="hoja-modal-proc">
                  {procedimientos.length === 0 ? (
                    <p className={propios.procVacio}>{tx.sinCatalogo}</p>
                  ) : (
                    <>
                      <label className={propios.procBuscar}>
                        <Search size={15} aria-hidden />
                        <input
                          type="search"
                          value={buscar}
                          onChange={(e) => setBuscar(e.target.value)}
                          placeholder={tx.buscarProcedimiento}
                          aria-label={tx.buscarProcedimiento}
                        />
                      </label>
                      <ul className={propios.procLista}>
                        {opciones.map((p) => (
                          <li key={p.id}>
                            <label className={propios.procItem}>
                              <input type="checkbox" checked={ligados.includes(p.id)} onChange={() => alternar(p.id)} />
                              <span>
                                {p.name}
                                {!p.isActive && <span className={propios.procInactivo}> · {tx.procedimientoInactivo}</span>}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {ligados.length > 0 && (
                        <p className={propios.procElegidos}>
                          {conValores(tx.ligadaA, {
                            lista: procedimientos
                              .filter((p) => ligados.includes(p.id))
                              .map((p) => p.name)
                              .join(", "),
                          })}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>

          <div className={styles.modalFoot}>
            <button type="button" className={styles.btnGhost} onClick={onClose} disabled={saving}>
              {soloVer ? tx.cerrar : tx.cancelar}
            </button>
            {soloVer && hoja && (
              <button type="button" className={styles.btnGhost} onClick={() => onCopiar(hoja)} disabled={saving}>
                {tx.copiar}
              </button>
            )}
            {(!soloVer || (conLiga && ligaCambio)) && (
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {saving ? tx.guardando : soloVer ? tx.guardarLiga : tx.guardar}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
