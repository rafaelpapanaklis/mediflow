"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Pencil, Trash2, Upload } from "lucide-react";
import {
  eduAgruparFotosPorEtapa,
  eduContarFotosPorEtapa,
  type EduPhotoRow,
} from "@/lib/edu/fotos-core";
import { EDU_SIGNED_URL_TTL_SECONDS, type EduRetiradoRow } from "@/lib/edu/estudios-core";
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
import { EduFotoImagen, type EduFotoEstado } from "@/components/edu/fotos/foto-img";
import { EduRetirados } from "@/components/edu/estudios/retirados";

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
  /**
   * N-16 · Las RETIRADAS, para que el motivo obligatorio se pueda LEER.
   * Llegan vacías sin `estudios.upload`: el servidor ni las consulta.
   */
  retiradas: EduRetiradoRow[];
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
  retiradas,
}: EduFotosScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);

  const [etapa, setEtapa] = useState<EduPhotoStage | "todas">("todas");
  const [vista, setVista] = useState<EduPhotoType | "todas">("todas");
  const [subir, setSubir] = useState(false);
  /**
   * N-16 · EL VISOR SE ABRE CON LA LISTA POR LA QUE VA A NAVEGAR, no con un
   * índice sobre una lista global.
   *
   * Antes el clic en A/B del comparador buscaba la foto en `planas`
   * —derivada de lo FILTRADO— mientras el comparador se alimentaba de
   * `rows` cuando el filtro dejaba menos de dos: con un filtro puesto, el
   * `findIndex` devolvía −1 y el clic no hacía absolutamente nada.
   */
  const [visor, setVisor] = useState<{ lista: EduPhotoRow[]; indice: number } | null>(null);
  const [corregir, setCorregir] = useState<EduPhotoRow | null>(null);
  const [retirar, setRetirar] = useState<EduPhotoRow | null>(null);
  const [caducadas, setCaducadas] = useState(false);
  /** N-5 · Las que NO se pueden pintar ni con un enlace recién firmado. */
  const [rotas, setRotas] = useState<string[]>([]);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  /* Las URLs firmadas caducan a la hora. Se avisa un minuto antes y se
     ofrece renovar (un `router.refresh()`: la página es force-dynamic y
     vuelve a firmarlo todo).

     🔴 N-5 · Y ESTE AVISO YA NO LO ENCIENDE NINGÚN `onError`. Lo encendía,
     y por eso una foto ilegible (HEIC sin convertir, objeto que ya no está)
     decía «caducaron» para siempre: se pulsaba «Renovar», se refrescaba, y
     volvía a fallar. Ahora cada imagen se renueva sola contra
     `/fotos/[fotoId]/url` y, si con la URL nueva sigue sin pintarse, dice
     lo que de verdad pasa en su sitio. */
  useEffect(() => {
    setCaducadas(false);
    setRotas([]);
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

  const alEstado = useCallback((id: string, estado: EduFotoEstado) => {
    setRotas((prev) => {
      const dentro = prev.includes(id);
      if (estado === "rota") return dentro ? prev : [...prev, id];
      return dentro ? prev.filter((x) => x !== id) : prev;
    });
  }, []);

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

  /**
   * N-16 · Y LA SIMÉTRICA, que faltaba: los contadores del desplegable
   * «Vista» se calculaban sobre `rows` —el total— ignorando el filtro de
   * etapa. Con «Después» puesto, el desplegable decía «Sonrisa (12)» encima
   * de una galería con dos. Es exactamente lo que el comentario de arriba
   * declara peor que no tener contador, en el otro filtro.
   */
  const porEtapa = useMemo(
    () => (etapa === "todas" ? rows : rows.filter((f) => f.stage === etapa)),
    [rows, etapa],
  );

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

  /* El comparador se alimenta de lo FILTRADO cuando hay al menos dos, y de
     todo cuando el filtro dejó menos: comparar es lo que se vino a hacer, y
     un filtro estrecho no puede vaciar la tarjeta principal de la pantalla.
     Su lista viaja también al visor, para que un clic en A o en B abra
     SIEMPRE la foto que se estaba mirando. */
  const paraComparar = filtradas.length >= 2 ? filtradas : rows;
  const planasComp = useMemo(
    () => eduAgruparFotosPorEtapa(paraComparar).flatMap((g) => g.rows),
    [paraComparar],
  );

  // Las vistas que este paciente tiene DE VERDAD. Un desplegable con las
  // diez, ocho de ellas vacías, es una lista de cosas que no existen.
  const vistasPresentes = useMemo(() => {
    const set = new Set<EduPhotoType>();
    for (const f of rows) set.add(f.photoType);
    return [...set];
  }, [rows]);

  function abrirEn(lista: EduPhotoRow[], foto: EduPhotoRow) {
    const i = lista.findIndex((f) => f.id === foto.id);
    if (i >= 0) setVisor({ lista, indice: i });
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
              pestaña lleva más abierta. Cada foto pide uno nuevo cuando hace falta, pero si ves
              varias tardando, actualiza: no se pierde nada, las fotos siguen ahí.
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

      {/* 🔴 N-5 · EL AVISO HONESTO. Ya no dice «caducaron» de una foto que
          no se puede pintar: dice que ese archivo no se puede mostrar, y
          que renovar no lo va a arreglar. */}
      {rotas.length > 0 && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              {rotas.length === 1
                ? "Una foto no se puede mostrar en este navegador"
                : `${rotas.length} fotos no se pueden mostrar en este navegador`}
            </p>
            <p className="edu-banner__detail">
              No es que el enlace haya caducado: se pidió uno nuevo y tampoco se pintan. El
              archivo quedó en un formato que este navegador no abre (un HEIC sin convertir, lo
              que produce un iPhone) o ya no está en el almacenamiento. Ábrelas desde un teléfono,
              o vuelve a subirlas desde el dispositivo que las tomó — las de ahora se convierten a
              JPG antes de subirse.
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
                  {/* N-16 · Los contadores cuentan DENTRO del filtro de
                      etapa que ya está puesto. Un «(12)» encima de dos
                      fotos es peor que no tener contador. */}
                  <option value="todas">Todas las vistas ({porEtapa.length})</option>
                  {vistasPresentes.map((t) => (
                    <option key={t} value={t}>
                      {EDU_PHOTO_TYPE_LABELS[t]} ({porEtapa.filter((f) => f.photoType === t).length}
                      )
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <EduFotosComparador
            patientId={patientId}
            fotos={paraComparar}
            onAbrir={(foto) => abrirEn(planasComp, foto)}
            onEstado={alEstado}
          />

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
                            onClick={() => abrirEn(planas, f)}
                            aria-label={`Abrir la foto ${EDU_PHOTO_TYPE_LABELS[f.photoType]} del ${f.capturedLabel}`}
                          >
                            <EduFotoImagen
                              patientId={patientId}
                              foto={f}
                              mini
                              alt={f.notes ?? EDU_PHOTO_TYPE_LABELS[f.photoType]}
                              loading="lazy"
                              onEstado={alEstado}
                            />
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

      {/* N-16 · El MOTIVO de retirar una foto, por fin legible. Plegada y
          solo con `estudios.upload`, que es el mismo permiso que hace falta
          para retirar. */}
      {canUpload && (
        <EduRetirados
          rows={retiradas}
          titulo="Retiradas"
          vacio="Ninguna foto de este paciente se ha retirado del expediente."
          detalle="Una foto retirada deja de salir en la galería y de contar para el almacenamiento contratado, pero ni la fila ni el archivo se borran. Aquí está por qué se retiró cada una."
        />
      )}

      {visor && visor.lista[visor.indice] && (
        <EduFotoVisor
          patientId={patientId}
          fotos={visor.lista}
          indice={visor.indice}
          onCerrar={() => setVisor(null)}
          onIr={(i) => setVisor((v) => (v ? { ...v, indice: i } : v))}
          onEstado={alEstado}
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
