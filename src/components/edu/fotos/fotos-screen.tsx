"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Pencil, Trash2, Upload } from "lucide-react";
import {
  eduAgruparFotosPorEtapa,
  eduContarFotosPorEtapa,
  type EduPhotoRow,
} from "@/lib/edu/fotos-core";
import { EDU_SIGNED_URL_TTL_SECONDS } from "@/lib/edu/estudios-core";
import type { EduCaseOption } from "@/lib/edu/expediente-core";
import {
  EDU_PHOTO_STAGE_DESCRIPTIONS,
  EDU_PHOTO_STAGE_LABELS,
  EDU_PHOTO_STAGES,
  EDU_PHOTO_TYPE_LABELS,
  type EduPhotoStage,
  type EduPhotoType,
} from "@/lib/edu/types";
import { EduFotosComparador } from "@/components/edu/fotos/comparador";
import { EduFotoVisor } from "@/components/edu/fotos/visor";
import { EduSubirFoto } from "@/components/edu/fotos/subir-foto";
import { EduCorregirFoto, EduRetirarFoto } from "@/components/edu/fotos/editar-foto";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA PESTAÑA FOTOS — galería agrupada por etapa + comparador antes/después.
 *
 * 🔴 SEPARADA DE ESTUDIOS A PROPÓSITO, y es lo que pidió Rafael: «en
 * Dental me gusta como está porque está más separado todo y bien hecho:
 * radiografía es radiografía y foto clínica es foto clínica». No son la
 * misma cosa ni se miran igual: una radiografía se abre sola y se lee; una
 * foto clínica solo significa algo al lado de otra foto.
 *
 * 🔴 Y ES CÓDIGO PROPIO DEL VERTICAL. Ni un import de
 * `components/dashboard/` ni de `clinical-shared/`: se miró la pestaña del
 * dental para no olvidar ningún gesto y se escribió aquí. Hay una prueba
 * que lo fija.
 *
 * 🔴 LOS CUATRO GRUPOS SE PINTAN SIEMPRE, incluidos los vacíos, y eso es
 * la mitad del producto: una galería que esconde «Después» cuando está
 * vacío no le dice a nadie que FALTA el después — que es justo lo que hay
 * que ver antes de dar de alta a un paciente.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduFotosScreenProps {
  patientId: string;
  rows: EduPhotoRow[];
  /** true = se topó con el techo y hay fotos que no viajaron. */
  truncated: boolean;
  maxRows: number;
  cases: EduCaseOption[];
  /**
   * Cuándo se firmaron las URLs (ISO). Caducan a la hora y esta pantalla
   * se queda abierta toda la sesión clínica: sin este dato, pasado ese
   * rato cada miniatura da un 403 mudo que se lee como «se perdieron las
   * fotos del paciente». Es la misma lección que S-9 en Estudios.
   */
  signedAt: string;
  /** `estudios.upload`. Sin él: subir, corregir y retirar apagados, con
   *  el motivo escrito — nunca botones mudos que contesten 403. */
  canUpload: boolean;
  /** HOY en el calendario del INSTITUTO, no en el del navegador. */
  todayISO: string;
}

const SIN_PERMISO =
  "Tu cuenta puede mirar el expediente, no escribir en él (te falta el permiso estudios.upload). " +
  "Lo da la dirección del instituto.";

export function EduFotosScreen({
  patientId,
  rows,
  truncated,
  maxRows,
  cases,
  signedAt,
  canUpload,
  todayISO,
}: EduFotosScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);

  const [etapa, setEtapa] = useState<EduPhotoStage | "todas">("todas");
  const [vista, setVista] = useState<EduPhotoType | "todas">("todas");
  const [subir, setSubir] = useState(false);
  const [verIdx, setVerIdx] = useState<number | null>(null);
  const [corregir, setCorregir] = useState<EduPhotoRow | null>(null);
  const [retirar, setRetirar] = useState<EduPhotoRow | null>(null);
  const [caducadas, setCaducadas] = useState(false);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  /* Las URLs firmadas caducan a la hora. Se avisa un minuto antes y se
     ofrece renovar (un `router.refresh()`: la página es force-dynamic y
     vuelve a firmarlo todo). Y si una miniatura falla al cargar, su
     `onError` levanta el mismo aviso — el reloj del navegador puede ir
     corrido, y la prueba de que caducó es que no carga. */
  useEffect(() => {
    setCaducadas(false);
    const firmadas = Date.parse(signedAt);
    if (!Number.isFinite(firmadas)) return;
    const faltan = firmadas + (EDU_SIGNED_URL_TTL_SECONDS - 60) * 1000 - Date.now();
    if (faltan <= 0) {
      setCaducadas(true);
      return;
    }
    const t = setTimeout(() => setCaducadas(true), faltan);
    return () => clearTimeout(t);
  }, [signedAt]);

  // Los contadores de las píldoras de ETAPA se calculan sobre lo filtrado
  // por VISTA (y no sobre el total): si se está mirando "Sonrisa", la
  // píldora "Después" tiene que decir cuántas sonrisas hay en "Después",
  // no cuántas fotos de cualquier tipo. Un contador que no cuadra con lo
  // que se ve debajo es peor que no tener contador.
  const porVista = useMemo(
    () => (vista === "todas" ? rows : rows.filter((f) => f.photoType === vista)),
    [rows, vista],
  );
  const cuentaEtapa = useMemo(() => eduContarFotosPorEtapa(porVista), [porVista]);

  const filtradas = useMemo(
    () => (etapa === "todas" ? porVista : porVista.filter((f) => f.stage === etapa)),
    [porVista, etapa],
  );

  const grupos = useMemo(() => eduAgruparFotosPorEtapa(filtradas), [filtradas]);

  // El orden PLANO con el que navega el visor: el mismo que se ve en
  // pantalla (grupo por grupo, y dentro de cada grupo de la más antigua a
  // la más reciente). Si el visor navegara por otro orden, la flecha
  // derecha saltaría a una foto que no es la de al lado.
  const planas = useMemo(() => grupos.flatMap((g) => g.rows), [grupos]);

  // Las vistas que este paciente tiene DE VERDAD. Un desplegable con las
  // diez, ocho de ellas vacías, es una lista de cosas que no existen.
  const vistasPresentes = useMemo(() => {
    const set = new Set<EduPhotoType>();
    for (const f of rows) set.add(f.photoType);
    return [...set];
  }, [rows]);

  function abrir(foto: EduPhotoRow) {
    const i = planas.findIndex((f) => f.id === foto.id);
    if (i >= 0) setVerIdx(i);
  }

  return (
    <div className="edu-stack">
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Actualizando…"
            : `${filtradas.length} de ${rows.length} ${rows.length === 1 ? "foto" : "fotos"}${
                truncated ? ` (se muestran las ${maxRows} más recientes)` : ""
              }`}
        </span>
        <span className="edu-fotos-acciones">
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            disabled={!canUpload}
            onClick={() => {
              setFlash(null);
              setSubir(true);
            }}
          >
            <Upload size={16} />
            Subir una foto
          </button>
        </span>
      </div>

      {/* ⚠️ El botón se deshabilita CON su motivo escrito, no se esconde:
          un botón que no está no se puede preguntar por qué no está. */}
      {!canUpload && <p className="edu-note">{SIN_PERMISO}</p>}

      {caducadas && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Los enlaces de las fotos caducaron</p>
            <p className="edu-banner__detail">
              Por seguridad las fotos se sirven con un enlace temporal que dura una hora, y esta
              pestaña lleva más abierta. Actualiza para renovarlos: no se pierde nada, las fotos
              siguen ahí.
            </p>
            <p>
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => startNav(() => router.refresh())}
                disabled={navigating}
              >
                {navigating ? "Renovando…" : "Renovar los enlaces"}
              </button>
            </p>
          </div>
        </div>
      )}

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Se muestran las {maxRows} fotos más recientes, no todas.
            </p>
            <p className="edu-banner__detail">
              Lo que falta son las MÁS VIEJAS — que en una galería de antes y después es
              justamente el «antes». Si buscas la primera foto del tratamiento y no la ves, no
              quiere decir que nadie la haya subido.
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <span className="edu-fotos-vacio__icono" aria-hidden>
            <Camera size={26} strokeWidth={1.75} />
          </span>
          <p className="edu-empty__title">Todavía no hay fotos de este paciente</p>
          <p className="edu-empty__detail">
            Aquí van las fotos clínicas: la sonrisa, los perfiles, las oclusales. Se marcan como
            «Antes», «Durante», «Después» o «Control», y con dos de ellas el comparador enseña el
            cambio. Las radiografías y las tomografías no van aquí, van en Estudios.
          </p>
          {canUpload ? (
            <p>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={() => setSubir(true)}
              >
                <Upload size={16} />
                Subir la primera foto
              </button>
            </p>
          ) : (
            <p className="edu-empty__detail">{SIN_PERMISO}</p>
          )}
        </div>
      ) : (
        <>
          {/* ── Los filtros: etapa (píldoras con contador) y vista ────── */}
          <div className="edu-fotos-filtros">
            <div className="edu-fotos-pills" role="group" aria-label="Filtrar por etapa">
              {(["todas", ...EDU_PHOTO_STAGES] as const).map((s) => {
                const on = etapa === s;
                const n = s === "todas" ? porVista.length : cuentaEtapa[s];
                return (
                  <button
                    key={s}
                    type="button"
                    className={`edu-fotos-pill ${on ? "edu-fotos-pill--on" : ""}`}
                    aria-pressed={on}
                    onClick={() => setEtapa(s)}
                    title={s === "todas" ? undefined : EDU_PHOTO_STAGE_DESCRIPTIONS[s]}
                  >
                    {s === "todas" ? "Todas" : EDU_PHOTO_STAGE_LABELS[s]}
                    <span className="edu-fotos-pill__n">{n}</span>
                  </button>
                );
              })}
            </div>

            {vistasPresentes.length > 1 && (
              <label className="edu-fotos-filtros__vista">
                <span className="edu-field__label">Vista</span>
                <select
                  className="edu-input"
                  value={vista}
                  onChange={(e) => setVista(e.target.value as EduPhotoType | "todas")}
                >
                  <option value="todas">Todas las vistas ({rows.length})</option>
                  {vistasPresentes.map((t) => (
                    <option key={t} value={t}>
                      {EDU_PHOTO_TYPE_LABELS[t]} ({rows.filter((f) => f.photoType === t).length})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* ── El comparador. Se alimenta de lo FILTRADO cuando hay al
              menos dos, y de todo cuando el filtro dejó menos: comparar es
              lo que se vino a hacer, y un filtro estrecho no puede vaciar
              la tarjeta principal de la pantalla. ────────────────────── */}
          <EduFotosComparador fotos={filtradas.length >= 2 ? filtradas : rows} onAbrir={abrir} />

          {filtradas.length === 0 ? (
            <div className="edu-empty">
              <p className="edu-empty__title">Ninguna foto encaja con ese filtro</p>
              <p className="edu-empty__detail">
                Este paciente tiene {rows.length} {rows.length === 1 ? "foto" : "fotos"}, pero
                ninguna de esa etapa y esa vista a la vez.
              </p>
              <p>
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => {
                    setEtapa("todas");
                    setVista("todas");
                  }}
                >
                  Quitar los filtros
                </button>
              </p>
            </div>
          ) : (
            <div className="edu-stack">
              {grupos.map((g) => (
                <section key={g.stage} className="edu-fotos-grupo" aria-label={EDU_PHOTO_STAGE_LABELS[g.stage]}>
                  <div className="edu-fotos-grupo__head">
                    <span
                      className={`edu-fotos-punto edu-fotos-punto--${g.stage.toLowerCase()}`}
                      aria-hidden
                    />
                    <h3 className="edu-fotos-grupo__title">{EDU_PHOTO_STAGE_LABELS[g.stage]}</h3>
                    <span className="edu-count">{g.rows.length}</span>
                  </div>

                  {g.rows.length === 0 ? (
                    /* 🔴 El grupo vacío SE PINTA. Que falte el «Después» es
                       información clínica, no un hueco que haya que
                       esconder. */
                    <p className="edu-fotos-grupo__vacio">
                      Sin fotos en esta etapa. {EDU_PHOTO_STAGE_DESCRIPTIONS[g.stage]}
                    </p>
                  ) : (
                    <div className="edu-fotos-rejilla">
                      {g.rows.map((f) => (
                        <figure key={f.id} className="edu-fotos-tarjeta">
                          <button
                            type="button"
                            className="edu-fotos-tarjeta__mini"
                            onClick={() => abrir(f)}
                            aria-label={`Abrir la foto ${EDU_PHOTO_TYPE_LABELS[f.photoType]} del ${f.capturedLabel}`}
                          >
                            {f.thumbUrl || f.url ? (
                              /* eslint-disable-next-line @next/next/no-img-element -- URL
                                 firmada que caduca: next/image la cachearía
                                 y después daría 403. */
                              <img
                                src={f.thumbUrl || f.url}
                                alt={f.notes ?? EDU_PHOTO_TYPE_LABELS[f.photoType]}
                                loading="lazy"
                                onError={() => setCaducadas(true)}
                              />
                            ) : (
                              <Camera size={28} aria-hidden />
                            )}
                          </button>

                          <figcaption className="edu-fotos-tarjeta__pie">
                            <span className="edu-fotos-tarjeta__vista">
                              {EDU_PHOTO_TYPE_LABELS[f.photoType]}
                            </span>
                            <span className="edu-fotos-tarjeta__meta">{f.capturedLabel}</span>
                            <span className="edu-fotos-tarjeta__meta">
                              Subió {f.uploadedByName}
                              {f.caseProgramName ? ` · ${f.caseProgramName}` : ""}
                            </span>
                            {f.notes && <span className="edu-fotos-tarjeta__nota">{f.notes}</span>}
                          </figcaption>

                          {/* La fila de acciones se pega ABAJO de la
                              tarjeta (`margin-top: auto`): sin eso, la
                              tarjeta que tiene nota empuja sus botones más
                              abajo que la de al lado y la rejilla se ve
                              rota aunque no lo esté. */}
                          <div className="edu-fotos-tarjeta__acc">
                            <button
                              type="button"
                              className="edu-btn edu-btn--ghost edu-btn--sm"
                              disabled={!canUpload}
                              title={canUpload ? undefined : SIN_PERMISO}
                              onClick={() => setCorregir(f)}
                            >
                              <Pencil size={14} />
                              Corregir
                            </button>
                            <button
                              type="button"
                              className="edu-btn edu-btn--ghost edu-btn--sm"
                              disabled={!canUpload}
                              title={canUpload ? undefined : SIN_PERMISO}
                              onClick={() => setRetirar(f)}
                            >
                              <Trash2 size={14} />
                              Retirar
                            </button>
                          </div>
                        </figure>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {verIdx !== null && planas[verIdx] && (
        <EduFotoVisor
          fotos={planas}
          indice={verIdx}
          onCerrar={() => setVerIdx(null)}
          onIr={setVerIdx}
        />
      )}

      {subir && canUpload && (
        <EduSubirFoto
          patientId={patientId}
          cases={cases}
          todayISO={todayISO}
          onClose={() => setSubir(false)}
          onDone={(m) => {
            setSubir(false);
            recargar(m);
          }}
        />
      )}

      {corregir && canUpload && (
        <EduCorregirFoto
          patientId={patientId}
          foto={corregir}
          onClose={() => setCorregir(null)}
          onDone={(m) => {
            setCorregir(null);
            recargar(m);
          }}
        />
      )}

      {retirar && canUpload && (
        <EduRetirarFoto
          patientId={patientId}
          foto={retirar}
          onClose={() => setRetirar(null)}
          onDone={(m) => {
            setRetirar(null);
            recargar(m);
          }}
        />
      )}
    </div>
  );
}
