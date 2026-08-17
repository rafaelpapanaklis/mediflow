"use client";
/* ============================================================
   El editor de secciones, fotos y textos SE DIBUJA SOLO desde
   el manifiesto de la plantilla activa (_shared/template-manifest).

   Este archivo no conoce ninguna plantilla por su nombre. Añadir
   una novena solo requiere escribir su manifiesto.
   ============================================================ */
import { useMemo, useRef, useState } from "react";
import { ImageIcon, Loader2, Lock, Trash2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import {
  manifestOf,
  type ManifestPhotoSlot,
  type TemplateManifest,
  type ZonaFoto,
} from "@/app/[slug]/_shared/template-manifest";
import type { SectionState } from "@/app/[slug]/_shared/landing-data";

const CARD = "bg-card border border-[color:var(--border-soft)] rounded-[var(--radius-lg)] shadow-[var(--shadow-1)]";
const ITEM = "border border-[color:var(--border-soft)] rounded-[var(--radius-lg)] p-4";
const INPUT = "w-full bg-[color:var(--bg-elev)] text-sm text-[color:var(--text-1)] border border-[color:var(--border-soft)] rounded-[var(--radius)] px-3 py-2.5 placeholder:text-[color:var(--text-4)] transition-colors duration-150";
const LABEL = "text-[13px] font-medium text-[color:var(--text-2)] block mb-1";
const HELP = "text-xs text-[color:var(--text-3)]";
const H_SEC = "text-[15px] font-semibold text-[color:var(--text-1)]";
const BTN_SAVE = "w-full inline-flex items-center justify-center h-11 rounded-[var(--radius)] text-sm font-semibold text-white bg-brand-600 shadow-[var(--shadow-1)] hover:bg-brand-700 active:scale-[0.99] transition disabled:opacity-[.45] disabled:cursor-not-allowed";

export interface ManifestEditorProps {
  templateId: string;
  /** landingSections tal como está guardado. */
  sections: SectionState[];
  /** landingPhotos tal como está guardado. */
  photos: Record<string, string>;
  saving: boolean;
  onSaveSections: (secciones: SectionState[]) => Promise<void> | void;
  onSavePhotos: (fotos: Record<string, string>) => Promise<void> | void;
  /**
   * Cambio SIN guardar, para la vista previa en vivo. Se dispara solo
   * cuando la clínica toca algo — nunca al montar: el estado inicial se
   * completa contra el manifiesto y no coincide con lo guardado, así que
   * avisarlo de entrada encendería el aviso de "sin guardar" sin motivo.
   */
  onDraftSections?: (secciones: SectionState[]) => void;
  /** Sube el archivo y devuelve la URL pública. */
  onUpload: (file: File, slotId: string) => Promise<string>;
}

/* ============================================================
   Diagrama de la plantilla con la zona de la foto resaltada.
   Se dibuja desde el manifiesto: las bandas son sus secciones,
   en su orden actual. Así la clínica ve DÓNDE va a salir la foto
   antes de subirla.
   ============================================================ */
function TemplateDiagram({
  manifest, orden, slot,
}: {
  manifest: TemplateManifest;
  orden: string[];
  slot: ManifestPhotoSlot;
}) {
  const bandas = ["hero", ...orden];
  const alto = 8 + bandas.length * 13;
  const zonaRect = (zona: ZonaFoto) => {
    if (zona === "izquierda") return { x: 6, w: 42 };
    if (zona === "derecha") return { x: 52, w: 42 };
    if (zona === "franja") return { x: 6, w: 88 };
    return { x: 6, w: 88 };
  };

  return (
    <svg viewBox={`0 0 100 ${alto}`} width="100%" height="auto" role="img"
      aria-label={`Dónde sale ${slot.nombre} en la plantilla ${manifest.nombre}`}
      style={{ display: "block", borderRadius: 8, background: "var(--bg-elev)" }}>
      {/* barra de navegación */}
      <rect x="0" y="0" width="100" height="6" fill="var(--bg-elev-2)" />
      <rect x="4" y="2" width="16" height="2" rx="1" fill="var(--text-4)" />

      {bandas.map((id, i) => {
        const y = 8 + i * 13;
        const esLaSeccion = id === slot.seccion;
        const { x, w } = zonaRect(slot.zona);
        return (
          <g key={id}>
            <rect x="0" y={y} width="100" height="11.5" fill={esLaSeccion ? "var(--brand-soft)" : "var(--bg-elev-2)"} />
            {esLaSeccion ? (
              <>
                <rect x={x} y={y + 1.5} width={w} height="8.5" rx="1.5" fill="var(--brand)" opacity="0.85" />
                <text x={x + w / 2} y={y + 7} fontSize="3.6" textAnchor="middle" fill="#fff" fontWeight="600">
                  {slot.nombre}
                </text>
              </>
            ) : (
              <>
                <rect x="6" y={y + 3} width="34" height="2" rx="1" fill="var(--text-4)" opacity="0.5" />
                <rect x="6" y={y + 6.5} width="60" height="1.6" rx="0.8" fill="var(--text-4)" opacity="0.3" />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ============================================================
   EDITOR
   ============================================================ */
export function ManifestEditor({
  templateId, sections, photos, saving,
  onSaveSections, onSavePhotos, onDraftSections, onUpload,
}: ManifestEditorProps) {
  const manifest = useMemo(() => manifestOf(templateId), [templateId]);

  /* ---- estado de secciones: lo guardado, completado con el manifiesto ---- */
  const [secs, setSecs] = useState<SectionState[]>(() => {
    const guardado = new Map(sections.map(s => [s.id, s]));
    const ordenadas = [...manifest.secciones]
      .map((m, i) => {
        const g = guardado.get(m.id);
        return {
          id: m.id,
          visible: m.obligatoria ? true : g?.visible ?? true,
          orden: g?.orden ?? i,
          titulo: g?.titulo ?? null,
          subtitulo: g?.subtitulo ?? null,
        };
      })
      .sort((a, b) => a.orden - b.orden);
    const base = ordenadas.map((s, i) => ({ ...s, orden: i }));
    /* Secciones guardadas que este manifiesto no declara: las que solo
       existen para colgar un texto y las de una plantilla anterior. No se
       pintan, pero se conservan — si se cayeran aquí, el siguiente
       "Guardar secciones" borraría esos textos sin avisar. */
    const ajenas = sections.filter(s => !manifest.secciones.some(m => m.id === s.id));
    return [...base, ...ajenas.map((s, i) => ({ ...s, orden: base.length + i }))];
  });

  const [fotos, setFotos] = useState<Record<string, string>>(photos);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const metaSeccion = (id: string) => manifest.secciones.find(s => s.id === id);
  const ordenIds = secs.filter(s => s.visible).map(s => s.id);

  /* Un solo punto de escritura: así la vista previa en vivo se entera de
     TODO cambio y de ninguno que no sea del usuario. */
  function aplicar(next: SectionState[]) {
    setSecs(next);
    onDraftSections?.(next);
  }

  /* ---- REORDENAR NO SE OFRECE ----
     Había flechas de subir/bajar que guardaban `orden` en landingSections…
     y ninguna plantilla lo lee: todas pintan sus bloques en el orden escrito
     en su JSX. La clínica movía la sección, guardaba, iba a ver su sitio y
     estaba igual. `orden` se sigue guardando (es parte de SectionState y de
     lo que ya está en la base), pero no se promete moverlo hasta que las
     plantillas lo respeten al pintar. */

  function alternar(id: string) {
    if (metaSeccion(id)?.obligatoria) return;
    aplicar(secs.map(s => (s.id === id ? { ...s, visible: !s.visible } : s)));
  }

  function setTexto(seccion: string, campo: "titulo" | "subtitulo", valor: string) {
    const limpio = valor.trim() ? valor : null;
    const existe = secs.some(s => s.id === seccion);
    aplicar(existe
      ? secs.map(s => (s.id === seccion ? { ...s, [campo]: limpio } : s))
      // Sección que solo existe para colgar textos (p.ej. "tecnologia").
      : [...secs, { id: seccion, visible: true, orden: secs.length, titulo: null, subtitulo: null, [campo]: limpio } as SectionState]);
  }

  const valorTexto = (seccion: string, campo: "titulo" | "subtitulo") =>
    secs.find(s => s.id === seccion)?.[campo] ?? "";

  /* ---- fotos ---- */
  async function subir(slot: ManifestPhotoSlot, file: File) {
    setSubiendo(slot.id);
    try {
      const url = await onUpload(file, slot.id);
      const nuevas = { ...fotos, [slot.id]: url };
      setFotos(nuevas);
      await onSavePhotos(nuevas);
    } catch (e: any) {
      toast.error(e?.message ?? "No pudimos subir la foto");
    } finally {
      setSubiendo(null);
    }
  }

  async function quitar(slotId: string) {
    const nuevas = { ...fotos };
    delete nuevas[slotId];
    setFotos(nuevas);
    await onSavePhotos(nuevas);
  }

  return (
    <div className="space-y-5">

      {/* ══════════ SECCIONES ══════════ */}
      <div className={`${CARD} p-5 space-y-4`}>
        <div>
          <h3 className={H_SEC}>Secciones de tu sitio</h3>
          <p className={`${HELP} mt-0.5`}>
            Enciende y apaga lo que quieres que se vea. El orden lo fija la plantilla. Contacto y
            reserva no se pueden quitar: sin ellas el paciente no tiene cómo llegar ni cómo agendar.
          </p>
        </div>

        <div className="space-y-2">
          {secs.map(s => {
            const meta = metaSeccion(s.id);
            if (!meta) return null; // sección de una plantilla anterior: no se pinta
            return (
              <div key={s.id} className="flex items-center gap-3 border border-[color:var(--border-soft)] rounded-[var(--radius)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[color:var(--text-1)] flex items-center gap-1.5">
                    {meta.nombre}
                    {meta.obligatoria && <Lock size={12} className="text-[color:var(--text-4)]" />}
                  </div>
                  <div className={HELP}>
                    {meta.consume.length === 0
                      ? "Siempre visible"
                      : `Se pinta si hay: ${meta.consume.join(", ")}`}
                  </div>
                </div>

                <button type="button" role="switch" aria-checked={s.visible}
                  aria-label={`Mostrar ${meta.nombre}`}
                  onClick={() => alternar(s.id)}
                  disabled={!!meta.obligatoria}
                  className={`w-10 h-5 rounded-full relative transition-colors duration-150 shrink-0 disabled:opacity-40 ${s.visible ? "bg-brand-600" : "bg-[color:var(--border-strong)]"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-[var(--shadow-1)] transition-all duration-150 ${s.visible ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            );
          })}
        </div>

        <button onClick={() => onSaveSections(secs)} disabled={saving} className={BTN_SAVE}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : "Guardar secciones"}
        </button>
      </div>

      {/* ══════════ TEXTOS ══════════ */}
      {manifest.textos.length > 0 && (
        <div className={`${CARD} p-5 space-y-4`}>
          <div>
            <h3 className={H_SEC}>Textos de la plantilla</h3>
            <p className={`${HELP} mt-0.5`}>
              Lo que ves en gris es lo que sale si lo dejas vacío. Escribe encima solo lo que
              quieras cambiar.
            </p>
          </div>

          <div className="space-y-3">
            {manifest.textos.map(txt => (
              <div key={`${txt.seccion}.${txt.campo}`}>
                <label className={LABEL}>{txt.etiqueta}</label>
                {txt.campo === "subtitulo" ? (
                  <textarea
                    value={valorTexto(txt.seccion, txt.campo)}
                    onChange={e => setTexto(txt.seccion, txt.campo, e.target.value)}
                    placeholder={txt.porDefecto}
                    rows={2}
                    className={`${INPUT} resize-none`}
                  />
                ) : (
                  <input
                    value={valorTexto(txt.seccion, txt.campo)}
                    onChange={e => setTexto(txt.seccion, txt.campo, e.target.value)}
                    placeholder={txt.porDefecto}
                    className={INPUT}
                  />
                )}
              </div>
            ))}
          </div>

          <button onClick={() => onSaveSections(secs)} disabled={saving} className={BTN_SAVE}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : "Guardar textos"}
          </button>
        </div>
      )}

      {/* ══════════ FOTOS POR RANURA ══════════ */}
      <div className={`${CARD} p-5 space-y-4`}>
        <div>
          <h3 className={H_SEC}>Fotos de la plantilla</h3>
          <p className={`${HELP} mt-0.5`}>
            Cada foto tiene su lugar. El diagrama muestra dónde va a salir antes de que la subas.
          </p>
        </div>

        {manifest.sinFotos ? (
          <div className="flex flex-col items-center gap-2 border border-dashed border-[color:var(--border-strong)] rounded-[var(--radius-lg)] py-10 px-4 text-center">
            <ImageIcon size={22} className="text-[color:var(--text-4)]" />
            <p className="text-sm font-semibold text-[color:var(--text-1)]">
              Esta plantilla no usa fotos
            </p>
            <p className={`${HELP} max-w-sm`}>
              Y es a propósito: “{manifest.nombre}” está hecha para la clínica que no tiene
              material fotográfico. Se sostiene con color, precios y horarios.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {manifest.fotos.map(slot => {
              const url = fotos[slot.id];
              return (
                <div key={slot.id} className={`${ITEM} space-y-3`}>
                  <div>
                    <div className="text-sm font-semibold text-[color:var(--text-1)]">{slot.nombre}</div>
                    <div className={HELP}>Proporción recomendada: {slot.proporcion}</div>
                  </div>

                  <TemplateDiagram manifest={manifest} orden={ordenIds} slot={slot} />

                  {slot.ayuda && <p className={HELP}>{slot.ayuda}</p>}

                  {url ? (
                    <div className="relative">
                      <img src={url} alt={slot.nombre} className="w-full h-28 object-cover rounded-[var(--radius)]" />
                      <button type="button" onClick={() => quitar(slot.id)}
                        aria-label={`Quitar ${slot.nombre}`}
                        className="absolute top-1.5 right-1.5 w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] bg-black/55 text-white hover:bg-black/75 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="h-28 grid place-items-center border border-dashed border-[color:var(--border-strong)] rounded-[var(--radius)] text-[color:var(--text-4)]">
                      <ImageIcon size={20} />
                    </div>
                  )}

                  <input
                    ref={el => { inputs.current[slot.id] = el; }}
                    type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) subir(slot, f);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" onClick={() => inputs.current[slot.id]?.click()}
                    disabled={subiendo === slot.id}
                    className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-sm)] text-[12.5px] font-semibold text-[color:var(--text-2)] bg-card border border-[color:var(--border-soft)] hover:bg-[color:var(--bg-hover)] transition disabled:opacity-50">
                    {subiendo === slot.id
                      ? <><Loader2 size={14} className="animate-spin" /> Subiendo…</>
                      : <><Upload size={14} /> {url ? "Cambiar foto" : "Subir foto"}</>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
