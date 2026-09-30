"use client";
// Ortodoncia — los campos del «Plan de tratamiento» completo (ws1-t12), como Dentalink pero de nivel producto:
// las opciones cortas son chips y segmentados (un toque, sin casillas), las largas listas siguen siendo lista.
// Secciones: Tiempo y controles · Anclaje · Aditamentos · Extracciones · Control radiográfico · Aparatología ·
// Tubos, bandas y cementación · Interconsultas. Las comparten el popup «Editar plan» (cada sección es una tarjeta
// con su ancla, para la navegación del popup) y la sección opcional del popup «Abrir caso» (`anidado`).
//
// Solo pinta y avisa: el estado vive en quien lo monta (`valor` / `onCambio`) y el servidor vuelve a validar todo.
// Las listas salen de la clínica (Configuración): lo que el caso ya tenía y la clínica quitó sigue saliendo,
// marcado, para no perderlo sin querer.

import { useId, type ReactNode } from "react";
import { Anchor, CalendarClock, Check, Layers, MessageSquareText, Puzzle, ScanLine, Scissors, Wrench } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { hoyMasAniosISO } from "@/lib/orthodontics/fechas-de-formulario";
import {
  ANCLAJES,
  CAMPOS_DE_UNA_OPCION,
  ETIQUETA_ANCLAJE_GENERAL,
  RADIOGRAFIAS,
  anclajeGeneralDerivado,
  esAditamentoConTads,
  leerFdi,
  opcionesParaElegir,
  type CampoDeUnaOpcion,
  type ListaDelPlan,
  type OpcionesDelPlan,
  type TipoRadiografia,
} from "@/lib/orthodontics/plan-detalle";
import { PERIODICIDADES_COMUNES, alternar, type ClaveDeLaVentana, type FormularioDelPlan } from "@/lib/orthodontics/plan-detalle-formulario";
import orto from "../orto.module.css";
import alta from "../alta-caso.module.css";
import c from "../plan-tratamiento.module.css";

/** El id del ancla de una sección: la navegación del popup salta a él. */
export const idDeSeccion = (prefijo: string, clave: ClaveDeLaVentana): string => `${prefijo}-sec-${clave}`;

export interface CamposDelPlanProps {
  valor: FormularioDelPlan;
  onCambio: (parcial: Partial<FormularioDelPlan>) => void;
  /** null = todavía cargando las listas de la clínica. */
  opciones: OpcionesDelPlan | null;
  /** El alta ya pide la duración arriba: aquí no se repite. */
  conDuracion?: boolean;
  /** Bloques como subtítulos dentro de una sección (el alta) en vez de una tarjeta cada uno. */
  anidado?: boolean;
  /** TAD que el caso ya tiene registrados (Microtornillos y miniplacas se conectan con ellos). */
  tads?: number;
  /** El caso ya tiene seguimiento de alineadores: el total de alineadores es el mismo dato allá. */
  conSeguimientoDeAlineadores?: boolean;
  /** Las extracciones realizadas solo tienen sentido en un caso ya abierto. */
  conRealizadas?: boolean;
  /** Prefijo de los anclas (`idDeSeccion`); por omisión uno propio. */
  prefijo?: string;
  /**
   * Los controles que se PROPONEN (duración ÷ frecuencia de control de la clínica) y de dónde salen; editable.
   * null = no hay propuesta (sin duración).
   */
  controlesSugeridos?: { valor: number; frecuencia: string } | null;
  /** Qué aparatología tiene sentido con la técnica elegida (alineadores solo con alineadores o mixta…). Sin él, todo. */
  aparatologiaPermitida?: { brackets: boolean; alineadores: boolean };
}

export function CamposDelPlan(props: CamposDelPlanProps) {
  const { valor: v, onCambio: cambiar, opciones } = props;
  const propio = useId();
  const pre = props.prefijo ?? propio;
  const conDuracion = props.conDuracion !== false;
  const conRealizadas = props.conRealizadas !== false;
  const sec = (k: ClaveDeLaVentana) => idDeSeccion(pre, k);
  const permitida = props.aparatologiaPermitida ?? { brackets: true, alineadores: true };
  const sugerido = props.controlesSugeridos ?? null;

  const indicadas = leerFdi(v.extraccionesIndicadas);
  const realizadas = leerFdi(v.extraccionesRealizadas);
  const general = anclajeGeneralDerivado(v.anclajeSuperior || null, v.anclajeInferior || null);
  const pideTads = v.aditamentos.some(esAditamentoConTads);
  const anclajesOpciones = ANCLAJES.map((a) => ({ valor: a.key as string, texto: a.label }));

  return (
    <>
      <Bloque id={sec("tiempo")} anidado={props.anidado} icono={<CalendarClock size={16} strokeWidth={1.75} />} titulo="Tiempo y controles" sub="Cuánto dura y cuántos controles se prevén. Con eso se lleva «Control X de N» y se estima el cobro por control.">
        <div className={conDuracion ? c.rejilla3 : c.rejilla2}>
          {conDuracion ? (
            <Campo etiqueta="Tiempo de tratamiento (meses)" htmlFor={`${pre}-duracion`}>
              <input
                id={`${pre}-duracion`}
                className={orto.entrada}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={v.duracion}
                onChange={(e) => cambiar({ duracion: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                placeholder="18"
              />
            </Campo>
          ) : null}
          <Campo
            etiqueta="Cantidad de controles"
            htmlFor={`${pre}-controles`}
            pista={sugerido ? `Propuesta: ${sugerido.valor} (${v.duracion} meses, ${sugerido.frecuencia.toLowerCase()}). Cámbiala si el caso lo pide.` : "Cuántos controles se prevén en todo el tratamiento."}
          >
            <input
              id={`${pre}-controles`}
              className={orto.entrada}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={v.controles}
              onChange={(e) => cambiar({ controles: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
              placeholder={sugerido ? String(sugerido.valor) : "18"}
            />
            {sugerido && v.controles.trim() !== String(sugerido.valor) ? (
              <div className={c.chips}>
                <button type="button" className={c.chip} onClick={() => cambiar({ controles: String(sugerido.valor) })}>
                  Usar {sugerido.valor}
                </button>
              </div>
            ) : null}
          </Campo>
          <Campo
            etiqueta="Alineadores totales"
            htmlFor={`${pre}-alineadores`}
            pista={props.conSeguimientoDeAlineadores ? "Es el mismo dato del seguimiento de alineadores del caso: se cambia aquí o allá." : "Si el caso lleva alineadores, es el total de la serie."}
          >
            <input
              id={`${pre}-alineadores`}
              className={orto.entrada}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={v.alineadoresTotales}
              onChange={(e) => cambiar({ alineadoresTotales: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
              placeholder="—"
            />
          </Campo>
        </div>
      </Bloque>

      <Bloque id={sec("anclaje")} anidado={props.anidado} icono={<Anchor size={16} strokeWidth={1.75} />} titulo="Anclaje" sub="Por arcada. El anclaje general del caso se calcula de estos dos.">
        <div className={c.rejilla2}>
          <div className={c.grupoCampo}>
            <span className={orto.campoEtiqueta} id={`${pre}-anc-sup`}>Anclaje superior</span>
            <Segmentado
              etiquetadoPor={`${pre}-anc-sup`}
              valor={v.anclajeSuperior}
              opciones={anclajesOpciones}
              onCambio={(x) => cambiar({ anclajeSuperior: x as FormularioDelPlan["anclajeSuperior"] })}
            />
          </div>
          <div className={c.grupoCampo}>
            <span className={orto.campoEtiqueta} id={`${pre}-anc-inf`}>Anclaje inferior</span>
            <Segmentado
              etiquetadoPor={`${pre}-anc-inf`}
              valor={v.anclajeInferior}
              opciones={anclajesOpciones}
              onCambio={(x) => cambiar({ anclajeInferior: x as FormularioDelPlan["anclajeInferior"] })}
            />
          </div>
        </div>
        {general ? (
          <p className={orto.campoPista}>
            Anclaje general del caso: <strong>{ETIQUETA_ANCLAJE_GENERAL[general]}</strong>
          </p>
        ) : null}
      </Bloque>

      <Bloque id={sec("aditamentos")} anidado={props.anidado} icono={<Puzzle size={16} strokeWidth={1.75} />} titulo="Aditamentos" sub="Lo que lleva el caso además de los brackets.">
        <ChipsDeLista lista="aditamentos" opciones={opciones} elegidos={v.aditamentos} onCambio={(x) => cambiar({ aditamentos: x })} etiqueta="Aditamentos" />
        {pideTads || (props.tads ?? 0) > 0 ? (
          <p className={orto.campoPista}>
            {(props.tads ?? 0) > 0
              ? `Microtornillos y miniplacas se conectan con los TAD del caso: ya hay ${props.tads} registrado${props.tads === 1 ? "" : "s"}.`
              : "Microtornillos y miniplacas se conectan con los TAD del caso: aún no hay ninguno registrado (se agregan en Aparatología → «Agregar TAD»)."}
          </p>
        ) : null}
      </Bloque>

      <Bloque id={sec("extracciones")} anidado={props.anidado} icono={<Scissors size={16} strokeWidth={1.75} />} titulo="Extracciones" sub="Piezas en notación FDI, separadas por coma.">
        <div className={c.rejilla2}>
          <Campo
            etiqueta="Extracciones indicadas"
            htmlFor={`${pre}-indicadas`}
            pista={indicadas.invalidos.length > 0 ? undefined : "Por ejemplo: 14, 24, 34, 44"}
            error={indicadas.invalidos.length > 0 ? `«${indicadas.invalidos.join("», «")}» no es una pieza FDI válida.` : undefined}
          >
            <textarea
              id={`${pre}-indicadas`}
              className={orto.entrada}
              rows={2}
              value={v.extraccionesIndicadas}
              onChange={(e) => cambiar({ extraccionesIndicadas: e.target.value.slice(0, 200) })}
              placeholder="14, 24, 34, 44"
              aria-invalid={indicadas.invalidos.length > 0}
            />
          </Campo>
          {conRealizadas ? (
            <Campo
              etiqueta="Extracciones realizadas"
              htmlFor={`${pre}-realizadas`}
              pista={realizadas.invalidos.length > 0 ? undefined : "También se marcan solas al registrarlas en la hoja de control."}
              error={realizadas.invalidos.length > 0 ? `«${realizadas.invalidos.join("», «")}» no es una pieza FDI válida.` : undefined}
            >
              <textarea
                id={`${pre}-realizadas`}
                className={orto.entrada}
                rows={2}
                value={v.extraccionesRealizadas}
                onChange={(e) => cambiar({ extraccionesRealizadas: e.target.value.slice(0, 200) })}
                placeholder="14, 24" aria-label="Extracciones realizadas (piezas FDI, separadas por coma)"
                aria-invalid={realizadas.invalidos.length > 0}
              />
            </Campo>
          ) : null}
        </div>
        {conRealizadas && indicadas.validos.length > 0 ? (
          <div className={c.grupoCampo}>
            <span className={orto.campoEtiqueta}>Marca las que ya se hicieron</span>
            <div className={c.chips} role="group" aria-label="Piezas indicadas">
              {indicadas.validos.map((p) => {
                const hecha = realizadas.validos.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className={`${c.chip} ${hecha ? c.chipOn : ""}`}
                    aria-pressed={hecha}
                    onClick={() =>
                      cambiar({
                        extraccionesRealizadas: (hecha ? realizadas.validos.filter((x) => x !== p) : [...realizadas.validos, p]).sort((a, b) => a - b).join(", "),
                      })
                    }
                  >
                    {hecha ? <Check size={13} strokeWidth={2.4} aria-hidden /> : null}
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{p}</span>
                    {hecha ? " · hecha" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </Bloque>

      <Bloque id={sec("radiografico")} anidado={props.anidado} icono={<ScanLine size={16} strokeWidth={1.75} />} titulo="Control radiográfico" sub="Qué se pide, cada cuánto y cuándo se reevalúa. Alertas avisa cuando toca.">
        <div className={c.grupoCampo}>
          <span className={orto.campoEtiqueta}>Tipo de control</span>
          <div className={c.chips} role="group" aria-label="Tipo de control radiográfico">
            {RADIOGRAFIAS.map((r) => {
              const on = v.radiografias.includes(r.key);
              return (
                <button
                  key={r.key}
                  type="button"
                  className={`${c.chip} ${on ? c.chipOn : ""}`}
                  aria-pressed={on}
                  onClick={() => cambiar({ radiografias: alternar(v.radiografias, r.key) as TipoRadiografia[] })}
                >
                  {on ? <Check size={13} strokeWidth={2.4} aria-hidden /> : null}
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className={c.rejilla2}>
          <div className={c.grupoCampo}>
            <label className={orto.campoEtiqueta} htmlFor={`${pre}-periodicidad`}>Periodicidad</label>
            <div className={c.sufijo}>
              <input
                id={`${pre}-periodicidad`}
                className={orto.entrada}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={v.periodicidad}
                onChange={(e) => cambiar({ periodicidad: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                placeholder="12"
                style={{ maxWidth: 90 }}
              />
              <span>meses</span>
            </div>
            <div className={c.chips} role="group" aria-label="Periodicidades comunes">
              {PERIODICIDADES_COMUNES.map((m) => (
                <button key={m} type="button" className={`${c.chip} ${v.periodicidad === String(m) ? c.chipOn : ""}`} aria-pressed={v.periodicidad === String(m)} onClick={() => cambiar({ periodicidad: v.periodicidad === String(m) ? "" : String(m) })}>
                  {m}
                </button>
              ))}
            </div>
            <p className={orto.campoPista}>Se cuenta desde la última radiografía de ese tipo (panorámica y tele); las demás, desde el inicio del caso.</p>
          </div>
          <Campo etiqueta="Fecha de reevaluación" htmlFor={`${pre}-reevaluacion`} pista="Al llegar esa fecha, Alertas avisa «Reevaluación radiográfica».">
            <DateField
              id={`${pre}-reevaluacion`}
              value={v.reevaluacion}
              onChange={(e) => cambiar({ reevaluacion: e.target.value })}
              max={hoyMasAniosISO(10)}
              className={orto.entrada}
              aria-label="Fecha de reevaluación"
            />
          </Campo>
        </div>
      </Bloque>

      <Bloque id={sec("aparatologia")} anidado={props.anidado} icono={<Layers size={16} strokeWidth={1.75} />} titulo="Aparatología" sub="Lo que se le pone al paciente. La colocación lleva estos nombres en su concepto.">
        {permitida.brackets ? (
          <div className={c.grupoCampo}>
            <span className={orto.campoEtiqueta}>Brackets</span>
            <ChipsDeLista lista="brackets" opciones={opciones} elegidos={v.brackets} onCambio={(x) => cambiar({ brackets: x })} etiqueta="Brackets" />
          </div>
        ) : null}
        {permitida.alineadores ? (
          <div className={c.grupoCampo}>
            <span className={orto.campoEtiqueta}>Alineadores</span>
            <ChipsDeLista lista="alineadores" opciones={opciones} elegidos={v.alineadores} onCambio={(x) => cambiar({ alineadores: x })} etiqueta="Alineadores" />
          </div>
        ) : null}
        {!permitida.brackets || !permitida.alineadores ? (
          <p className={orto.campoPista}>
            {!permitida.alineadores ? "Los alineadores no aplican con la técnica elegida. " : ""}
            {!permitida.brackets ? "Los brackets no aplican con la técnica elegida. " : ""}
            Cambia la técnica (o elige una mixta) para verlos.
          </p>
        ) : null}
        <div className={c.grupoCampo}>
          <span className={orto.campoEtiqueta}>Placas</span>
          <ChipsDeLista lista="placas" opciones={opciones} elegidos={v.placas} onCambio={(x) => cambiar({ placas: x })} etiqueta="Placas" />
        </div>
      </Bloque>

      <Bloque id={sec("tubos")} anidado={props.anidado} icono={<Wrench size={16} strokeWidth={1.75} />} titulo="Tubos, bandas y cementación" sub="La prescripción de tubos y bandas, y cómo se cementa cada zona.">
        <div className={c.rejilla4}>
          {CAMPOS_DE_UNA_OPCION.map((campo) => (
            <Campo key={campo.campo} etiqueta={campo.etiqueta} htmlFor={`${pre}-${campo.campo}`}>
              <SelectDeLista
                id={`${pre}-${campo.campo}`}
                lista={campo.lista}
                opciones={opciones}
                valor={v[campo.campo as CampoDeUnaOpcion]}
                onCambio={(x) => cambiar({ [campo.campo]: x } as Partial<FormularioDelPlan>)}
              />
            </Campo>
          ))}
        </div>
      </Bloque>

      <Bloque id={sec("interconsultas")} anidado={props.anidado} icono={<MessageSquareText size={16} strokeWidth={1.75} />} titulo="Interconsultas">
        <Campo etiqueta="Interconsultas" htmlFor={`${pre}-interconsultas`} pista="Con quién se interconsulta y para qué. Por ejemplo: con odontología general para exodoncia de premolares.">
          <textarea
            id={`${pre}-interconsultas`}
            className={orto.entrada}
            rows={3}
            value={v.interconsultas}
            maxLength={1000}
            onChange={(e) => cambiar({ interconsultas: e.target.value })}
          />
        </Campo>
      </Bloque>
    </>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────────────

function Bloque({ id, anidado, icono, titulo, sub, children }: { id: string; anidado?: boolean; icono: ReactNode; titulo: string; sub?: string; children: ReactNode }) {
  if (anidado) {
    return (
      <div id={id} className={alta.subbloque}>
        <h5 className={alta.subtitulo}>{titulo}</h5>
        {sub ? <p className={orto.campoPista}>{sub}</p> : null}
        {children}
      </div>
    );
  }
  return (
    <section id={id} className={alta.seccion} aria-labelledby={`${id}-t`}>
      <header className={alta.seccionCabeza}>
        <span className={alta.seccionIcono} aria-hidden>{icono}</span>
        <div className={alta.seccionTextos}>
          <h4 id={`${id}-t`} className={alta.seccionTitulo}>{titulo}</h4>
          {sub ? <p className={alta.seccionSub}>{sub}</p> : null}
        </div>
      </header>
      <div className={alta.seccionCuerpo}>{children}</div>
    </section>
  );
}

function Campo({ etiqueta, htmlFor, pista, error, children }: { etiqueta: string; htmlFor?: string; pista?: string; error?: string; children: ReactNode }) {
  return (
    <div className={orto.campo}>
      <label htmlFor={htmlFor} className={orto.campoEtiqueta}>{etiqueta}</label>
      {children}
      {error ? (
        <p className={orto.campoPista} style={{ color: "var(--pr-peligro)" }} role="alert">{error}</p>
      ) : pista ? (
        <p className={orto.campoPista}>{pista}</p>
      ) : null}
    </div>
  );
}

/** Una sola opción entre pocas: segmentado. Volver a tocar la elegida la quita (queda «sin definir»). */
function Segmentado({
  valor,
  opciones,
  onCambio,
  etiquetadoPor,
}: {
  valor: string;
  opciones: ReadonlyArray<{ valor: string; texto: string }>;
  onCambio: (v: string) => void;
  etiquetadoPor: string;
}) {
  return (
    <div className={c.segmentado} role="radiogroup" aria-labelledby={etiquetadoPor}>
      {opciones.map((o) => {
        const on = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={on}
            className={`${c.segmento} ${on ? c.segmentoOn : ""}`}
            onClick={() => onCambio(on ? "" : o.valor)}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

/** Varias opciones de una lista de la clínica: chips que se encienden y apagan. */
function ChipsDeLista({
  lista,
  opciones,
  elegidos,
  onCambio,
  etiqueta,
}: {
  lista: ListaDelPlan;
  opciones: OpcionesDelPlan | null;
  elegidos: readonly string[];
  onCambio: (v: string[]) => void;
  etiqueta: string;
}) {
  const filas = opciones ? opcionesParaElegir(opciones[lista], elegidos) : elegidos.map((n) => ({ nombre: n, quitada: false }));
  if (!opciones) return <div className={c.vacioLista}>Cargando…</div>;
  if (filas.length === 0) return <div className={c.vacioLista}>Tu clínica no ofrece opciones aquí (Configuración → Plan de tratamiento).</div>;
  return (
    <div className={c.chips} role="group" aria-label={etiqueta}>
      {filas.map((f) => {
        const on = elegidos.includes(f.nombre);
        return (
          <button
            key={f.nombre}
            type="button"
            className={`${c.chip} ${on ? c.chipOn : ""} ${f.quitada ? c.chipQuitada : ""}`}
            aria-pressed={on}
            onClick={() => onCambio(alternar(elegidos, f.nombre))}
          >
            {on ? <Check size={13} strokeWidth={2.4} aria-hidden /> : null}
            <span>
              {f.nombre}
              {f.quitada ? <span className={c.quitada}> · ya no se ofrece</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Una opción de una lista de la clínica: segmentado si son pocas (Roth · MBT · Damon), lista si son muchas. */
function SelectDeLista({
  id,
  lista,
  opciones,
  valor,
  onCambio,
}: {
  id: string;
  lista: ListaDelPlan;
  opciones: OpcionesDelPlan | null;
  valor: string;
  onCambio: (v: string) => void;
}) {
  const filas = opciones ? opcionesParaElegir(opciones[lista], valor ? [valor] : []) : valor ? [{ nombre: valor, quitada: false }] : [];
  if (opciones && filas.length > 0 && filas.length <= 4) {
    return (
      <div className={c.segmentado} role="radiogroup" id={id} aria-label="Elige una opción">
        {filas.map((f) => {
          const on = valor === f.nombre;
          return (
            <button key={f.nombre} type="button" role="radio" aria-checked={on} className={`${c.segmento} ${on ? c.segmentoOn : ""}`} onClick={() => onCambio(on ? "" : f.nombre)}>
              {f.nombre}
              {f.quitada ? " (ya no se ofrece)" : ""}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <select id={id} className={orto.entrada} value={valor} onChange={(e) => onCambio(e.target.value)} disabled={!opciones}>
      <option value="">—</option>
      {filas.map((f) => (
        <option key={f.nombre} value={f.nombre}>
          {f.nombre}
          {f.quitada ? " (ya no se ofrece)" : ""}
        </option>
      ))}
    </select>
  );
}
