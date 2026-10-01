"use client";
// Ortodoncia — el PASO «Diagnóstico» (ws1-t8): lo que TIENE el paciente, completo como Dentalink. Sin ventana
// propia: lo monta «Editar diagnóstico» (DrawerEditDiagnosis) y lo monta el paso 1 de la ventana «Abrir caso»
// de ws1-t12. Un solo formulario para crear y editar.
//
// Controlado: `valor` + `onCambio` (FormularioDelDiagnostico, puro en lib/orthodontics/diagnostico-formulario).
// La petición se arma con `formularioAPeticion` (derivados incluidos) y se guarda con `updateDiagnosis`.
// Índice lateral por secciones (en el teléfono, tira deslizable arriba); opciones cortas como segmentados;
// lo que se deriva solo (categoría de overjet/overbite, grado de apiñamiento) se enseña, no se pide.

import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  AlignLeft,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  FileText,
  FolderOpen,
  GitBranch,
  Layers,
  Ruler,
  Smile,
  User,
} from "lucide-react";
import {
  HABITOS_DEL_PASO,
  HABITO,
  SECCIONES_DEL_DETALLE,
  categoriaOverbite,
  categoriaOverjet,
  etiquetaDeCategoria,
  gradoDeApinamiento,
  type CampoDx,
  type DiagnosticoDetalle,
  type SeccionDelDetalle,
  type ValorDx,
} from "@/lib/orthodontics/diagnostico-detalle";
import {
  ANGLE_OPCIONES,
  FASE_OPCIONES,
  PATRON_OPCIONES,
  SECCIONES_DEL_PASO,
  avanceDelPaso,
  leerNumero,
  type FormularioDelDiagnostico,
  type SeccionDelPaso,
} from "@/lib/orthodontics/diagnostico-formulario";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";
import { Btn } from "../atoms/Btn";
import orto from "../orto.module.css";
import dx from "../diagnostico.module.css";

export interface ArchivoParaElegir {
  id: string;
  nombre: string;
  fecha: string | null;
  url?: string | null;
}

export interface PasoDiagnosticoProps {
  valor: FormularioDelDiagnostico;
  onCambio: (f: FormularioDelDiagnostico) => void;
  /** Sección visible (controlada). Sin ella, el paso lleva la suya. */
  seccion?: SeccionDelPaso;
  onSeccion?: (s: SeccionDelPaso) => void;
  /** Sección donde está el error de la última validación: se marca en el índice. */
  seccionConError?: SeccionDelPaso | null;
  /** false = falta pegar sql/ortodoncia-diagnostico-completo.sql: lo nuevo no se guardará. */
  columna?: boolean;
  /** Archivos del paciente para ligar como registros iniciales. */
  archivos?: { trazados: ArchivoParaElegir[]; escaneos: ArchivoParaElegir[] };
  /** El trazado que se encontró (ligado o del caso), con su enlace firmado. */
  trazado?: ArchivoParaElegir | null;
  /** ANB medido en el trazado del caso: se ofrece como referencia. */
  anbDelTrazado?: number | null;
  fotosIniciales?: boolean;
  /** "abrir": el resumen puede quedar para después. */
  modo?: "abrir" | "editar";
}

const ICONO_DE_SECCION: Record<SeccionDelPaso, ReactNode> = {
  clasificacion: <Ruler size={15} strokeWidth={1.75} aria-hidden />,
  facial: <User size={15} strokeWidth={1.75} aria-hidden />,
  oclusal: <Crosshair size={15} strokeWidth={1.75} aria-hidden />,
  dentoalveolar: <Smile size={15} strokeWidth={1.75} aria-hidden />,
  funcional: <Activity size={15} strokeWidth={1.75} aria-hidden />,
  cefalometria: <Layers size={15} strokeWidth={1.75} aria-hidden />,
  etiologia: <GitBranch size={15} strokeWidth={1.75} aria-hidden />,
  registros: <FolderOpen size={15} strokeWidth={1.75} aria-hidden />,
  resumen: <AlignLeft size={15} strokeWidth={1.75} aria-hidden />,
};

export function PasoDiagnostico(props: PasoDiagnosticoProps) {
  const [propia, setPropia] = useState<SeccionDelPaso>("clasificacion");
  const seccion = props.seccion ?? propia;
  const irA = (s: SeccionDelPaso) => {
    if (props.onSeccion) props.onSeccion(s);
    else setPropia(s);
  };
  const f = props.valor;
  const set = (p: Partial<FormularioDelDiagnostico>) => props.onCambio({ ...f, ...p });
  const setDetalle: SetDetalle = (sec, clave, v, ademas) =>
    props.onCambio({ ...f, detalle: { ...f.detalle, [sec]: { ...f.detalle[sec], [clave]: v, ...(ademas ?? {}) } } as DiagnosticoDetalle });
  const avance = avanceDelPaso(f);
  const i = SECCIONES_DEL_PASO.findIndex((s) => s.clave === seccion);
  const def = SECCIONES_DEL_PASO[i]!;

  return (
    <div className={dx.dxPaso}>
      <nav aria-label="Secciones del diagnóstico">
        <ul className={dx.dxIndice}>
          {SECCIONES_DEL_PASO.map((s) => {
            const a = avance[s.clave];
            return (
              <li key={s.clave}>
                <button
                  type="button"
                  className={[
                    dx.dxIndiceBoton,
                    s.clave === seccion ? dx.dxIndiceActivo : "",
                    props.seccionConError === s.clave ? dx.dxIndiceError : "",
                  ].join(" ")}
                  aria-current={s.clave === seccion ? "step" : undefined}
                  onClick={() => irA(s.clave)}
                >
                  {ICONO_DE_SECCION[s.clave]}
                  <span className={dx.dxIndiceNombre}>{s.titulo}</span>
                  <span className={`${dx.dxIndiceCuenta} ${a.llenos > 0 && a.llenos >= Math.min(a.total, 2) ? dx.dxIndiceCuentaLlena : ""}`}>
                    {a.llenos}/{a.total}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={dx.dxContenido}>
        <header className={dx.dxContenidoCabeza}>
          <h4 className={dx.dxContenidoTitulo}>{def.titulo}</h4>
          <p className={dx.dxContenidoSub}>{def.sub}</p>
        </header>

        {props.columna === false && ["facial", "oclusal", "dentoalveolar", "funcional", "cefalometria"].includes(seccion) ? (
          <div className={dx.dxAviso} role="status">
            <AlertTriangle size={15} strokeWidth={1.75} aria-hidden />
            <span>Falta pegar sql/ortodoncia-diagnostico-completo.sql: lo de esta sección todavía no se guarda (Angle, overjet, hábitos, ATM y resumen sí).</span>
          </div>
        ) : null}

        {seccion === "clasificacion" ? <Clasificacion f={f} set={set} /> : null}
        {seccion === "facial" ? <Grupos seccion="facial" d={f.detalle} setDetalle={setDetalle} /> : null}
        {seccion === "oclusal" ? <Grupos seccion="oclusal" d={f.detalle} setDetalle={setDetalle} /> : null}
        {seccion === "dentoalveolar" ? <Dentoalveolar f={f} set={set} setDetalle={setDetalle} /> : null}
        {seccion === "funcional" ? <Funcional f={f} set={set} setDetalle={setDetalle} /> : null}
        {seccion === "cefalometria" ? (
          <Cefalometria f={f} set={set} setDetalle={setDetalle} trazado={props.trazado ?? null} anbDelTrazado={props.anbDelTrazado ?? null} />
        ) : null}
        {seccion === "etiologia" ? <Etiologia f={f} set={set} /> : null}
        {seccion === "registros" ? (
          <Registros f={f} set={set} archivos={props.archivos ?? { trazados: [], escaneos: [] }} fotosIniciales={props.fotosIniciales ?? false} />
        ) : null}
        {seccion === "resumen" ? <Resumen f={f} set={set} modo={props.modo ?? "editar"} /> : null}

        <div className={dx.dxNavegacion}>
          {i > 0 ? (
            <Btn variant="ghost" size="sm" icon={<ArrowLeft size={14} strokeWidth={1.75} aria-hidden />} onClick={() => irA(SECCIONES_DEL_PASO[i - 1]!.clave)}>
              {SECCIONES_DEL_PASO[i - 1]!.titulo}
            </Btn>
          ) : (
            <span />
          )}
          {i < SECCIONES_DEL_PASO.length - 1 ? (
            <Btn variant="secondary" size="sm" onClick={() => irA(SECCIONES_DEL_PASO[i + 1]!.clave)}>
              {SECCIONES_DEL_PASO[i + 1]!.titulo} <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
            </Btn>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────────────

type Set = (p: Partial<FormularioDelDiagnostico>) => void;
/** `ademas`: otros campos de la MISMA sección que cambian en el mismo gesto (una sola actualización). */
type SetDetalle = (sec: SeccionDelDetalle, clave: string, v: ValorDx, ademas?: Record<string, ValorDx>) => void;

function Campo({ etiqueta, pista, ancho, dictado, children }: { etiqueta: string; pista?: ReactNode; ancho?: boolean; dictado?: (texto: string) => void; children: ReactNode }) {
  return (
    <div className={`${dx.dxCampo} ${ancho ? dx.dxCampoAncho : ""}`} role="group" aria-label={etiqueta}>
      <div className={dx.dxCampoEtiqueta}>
        <span>{etiqueta}</span>
        {pista ? <span className={dx.dxCampoPista}>{pista}</span> : null}
        {dictado ? <DictationMic onText={dictado} /> : null}
      </div>
      {children}
    </div>
  );
}

/** Segmentado: una opción o ninguna (pulsar la elegida la quita: «—»). */
function Opciones({
  opciones,
  valor,
  onCambio,
  obligatoria,
  etiqueta,
}: {
  opciones: ReadonlyArray<{ valor: string; etiqueta: string; normal?: boolean }>;
  valor: string | null;
  onCambio: (v: string | null) => void;
  obligatoria?: boolean;
  etiqueta: string;
}) {
  return (
    <div className={dx.dxOpciones} role="radiogroup" aria-label={etiqueta}>
      {opciones.map((o) => {
        const on = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={on}
            className={[dx.dxOpcion, on ? dx.dxOpcionElegida : "", o.normal ? dx.dxOpcionNormal : ""].join(" ")}
            title={o.normal ? "Valor de referencia" : undefined}
            onClick={() => onCambio(on ? (obligatoria ? o.valor : null) : o.valor)}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}

function Varias({
  opciones,
  valor,
  onCambio,
  exclusiva,
  etiqueta,
}: {
  opciones: ReadonlyArray<{ valor: string; etiqueta: string; normal?: boolean }>;
  valor: string[];
  onCambio: (v: string[]) => void;
  /** La opción que excluye a las demás («Sin alteraciones»). */
  exclusiva?: string;
  etiqueta: string;
}) {
  return (
    <div className={dx.dxOpciones} role="group" aria-label={etiqueta}>
      {opciones.map((o) => {
        const on = valor.includes(o.valor);
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={on}
            className={[dx.dxOpcion, on ? dx.dxOpcionElegida : "", o.normal ? dx.dxOpcionNormal : ""].join(" ")}
            onClick={() => {
              if (on) return onCambio(valor.filter((x) => x !== o.valor));
              if (exclusiva && o.valor === exclusiva) return onCambio([o.valor]);
              onCambio([...valor.filter((x) => x !== exclusiva), o.valor]);
            }}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}

function Interruptor({ on, onCambio, children }: { on: boolean; onCambio: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} className={`${dx.dxOpcion} ${on ? dx.dxOpcionElegida : ""}`} onClick={() => onCambio(!on)}>
      {children}
    </button>
  );
}

function Numero({ valor, onCambio, unidad, etiqueta, paso = 0.5 }: { valor: string; onCambio: (v: string) => void; unidad: string; etiqueta: string; paso?: number }) {
  const malo = leerNumero(valor) === "invalido";
  return (
    <div className={dx.dxNumero}>
      <input
        type="text"
        inputMode="decimal"
        value={valor}
        aria-label={etiqueta}
        aria-invalid={malo || undefined}
        placeholder="—"
        onChange={(e) => onCambio(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const n = leerNumero(valor);
          const base = typeof n === "number" ? n : 0;
          onCambio(String(Math.round((base + (e.key === "ArrowUp" ? paso : -paso)) * 10) / 10));
        }}
        className={orto.entrada}
      />
      {unidad ? <span className={dx.dxUnidad}>{unidad}</span> : null}
    </div>
  );
}

function Derivado({ texto, estado }: { texto: string; estado: "normal" | "alterado" | null }) {
  return (
    <span className={`${dx.dxDerivado} ${estado === "normal" ? dx.dxDerivadoNormal : estado === "alterado" ? dx.dxDerivadoAlterado : ""}`} title="Se propone solo desde los mm">
      {texto}
    </span>
  );
}

function numeroComoTexto(v: ValorDx): string {
  return typeof v === "number" ? String(v) : "";
}

/** Un campo del detalle, pintado desde la tabla de lib/orthodontics/diagnostico-detalle. */
function CampoDelDetalle({ seccion, c, d, setDetalle }: { seccion: SeccionDelDetalle; c: CampoDx; d: DiagnosticoDetalle; setDetalle: SetDetalle }) {
  const v = d[seccion][c.clave];
  if (c.tipo === "opcion") {
    const esLineaMedia = c.clave === "lineaMediaSuperior" || c.clave === "lineaMediaInferior";
    return (
      <Campo etiqueta={c.etiqueta} ancho={c.opciones.length > 3 || esLineaMedia}>
        <div className={dx.dxFila}>
          <Opciones
            etiqueta={c.etiqueta}
            opciones={c.opciones}
            valor={(v as string | null) ?? null}
            onCambio={(nv) =>
              // Centrada (o sin dato) no lleva milímetros.
              setDetalle(seccion, c.clave, nv, esLineaMedia && (nv === "centrada" || nv === null) ? { [`${c.clave}Mm`]: null } : undefined)
            }
          />
          {esLineaMedia && (v === "derecha" || v === "izquierda") ? (
            <DetalleNumero seccion={seccion} clave={`${c.clave}Mm`} d={d} setDetalle={setDetalle} etiqueta={`${c.etiqueta} (mm)`} />
          ) : null}
        </div>
      </Campo>
    );
  }
  if (c.tipo === "varias") {
    return (
      <Campo etiqueta={c.etiqueta} ancho>
        <Varias
          etiqueta={c.etiqueta}
          opciones={c.opciones}
          valor={(v as string[]) ?? []}
          exclusiva={c.opciones.find((o) => o.normal)?.valor}
          onCambio={(nv) => setDetalle(seccion, c.clave, nv)}
        />
      </Campo>
    );
  }
  if (c.tipo === "numero") {
    return (
      <Campo etiqueta={c.etiqueta} pista={`${c.min} a ${c.max}`}>
        <DetalleNumero seccion={seccion} clave={c.clave} d={d} setDetalle={setDetalle} etiqueta={c.etiqueta} />
      </Campo>
    );
  }
  return (
    <Campo
      etiqueta={c.etiqueta}
      pista={c.pista}
      ancho={c.largo}
      dictado={c.largo ? (t) => setDetalle(seccion, c.clave, appendDictado(v as string | null, t, " ", c.max) || null) : undefined}
    >
      {c.largo ? (
        <textarea
          className={`${orto.entrada} min-h-[72px]`}
          value={(v as string | null) ?? ""}
          maxLength={c.max}
          onChange={(e) => setDetalle(seccion, c.clave, e.target.value || null)}
        />
      ) : (
        <input
          type="text"
          className={orto.entrada}
          value={(v as string | null) ?? ""}
          maxLength={c.max}
          onChange={(e) => setDetalle(seccion, c.clave, e.target.value || null)}
        />
      )}
    </Campo>
  );
}

/**
 * Número del detalle: se guarda el texto a medio escribir en local y el número al salir del campo o cuando
 * ya es un número válido (así «-» o «2,» no se pierden mientras se teclea).
 */
function DetalleNumero({ seccion, clave, d, setDetalle, etiqueta }: { seccion: SeccionDelDetalle; clave: string; d: DiagnosticoDetalle; setDetalle: SetDetalle; etiqueta: string }) {
  const c = SECCIONES_DEL_DETALLE.find((s) => s.clave === seccion)!.campos.find((x) => x.clave === clave);
  const unidad = c?.tipo === "numero" ? c.unidad : "mm";
  const paso = c?.tipo === "numero" ? c.paso : 0.5;
  const guardado = numeroComoTexto(d[seccion][clave]);
  const [texto, setTexto] = useState<string | null>(null);
  return (
    <Numero
      etiqueta={etiqueta}
      unidad={unidad}
      paso={paso}
      valor={texto ?? guardado}
      onCambio={(t) => {
        setTexto(t);
        const n = leerNumero(t);
        if (n === null) setDetalle(seccion, clave, null);
        else if (n !== "invalido") setDetalle(seccion, clave, n);
      }}
    />
  );
}

/** Los campos de una sección del detalle, agrupados por su `grupo`. `omitir` = los que la sección pinta a mano. */
function Grupos({ seccion, d, setDetalle, omitir = [] }: { seccion: SeccionDelDetalle; d: DiagnosticoDetalle; setDetalle: SetDetalle; omitir?: string[] }) {
  const def = SECCIONES_DEL_DETALLE.find((s) => s.clave === seccion)!;
  const campos = def.campos.filter((c) => !omitir.includes(c.clave) && !/^lineaMedia(Superior|Inferior)Mm$/.test(c.clave));
  const grupos: Array<{ titulo: string | null; campos: CampoDx[] }> = [];
  for (const c of campos) {
    const g = c.grupo ?? null;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.titulo === g) ultimo.campos.push(c);
    else grupos.push({ titulo: g, campos: [c] });
  }
  return (
    <>
      {grupos.map((g, k) => (
        <section key={k} className={dx.dxGrupo}>
          {g.titulo ? <h5 className={dx.dxGrupoTitulo}>{g.titulo}</h5> : null}
          <div className={dx.dxCampos}>
            {g.campos.map((c) => (
              <CampoDelDetalle key={c.clave} seccion={seccion} c={c} d={d} setDetalle={setDetalle} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ─── Secciones con columnas de siempre ──────────────────────────────────

function Clasificacion({ f, set }: { f: FormularioDelDiagnostico; set: Set }) {
  const oj = leerNumero(f.overjetMm);
  const ob = leerNumero(f.overbiteMm);
  const cOj = typeof oj === "number" ? categoriaOverjet(oj) : null;
  const cOb = typeof ob === "number" ? categoriaOverbite(ob) : null;
  return (
    <>
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>Clase de Angle (dental)</h5>
        {/* Sin elegir = «sin capturar» (no se dice Clase I). Tocar la elegida la quita. */}
        <div className={dx.dxCampos}>
          <Campo etiqueta="Lado derecho" ancho>
            <Opciones etiqueta="Angle derecha" opciones={ANGLE_OPCIONES.map((o) => ({ ...o, normal: o.valor === "CLASS_I" }))} valor={f.angleClassRight} onCambio={(v) => set({ angleClassRight: v ?? "" })} />
          </Campo>
          <Campo etiqueta="Lado izquierdo" ancho>
            <Opciones etiqueta="Angle izquierda" opciones={ANGLE_OPCIONES.map((o) => ({ ...o, normal: o.valor === "CLASS_I" }))} valor={f.angleClassLeft} onCambio={(v) => set({ angleClassLeft: v ?? "" })} />
          </Campo>
        </div>
      </section>
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>Overjet y overbite</h5>
        <div className={`${dx.dxCampos} ${dx.dxCampos3}`}>
          <Campo etiqueta="Overjet" pista="ref. 1 a 4 mm">
            <div className={dx.dxFila}>
              <Numero etiqueta="Overjet (mm)" unidad="mm" valor={f.overjetMm} onCambio={(v) => set({ overjetMm: v })} />
              {cOj ? <Derivado texto={etiquetaDeCategoria(cOj)} estado={cOj === "normal" ? "normal" : "alterado"} /> : null}
            </div>
          </Campo>
          <Campo etiqueta="Overbite" pista="ref. 1 a 4 mm">
            <div className={dx.dxFila}>
              <Numero etiqueta="Overbite (mm)" unidad="mm" valor={f.overbiteMm} onCambio={(v) => set({ overbiteMm: v })} />
              {cOb ? <Derivado texto={etiquetaDeCategoria(cOb)} estado={cOb === "normal" ? "normal" : "alterado"} /> : null}
            </div>
          </Campo>
          <Campo etiqueta="Overbite" pista="% de cobertura">
            <Numero etiqueta="Overbite (%)" unidad="%" paso={5} valor={f.overbitePercentage} onCambio={(v) => set({ overbitePercentage: v })} />
          </Campo>
        </div>
      </section>
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>Dentición</h5>
        <Campo etiqueta="Etapa de dentición" ancho>
          <Opciones etiqueta="Etapa de dentición" opciones={FASE_OPCIONES} valor={f.dentalPhase} onCambio={(v) => set({ dentalPhase: v ?? "" })} />
        </Campo>
      </section>
    </>
  );
}

function Dentoalveolar({ f, set, setDetalle }: { f: FormularioDelDiagnostico; set: Set; setDetalle: SetDetalle }) {
  const grado = (t: string) => {
    const n = leerNumero(t);
    return typeof n === "number" ? gradoDeApinamiento(n) : null;
  };
  const gS = grado(f.crowdingUpperMm);
  const gI = grado(f.crowdingLowerMm);
  return (
    <>
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>Apiñamiento (discrepancia)</h5>
        <div className={dx.dxCampos}>
          <Campo etiqueta="Superior" pista="0 a 20 mm">
            <div className={dx.dxFila}>
              <Numero etiqueta="Apiñamiento superior (mm)" unidad="mm" valor={f.crowdingUpperMm} onCambio={(v) => set({ crowdingUpperMm: v })} />
              {gS ? <Derivado texto={gS[0]!.toUpperCase() + gS.slice(1)} estado="alterado" /> : null}
            </div>
          </Campo>
          <Campo etiqueta="Inferior" pista="0 a 20 mm">
            <div className={dx.dxFila}>
              <Numero etiqueta="Apiñamiento inferior (mm)" unidad="mm" valor={f.crowdingLowerMm} onCambio={(v) => set({ crowdingLowerMm: v })} />
              {gI ? <Derivado texto={gI[0]!.toUpperCase() + gI.slice(1)} estado="alterado" /> : null}
            </div>
          </Campo>
        </div>
      </section>
      <Grupos seccion="dentoalveolar" d={f.detalle} setDetalle={setDetalle} />
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>Detalle de las mordidas</h5>
        <div className={dx.dxCampos}>
          <Campo etiqueta="Mordida cruzada" pista="piezas o zona">
            <input type="text" className={orto.entrada} maxLength={500} value={f.crossbiteDetails} placeholder="p. ej. 15-45 y 16-46" onChange={(e) => set({ crossbiteDetails: e.target.value })} />
          </Campo>
          <Campo etiqueta="Mordida abierta" pista="piezas o zona">
            <input type="text" className={orto.entrada} maxLength={500} value={f.openBiteDetails} placeholder="p. ej. de 13 a 23, 3 mm" onChange={(e) => set({ openBiteDetails: e.target.value })} />
          </Campo>
        </div>
      </section>
    </>
  );
}

function Funcional({ f, set, setDetalle }: { f: FormularioDelDiagnostico; set: Set; setDetalle: SetDetalle }) {
  return (
    <>
      <Grupos seccion="funcional" d={f.detalle} setDetalle={setDetalle} />
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>Hábitos</h5>
        <Campo etiqueta="Hábitos parafuncionales" pista="la respiración oral va arriba" ancho>
          <Varias etiqueta="Hábitos" opciones={HABITOS_DEL_PASO.map((h) => ({ valor: h, etiqueta: HABITO[h]! }))} valor={f.habits} onCambio={(v) => set({ habits: v })} />
        </Campo>
        <Campo etiqueta="Descripción de hábitos" ancho dictado={(t) => set({ habitsDescription: appendDictado(f.habitsDescription, t, " ", 1000) })}>
          <textarea className={`${orto.entrada} min-h-[60px]`} maxLength={1000} value={f.habitsDescription} onChange={(e) => set({ habitsDescription: e.target.value })} />
        </Campo>
      </section>
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>ATM</h5>
        <div className={dx.dxInterruptores}>
          {/* Nada encendido = ATM sin capturar; «Sin dolor ni chasquido» es un hallazgo y se marca a propósito. */}
          <Interruptor
            on={f.atmRevisada && !f.tmjPainPresent && !f.tmjClickingPresent}
            onCambio={(v) => set({ atmRevisada: v, tmjPainPresent: false, tmjClickingPresent: false })}
          >
            Sin dolor ni chasquido
          </Interruptor>
          <Interruptor on={f.tmjPainPresent} onCambio={(v) => set({ tmjPainPresent: v, atmRevisada: v || f.tmjClickingPresent })}>Dolor</Interruptor>
          <Interruptor on={f.tmjClickingPresent} onCambio={(v) => set({ tmjClickingPresent: v, atmRevisada: v || f.tmjPainPresent })}>Chasquido</Interruptor>
        </div>
        <Campo etiqueta="Notas de ATM" ancho dictado={(t) => set({ tmjNotes: appendDictado(f.tmjNotes, t, " ", 500) })}>
          <textarea className={`${orto.entrada} min-h-[60px]`} maxLength={500} value={f.tmjNotes} onChange={(e) => set({ tmjNotes: e.target.value })} />
        </Campo>
      </section>
    </>
  );
}

function Cefalometria({
  f,
  set,
  setDetalle,
  trazado,
  anbDelTrazado,
}: {
  f: FormularioDelDiagnostico;
  set: Set;
  setDetalle: SetDetalle;
  trazado: ArchivoParaElegir | null;
  anbDelTrazado: number | null;
}) {
  const d = f.detalle;
  return (
    <>
      {trazado ? (
        <div className={dx.dxReferencia}>
          <span className="inline-flex items-center gap-2 min-w-0">
            <FileText size={15} strokeWidth={1.75} aria-hidden />
            <span className="[overflow-wrap:anywhere]">Trazado: {trazado.nombre}</span>
          </span>
          {trazado.url ? (
            <a className={dx.dxEnlace} href={trazado.url} target="_blank" rel="noopener noreferrer">
              Abrir PDF
            </a>
          ) : null}
        </div>
      ) : null}
      <section className={dx.dxGrupo}>
        <h5 className={dx.dxGrupoTitulo}>VERT (Ricketts)</h5>
        <div className={dx.dxCampos}>
          <CampoDelDetalle seccion="cefalometria" c={campo("cefalometria", "vertValor")} d={d} setDetalle={setDetalle} />
          <CampoDelDetalle seccion="cefalometria" c={campo("cefalometria", "vertNivel")} d={d} setDetalle={setDetalle} />
          <Campo etiqueta="Tipo (patrón esquelético)" ancho>
            <Opciones
              etiqueta="Patrón esquelético"
              opciones={PATRON_OPCIONES.map((o) => ({ ...o, normal: o.valor === "MESOFACIAL" }))}
              valor={f.skeletalPattern || null}
              onCambio={(v) => set({ skeletalPattern: v ?? "" })}
            />
          </Campo>
        </div>
      </section>
      {anbDelTrazado !== null && d.cefalometria.anb === null ? (
        <div className={dx.dxReferencia}>
          <span>ANB medido en el trazado del caso: <strong>{anbDelTrazado}°</strong></span>
          <Btn variant="secondary" size="sm" onClick={() => setDetalle("cefalometria", "anb", anbDelTrazado)}>
            Usarlo
          </Btn>
        </div>
      ) : null}
      <Grupos seccion="cefalometria" d={d} setDetalle={setDetalle} omitir={["vertValor", "vertNivel"]} />
    </>
  );
}

function campo(seccion: SeccionDelDetalle, clave: string): CampoDx {
  return SECCIONES_DEL_DETALLE.find((s) => s.clave === seccion)!.campos.find((c) => c.clave === clave)!;
}

function Etiologia({ f, set }: { f: FormularioDelDiagnostico; set: Set }) {
  return (
    <section className={dx.dxGrupo}>
      <Campo etiqueta="Origen de la maloclusión" pista="puede ser más de uno" ancho>
        <div className={dx.dxInterruptores}>
          <Interruptor on={f.etiologySkeletal} onCambio={(v) => set({ etiologySkeletal: v })}>Esquelética</Interruptor>
          <Interruptor on={f.etiologyDental} onCambio={(v) => set({ etiologyDental: v })}>Dental</Interruptor>
          <Interruptor on={f.etiologyFunctional} onCambio={(v) => set({ etiologyFunctional: v })}>Funcional</Interruptor>
        </div>
      </Campo>
      <Campo etiqueta="Notas de etiología" ancho dictado={(t) => set({ etiologyNotes: appendDictado(f.etiologyNotes, t, " ", 1000) })}>
        <textarea className={`${orto.entrada} min-h-[72px]`} maxLength={1000} value={f.etiologyNotes} onChange={(e) => set({ etiologyNotes: e.target.value })} />
      </Campo>
    </section>
  );
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function Registros({
  f,
  set,
  archivos,
  fotosIniciales,
}: {
  f: FormularioDelDiagnostico;
  set: Set;
  archivos: { trazados: ArchivoParaElegir[]; escaneos: ArchivoParaElegir[] };
  fotosIniciales: boolean;
}) {
  const opcion = (a: ArchivoParaElegir) => `${a.nombre}${a.fecha ? ` · ${fechaCorta(a.fecha)}` : ""}`;
  return (
    <section className={dx.dxGrupo}>
      <div className={dx.dxCampos}>
        <Campo etiqueta="PDF del trazado cefalométrico" pista={archivos.trazados.length ? `${archivos.trazados.length} en el expediente` : "ninguno subido"} ancho>
          <select className={orto.entrada} value={f.initialCephFileId} onChange={(e) => set({ initialCephFileId: e.target.value })} disabled={archivos.trazados.length === 0 && !f.initialCephFileId}>
            <option value="">— sin ligar (se usa el último del caso) —</option>
            {archivos.trazados.map((a) => (
              <option key={a.id} value={a.id}>{opcion(a)}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Escaneo intraoral" pista={archivos.escaneos.length ? `${archivos.escaneos.length} en el expediente` : "ninguno subido"} ancho>
          <select className={orto.entrada} value={f.initialScanFileId} onChange={(e) => set({ initialScanFileId: e.target.value })} disabled={archivos.escaneos.length === 0 && !f.initialScanFileId}>
            <option value="">— sin ligar —</option>
            {archivos.escaneos.map((a) => (
              <option key={a.id} value={a.id}>{opcion(a)}</option>
            ))}
          </select>
        </Campo>
      </div>
      <p className={dx.dxContenidoSub}>
        {fotosIniciales ? "Las fotos iniciales ya están ligadas al diagnóstico." : "Las fotos iniciales se toman en la sección Fotos del caso."} Los PDF y escaneos se suben en «Imagen y análisis» o en el expediente; el control radiográfico futuro va en el Plan de tratamiento.
      </p>
    </section>
  );
}

function Resumen({ f, set, modo }: { f: FormularioDelDiagnostico; set: Set; modo: "abrir" | "editar" }) {
  const n = f.clinicalSummary.trim().length;
  return (
    <section className={dx.dxGrupo}>
      <Campo
        etiqueta="Resumen diagnóstico"
        pista={<span className={dx.dxContador}>{n === 1 ? "1 carácter" : `${n} caracteres`}</span>}
        ancho
        dictado={(t) => set({ clinicalSummary: appendDictado(f.clinicalSummary, t, "\n", 5000) })}
      >
        <textarea
          className={`${orto.entrada} min-h-[180px]`}
          maxLength={5000}
          value={f.clinicalSummary}
          placeholder="Paciente clase II división 1 dental con perfil convexo, overjet aumentado…"
          onChange={(e) => set({ clinicalSummary: e.target.value })}
        />
      </Campo>
      <p className={dx.dxContenidoSub}>Opcional{modo === "abrir" ? ": el caso se abre sin él" : ""}. Sin mínimo de caracteres.</p>
    </section>
  );
}
