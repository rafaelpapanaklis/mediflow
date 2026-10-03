"use client";
// Ortodoncia — lo nuevo de la hoja de control (ws1-t9, auditoría BEVADENT, M1-M3), en piezas que el cajón
// (DrawerTreatmentCard) y la ficha (SectionPlan) montan:
//   - `useExtrasDeHoja`: carga al abrir qué partes tienen su SQL, los catálogos de la clínica, las ligas (de esta hoja
//     o del control anterior), el arco inferior guardado y las mecánicas del caso. Sin SQL todo viene apagado y la
//     hoja se ve como antes.
//   - `BloqueLigas`: tipo, color, arcada y «se cambiaron hoy», con chips de un toque por tipo.
//   - `BloqueMecanicas`: las mecánicas activas del caso con «Retirar», y «Agregar mecánica» (tipo del catálogo,
//     arcada, diente o zona, fecha, nota). Se guardan al momento, como «Otro arco…»: viven en el caso, no en la hoja.
//   - `MecanicasDelCaso` / `HistorialDeLigas`: lo mismo para la ficha, que lo carga por su cuenta.
// Mismo vestido que el resto de la hoja (orto.module.css); textos es/en en textos-hoja-extras.ts.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { hoyISO } from "@/lib/orthodontics/fechas-de-formulario";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { fmtDateShort } from "../atoms/format";
import orto from "../orto.module.css";
import { isFailure } from "@/app/actions/orthodontics/result";
import {
  agregarMecanicaAction,
  cargarExtrasDeHoja,
  historialDeLigasAction,
  mecanicasDelCasoAction,
  retirarMecanicaAction,
  type ExtrasDeHoja,
} from "@/app/actions/orthodontics/hojaExtras";
import { esTipoSinLigas, opcionesParaElegir, type CatalogosDeHoja } from "@/lib/orthodontics/hoja-catalogos";
import {
  ARCADAS,
  ROTULO_DE_ARCADA,
  mecanicaActiva,
  ordenarMecanicas,
  textoDeLiga,
  textoDeMecanica,
  type ArcadaDeHoja,
  type LigaDeHoja,
  type LigasDeUnControl,
  type MecanicaDelCaso,
} from "@/lib/orthodontics/hoja-extras";
import { useTextosHojaExtras, type TextosHojaExtras } from "../textos-hoja-extras";

/** Carga lo nuevo de la hoja una vez por (caso, hoja). `null` mientras carga o si falla (la hoja sigue como antes). */
export function useExtrasDeHoja(treatmentPlanId: string | undefined, cardId: string | null): ExtrasDeHoja | null {
  const [extras, setExtras] = useState<ExtrasDeHoja | null>(null);
  useEffect(() => {
    if (!treatmentPlanId) return;
    let vivo = true;
    void cargarExtrasDeHoja({ treatmentPlanId, cardId }).then((r) => {
      if (vivo && !isFailure(r)) setExtras(r.data);
    });
    return () => {
      vivo = false;
    };
    // Solo al abrir: la hoja nueva aprende su id al guardar y no hace falta recargar por eso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentPlanId]);
  return extras;
}

/** Superior / Inferior / Ambas (y «—» si se permite no decirlo). */
function SelectorDeArcada(props: {
  valor: ArcadaDeHoja | null;
  onCambio: (a: ArcadaDeHoja | null) => void;
  permitirNinguna?: boolean;
  t: TextosHojaExtras;
  etiqueta: string;
}) {
  const opciones: Array<ArcadaDeHoja | null> = props.permitirNinguna ? [null, ...ARCADAS] : [...ARCADAS];
  return (
    <div className={orto.segmento} role="radiogroup" aria-label={props.etiqueta}>
      {opciones.map((a) => {
        const activo = props.valor === a;
        return (
          <button
            key={a ?? "ninguna"}
            type="button"
            role="radio"
            aria-checked={activo}
            className={[orto.segmentoBoton, activo ? orto.segmentoActivo : ""].filter(Boolean).join(" ")}
            onClick={() => props.onCambio(a)}
          >
            {a ? ROTULO_DE_ARCADA[a][props.t.idioma] : props.t.sinArcada}
          </button>
        );
      })}
    </div>
  );
}

// ─── M2 · Ligas ──────────────────────────────────────────────────────────

export function BloqueLigas(props: {
  ligas: LigaDeHoja[];
  /** Las ligas vienen del control anterior y nadie las ha tocado: se marca. */
  heredadas: boolean;
  catalogos: CatalogosDeHoja;
  soloLectura: boolean;
  onCambio: (ligas: LigaDeHoja[]) => void;
}) {
  const t = useTextosHojaExtras();
  const tipos = opcionesParaElegir(
    props.catalogos.ligasTipos,
    props.ligas.map((l) => l.tipo),
  );
  const colores = opcionesParaElegir(
    props.catalogos.ligasColores,
    props.ligas.map((l) => l.color),
  );
  const cambiar = (i: number, patch: Partial<LigaDeHoja>) =>
    props.onCambio(
      props.ligas.map((l, j) => {
        if (j !== i) return l;
        const nueva = { ...l, ...patch };
        return esTipoSinLigas(nueva.tipo) ? { ...nueva, color: null } : nueva;
      }),
    );
  return (
    <section className={orto.bloque} data-bloque-ligas>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>{t.ligas}</h4>
        {!props.soloLectura && props.heredadas && props.ligas.length > 0 ? (
          <Pill color="sky" size="xs">
            {t.delAnterior}
          </Pill>
        ) : null}
      </div>
      {!props.soloLectura ? (
        <div className="flex gap-[6px] flex-wrap mb-[10px]">
          {opcionesParaElegir(props.catalogos.ligasTipos, []).map((tipo) => (
            <button
              key={tipo}
              type="button"
              className={orto.chip}
              disabled={props.ligas.length >= 4}
              onClick={() => props.onCambio([...props.ligas, { tipo, color: null, arcada: "AMBAS", cambiadasHoy: true }])}
            >
              <Plus size={13} strokeWidth={2} aria-hidden />
              {tipo}
            </button>
          ))}
        </div>
      ) : null}
      {props.ligas.length === 0 ? (
        <div className={orto.vacioLinea}>{t.sinLigas}</div>
      ) : props.soloLectura ? (
        <div className="flex flex-col gap-[6px]">
          {props.ligas.map((l, i) => (
            <div key={i} className={`${orto.caja} text-[13px] font-semibold [overflow-wrap:anywhere]`}>
              {textoDeLiga(l, t.idioma)}
              {!l.cambiadasHoy ? <span className={`${orto.tonoApagado} font-normal`}> · {t.siguenLasDeAntes}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {props.ligas.map((l, i) => (
            <div key={i} className={`${orto.caja} flex flex-col gap-[8px] text-[13px]`} data-liga>
              <div className={orto.rejilla2}>
                <select
                  value={l.tipo}
                  onChange={(e) => cambiar(i, { tipo: e.target.value })}
                  className={orto.entrada}
                  aria-label={t.tipoDeLiga}
                >
                  {tipos.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
                {!esTipoSinLigas(l.tipo) ? (
                  <select
                    value={l.color ?? ""}
                    onChange={(e) => cambiar(i, { color: e.target.value || null })}
                    className={orto.entrada}
                    aria-label={t.colorDeLiga}
                  >
                    <option value="">{t.color}</option>
                    {colores.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <SelectorDeArcada valor={l.arcada} onCambio={(a) => cambiar(i, { arcada: a ?? "AMBAS" })} t={t} etiqueta={t.arcada} />
                <label className={orto.casilla}>
                  <input type="checkbox" checked={l.cambiadasHoy} onChange={(e) => cambiar(i, { cambiadasHoy: e.target.checked })} />
                  {t.cambiadasHoy}
                </label>
                <button
                  type="button"
                  onClick={() => props.onCambio(props.ligas.filter((_, j) => j !== i))}
                  aria-label={t.quitarLiga}
                  className={`${orto.botonIcono} ${orto.botonIconoPeligro} -my-1 -mr-1 ml-auto shrink-0`}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── M3 · Mecánicas auxiliares ───────────────────────────────────────────

function FormAltaMecanica(props: {
  treatmentPlanId: string;
  cardId: string | null;
  catalogo: string[];
  /** La fecha que se propone (la de la visita en la hoja; hoy en la ficha). YYYY-MM-DD. */
  fechaInicial: string;
  onCreada: (m: MecanicaDelCaso) => void;
  onCancelar: () => void;
}) {
  const t = useTextosHojaExtras();
  const [tipo, setTipo] = useState<string | null>(null);
  const [arcada, setArcada] = useState<ArcadaDeHoja | null>(null);
  const [ubicacion, setUbicacion] = useState("");
  const [nota, setNota] = useState("");
  const [fecha, setFecha] = useState(props.fechaInicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    if (!tipo) {
      setError(t.queMecanica);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await agregarMecanicaAction({
        treatmentPlanId: props.treatmentPlanId,
        cardId: props.cardId,
        tipo,
        arcada,
        ubicacion: ubicacion || null,
        nota: nota || null,
        colocadaEl: fecha ? new Date(`${fecha}T12:00:00`).toISOString() : null,
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success(t.mecanicaColocada);
      props.onCreada(r.data.mecanica);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className={`${orto.caja} flex flex-col gap-[10px] mt-[8px]`} data-alta-mecanica>
      <div>
        <div className={`${orto.campoEtiqueta} mb-[5px]`}>{t.queMecanica}</div>
        <div className="flex gap-[6px] flex-wrap" role="radiogroup" aria-label={t.queMecanica}>
          {props.catalogo.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={tipo === x}
              className={[orto.chip, tipo === x ? orto.chipElegido : orto.chipNeutro].join(" ")}
              onClick={() => setTipo(x)}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className={`${orto.campoEtiqueta} mb-[5px]`}>{t.arcadaOpcional}</div>
        <SelectorDeArcada valor={arcada} onCambio={setArcada} permitirNinguna t={t} etiqueta={t.arcadaOpcional} />
      </div>
      <div className={orto.rejilla2}>
        <label className={orto.campo}>
          <span className={orto.campoEtiqueta}>{t.dienteOZona}</span>
          <input
            type="text"
            value={ubicacion}
            maxLength={60}
            onChange={(e) => setUbicacion(e.target.value)}
            placeholder={t.phDienteOZona}
            className={orto.entrada}
          />
        </label>
        <label className={orto.campo}>
          <span className={orto.campoEtiqueta}>{t.colocadaEl}</span>
          <DateField
            value={fecha}
            max={hoyISO()}
            onChange={(e) => setFecha(e.target.value)}
            className={orto.entrada}
            aria-label={t.colocadaEl}
          />
        </label>
      </div>
      <div className={orto.campo}>
        <div className={`${orto.campoEtiqueta} flex items-center justify-between gap-2`}>
          <span>{t.nota}</span>
          <DictationMic onText={(x) => setNota((n) => appendDictado(n, x, "\n", 300))} />
        </div>
        <textarea
          value={nota}
          maxLength={300}
          rows={2}
          onChange={(e) => setNota(e.target.value)}
          placeholder={t.phNota}
          className={orto.entrada}
          aria-label={t.nota}
        />
      </div>
      {error ? (
        <p className={`${orto.bloqueNota} ${orto.tonoAlerta}`} role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Btn variant="primary" size="sm" onClick={() => void guardar()} disabled={guardando}>
          {guardando ? t.colocando : t.colocar}
        </Btn>
        <Btn variant="secondary" size="sm" onClick={props.onCancelar} disabled={guardando}>
          {t.cancelar}
        </Btn>
      </div>
    </div>
  );
}

function FilaDeMecanica(props: {
  m: MecanicaDelCaso;
  t: TextosHojaExtras;
  /** Hoja abierta: marca lo colocado/retirado en ella. */
  cardId?: string | null;
  onRetirar?: () => void;
  retirando?: boolean;
}) {
  const { m, t } = props;
  const activa = mecanicaActiva(m);
  const texto = textoDeMecanica(m, t.idioma);
  return (
    <div className={`${orto.caja} flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]`} data-mecanica={m.id}>
      <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{texto}</span>
      <span className={`${orto.tonoApagado} text-xs`}>
        {activa ? t.desde(fmtDateShort(m.colocadaEl)) : t.retiradaEl(fmtDateShort(m.retiradaEl))}
      </span>
      {props.cardId && m.cardIdAlta === props.cardId ? (
        <Pill color="emerald" size="xs">
          {t.colocadaEnEste}
        </Pill>
      ) : null}
      {props.cardId && m.cardIdRetiro === props.cardId ? (
        <Pill color="slate" size="xs">
          {t.retiradaEnEste}
        </Pill>
      ) : null}
      {m.legado ? (
        <Pill color="slate" size="xs">
          {t.registradaAntes}
        </Pill>
      ) : null}
      {m.nota ? <span className={`${orto.tonoTexto2} basis-full text-xs whitespace-pre-wrap`}>{m.nota}</span> : null}
      {activa && props.onRetirar ? (
        // El margen va en un envoltorio: `.enlace` lleva su propio margen y le gana a `ml-auto`.
        <span className="ml-auto">
          <button
            type="button"
            className={orto.enlace}
            onClick={props.onRetirar}
            disabled={props.retirando}
            aria-label={t.retirarAria(texto)}
          >
            {props.retirando ? t.retirando : t.retirar}
          </button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Lista + alta + retiro. Lo usan la hoja (con `cardId` y la fecha de la visita) y la ficha. `onCambio` devuelve la
 * lista ya actualizada.
 */
export function ListaDeMecanicas(props: {
  treatmentPlanId: string;
  cardId: string | null;
  mecanicas: MecanicaDelCaso[];
  catalogo: string[];
  puedeEditar: boolean;
  soloLectura: boolean;
  /** YYYY-MM-DD: la fecha que se propone al colocar o retirar. */
  fecha: string;
  onCambio: (m: MecanicaDelCaso[]) => void;
}) {
  const t = useTextosHojaExtras();
  const [alta, setAlta] = useState(false);
  const [retirando, setRetirando] = useState<string | null>(null);
  const [verRetiradas, setVerRetiradas] = useState(false);
  const editable = props.puedeEditar && !props.soloLectura;
  const ordenadas = ordenarMecanicas(props.mecanicas);
  // En la hoja: siempre las activas y las que se tocaron en ESTA hoja; las demás retiradas, tras «Ver retiradas».
  const visibles = ordenadas.filter(
    (m) => mecanicaActiva(m) || verRetiradas || (props.cardId && (m.cardIdRetiro === props.cardId || m.cardIdAlta === props.cardId)),
  );
  const ocultas = ordenadas.length - visibles.length;

  const retirar = async (m: MecanicaDelCaso) => {
    setRetirando(m.id);
    try {
      const r = await retirarMecanicaAction({
        treatmentPlanId: props.treatmentPlanId,
        id: m.id,
        cardId: props.cardId,
        fecha: props.fecha ? new Date(`${props.fecha}T12:00:00`).toISOString() : null,
      });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      toast.success(t.mecanicaRetirada);
      props.onCambio(props.mecanicas.map((x) => (x.id === m.id ? r.data.mecanica : x)));
    } finally {
      setRetirando(null);
    }
  };

  return (
    <>
      {visibles.length === 0 ? (
        <div className={orto.vacioLinea}>{t.sinMecanicas}</div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {visibles.map((m) => (
            <FilaDeMecanica
              key={m.id}
              m={m}
              t={t}
              cardId={props.cardId}
              retirando={retirando === m.id}
              // Las del modelo viejo (expansor/distalizador de antes) solo se ven: no se retiran desde aquí.
              onRetirar={editable && !m.legado ? () => void retirar(m) : undefined}
            />
          ))}
        </div>
      )}
      {ocultas > 0 || (verRetiradas && ordenadas.some((m) => !mecanicaActiva(m))) ? (
        <button type="button" className={`${orto.enlace} mt-[6px]`} onClick={() => setVerRetiradas((v) => !v)}>
          {verRetiradas ? t.ocultarRetiradas : t.verRetiradas(ocultas)}
        </button>
      ) : null}
      {editable ? (
        alta ? (
          <FormAltaMecanica
            treatmentPlanId={props.treatmentPlanId}
            cardId={props.cardId}
            catalogo={props.catalogo}
            fechaInicial={props.fecha}
            onCreada={(m) => {
              setAlta(false);
              props.onCambio([m, ...props.mecanicas]);
            }}
            onCancelar={() => setAlta(false)}
          />
        ) : (
          <div className="mt-[8px]">
            <button type="button" className={orto.chip} onClick={() => setAlta(true)}>
              <Plus size={13} strokeWidth={2} aria-hidden />
              {t.agregarMecanica}
            </button>
          </div>
        )
      ) : null}
    </>
  );
}

/** El bloque «Mecánicas auxiliares» de la hoja de control. */
export function BloqueMecanicas(props: {
  treatmentPlanId: string;
  cardId: string | null;
  mecanicas: MecanicaDelCaso[];
  catalogo: string[];
  puedeEditar: boolean;
  soloLectura: boolean;
  fecha: string;
  onCambio: (m: MecanicaDelCaso[]) => void;
}) {
  const t = useTextosHojaExtras();
  return (
    <section className={orto.bloque} data-bloque-mecanicas>
      <div className={orto.bloqueCabeza}>
        <h4 className={orto.bloqueTitulo}>{t.mecanicas}</h4>
      </div>
      <ListaDeMecanicas {...props} />
    </section>
  );
}

/** La ficha: las mecánicas del caso, con alta y retiro (se cargan solas; sin el SQL no se pinta nada). */
export function MecanicasDelCaso({
  treatmentPlanId,
  onCargado,
}: {
  treatmentPlanId: string | null;
  /** Se llama cuando la lista ya se pinta (con el SQL de ws1-t9): la ficha deja de pintar aparte el expansor/distalizador viejo. */
  onCargado?: () => void;
}) {
  const [datos, setDatos] = useState<{ puedeEditar: boolean; mecanicas: MecanicaDelCaso[]; catalogo: string[] } | null>(null);
  const cargar = useCallback(() => {
    if (!treatmentPlanId) return;
    void mecanicasDelCasoAction({ treatmentPlanId }).then((r) => {
      if (!isFailure(r) && r.data.disponible) {
        setDatos({ puedeEditar: r.data.puedeEditar, mecanicas: r.data.mecanicas, catalogo: r.data.catalogo });
        onCargado?.();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentPlanId]);
  useEffect(cargar, [cargar]);
  if (!treatmentPlanId || !datos) return null;
  return (
    <div className="mt-3" data-mecanicas-del-caso>
      <ListaDeMecanicas
        treatmentPlanId={treatmentPlanId}
        cardId={null}
        mecanicas={datos.mecanicas}
        catalogo={datos.catalogo}
        puedeEditar={datos.puedeEditar}
        soloLectura={false}
        fecha={hoyISO()}
        onCambio={(mecanicas) => setDatos((d) => (d ? { ...d, mecanicas } : d))}
      />
    </div>
  );
}

/** La ficha: qué ligas se anotaron en cada control (las 4 más recientes; «Ver todo» para el resto). */
export function HistorialDeLigas({ treatmentPlanId }: { treatmentPlanId: string | null }) {
  const t = useTextosHojaExtras();
  const [controles, setControles] = useState<LigasDeUnControl[] | null>(null);
  const [todo, setTodo] = useState(false);
  useEffect(() => {
    if (!treatmentPlanId) return;
    let vivo = true;
    void historialDeLigasAction({ treatmentPlanId }).then((r) => {
      if (vivo && !isFailure(r) && r.data.disponible) setControles(r.data.controles);
    });
    return () => {
      vivo = false;
    };
  }, [treatmentPlanId]);
  if (!treatmentPlanId || controles === null) return null;
  const visibles = todo ? controles : controles.slice(0, 4);
  return (
    <div className="px-[18px] py-[16px] border-t border-[color:var(--pr-borde-suave)]" data-historial-ligas>
      <h4 className={`${orto.bloqueTitulo} mb-3`}>{t.historialLigas}</h4>
      {controles.length === 0 ? (
        <div className={orto.vacioLinea}>{t.sinHistorialLigas}</div>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {visibles.map((c) => (
            <li key={c.cardId} className={`${orto.caja} flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]`}>
              <span className="font-semibold">{t.controlN(c.cardNumber)}</span>
              <span className={`${orto.tonoApagado} text-xs`}>
                {fmtDateShort(c.visitDate)}
                {c.firmada ? "" : ` · ${t.borrador}`}
              </span>
              <span className="basis-full [overflow-wrap:anywhere]">{c.ligas.map((l) => textoDeLiga(l, t.idioma)).join(" / ")}</span>
            </li>
          ))}
        </ul>
      )}
      {controles.length > 4 ? (
        <button type="button" className={`${orto.enlace} mt-[8px]`} onClick={() => setTodo((v) => !v)}>
          {todo ? t.verMenos : t.verTodo(controles.length)}
        </button>
      ) : null}
    </div>
  );
}
