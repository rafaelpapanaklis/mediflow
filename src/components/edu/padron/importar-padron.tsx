"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, FileUp } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest, eduUpload } from "@/components/edu/edu-http";
import { eduCampusLabel, type EduCampusOption } from "@/lib/edu/campus-core";
import type { EduCohortOption, EduProgramOption } from "@/lib/edu/padron-core";
import {
  EDU_IMPORT_CHUNK,
  EDU_IMPORT_ENTIDAD_LABELS,
  EDU_IMPORT_MAX_FILAS,
  eduImportCredencialesTexto,
  eduImportFilasListas,
  eduImportResumen,
  type EduImportCampo,
  type EduImportEntidad,
  type EduImportFila,
  type EduImportMapeo,
  type EduImportResultado,
} from "@/lib/edu/importar-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * IMPORTAR PADRÓN — el asistente de CSV/XLSX para estudiantes y docentes.
 *
 * 🔴 POR QUÉ EXISTE. Dar de alta a una generación entera se hacía pegando
 * texto en un cuadro (el alta masiva de Equipo), renglón por renglón, con
 * el formato exacto y sin ninguna de las dos cosas que un archivo real
 * trae: columnas en otro orden y una hoja de Excel que nadie va a
 * transcribir a mano. Y aunque se pegara bien, quedaba a medias: las 40
 * cuentas se creaban SIN inscribir —sin matrícula, sin especialidad, sin
 * generación— y había que abrir 40 diálogos más.
 *
 * 🔴 CUATRO PASOS, Y EL TERCERO ES EL QUE IMPORTA:
 *   1. SUBIR      — el archivo, y para quién es (estudiantes o docentes).
 *   2. MAPEAR     — qué columna del archivo es cada campo. Se detecta solo
 *                   y se puede corregir; lo que no se reconoce se PREGUNTA
 *                   en vez de adivinarse.
 *   3. SIMULAR    — qué se crearía y qué chocaría (correo repetido,
 *                   matrícula repetida, correo que ya está en el
 *                   instituto), renglón por renglón, ANTES de tocar nada.
 *   4. CONFIRMAR  — se crea, por trozos, con avance.
 *
 * El paso 3 no es una cortesía: cada renglón bueno se convierte en una
 * CUENTA DE ACCESO con su contraseña temporal, y las cuentas de este
 * producto **no se borran** —sus notas clínicas, sus casos y sus cobros las
 * referencian—. Un archivo con una columna de más crearía doscientas
 * cuentas mal y no habría vuelta atrás.
 *
 * ── LA SEDE Y LA GENERACIÓN, EN EL MISMO PASO ─────────────────────────
 * Se eligen UNA vez para todo el archivo y no columna por columna: un
 * archivo de padrón es una generación entrando, y pedir esas columnas en el
 * Excel es pedirle a quien lo arma que teclee cuarenta veces el mismo dato
 * y que se equivoque en una. La sede además cierra el H-112 por el mismo
 * sitio que el alta: sin marcar ninguna, esas cuarenta cuentas entrarían al
 * instituto ENTERO.
 *
 * ── POR QUÉ ESTA LISTA NO LLEVA MODIFICADOR DE TABLA ──────────────────
 * `.edu-table` sin `--algo` es la forma APILADA, que es la que no se puede
 * romper (regla 8 de edu-theme.css). La forma renglón se estrena dentro de
 * un `@container` a partir de 700 px y esta lista vive DENTRO de un modal,
 * cuya tarjeta mide como mucho 560 px: un modificador aquí sería CSS muerto
 * en una hoja compartida por todo el vertical, y un nombre que otra ola
 * podría volver a usar sin saberlo. El envoltorio `.edu-tablewrap` sí va,
 * porque es lo que hace que se DESPLACE en vez de recortar.
 * ═══════════════════════════════════════════════════════════════════════
 */

interface Simulacion {
  entidad: EduImportEntidad;
  columnas: string[];
  mapeoSugerido: EduImportMapeo;
  mapeo: EduImportMapeo;
  filas: EduImportFila[];
  campos: EduImportCampo[];
  archivo: string;
}

/** Cuántos renglones se PINTAN por grupo. Ver el comentario de la lista. */
const MAX_PINTADOS = 50;

/**
 * Copia al portapapeles y avisa. Gemela de la de equipo-screen.tsx: son
 * quince líneas y viven en dos pantallas distintas del mismo vertical;
 * compartirlas obligaría a un archivo cliente nuevo solo para esto.
 * Devuelve `false` si el navegador no dejó —pasa en http sin certificado y
 * en algunos móviles— y entonces se enseña el texto para copiarlo a mano en
 * vez de mentir con una palomita.
 */
async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cae al método de abajo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function EduImportarPadron({
  programs,
  cohorts,
  onClose,
  onDone,
}: {
  programs: EduProgramOption[];
  cohorts: EduCohortOption[];
  onClose: () => void;
  /** Se llama al terminar, con el resumen para el mensaje verde. */
  onDone: (mensaje: string) => void;
}) {
  const [entidad, setEntidad] = useState<EduImportEntidad>("alumnos");
  const [file, setFile] = useState<File | null>(null);
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lo que se elige UNA vez para todo el archivo.
  const [programId, setProgramId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [semestre, setSemestre] = useState("1");
  const [campusIds, setCampusIds] = useState<string[]>([]);
  const [sedes, setSedes] = useState<EduCampusOption[]>([]);

  // El resultado de crear.
  const [resultados, setResultados] = useState<EduImportResultado[] | null>(null);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [copiado, setCopiado] = useState<"listo" | "ok" | "falla">("listo");
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Con qué semestre por defecto se hizo la última lectura. Sin esto, cada
  // vez que el cursor sale del campo se volvería a SUBIR el archivo entero
  // —hasta 5 MB— aunque el número no haya cambiado.
  const semestreLeido = useRef("1");

  useEffect(() => {
    let vivo = true;
    eduRequest<{ rows: EduCampusOption[] }>("/api/instituto/equipo/sedes")
      .then((r) => {
        if (vivo) setSedes(r?.rows ?? []);
      })
      .catch(() => {
        /* sin sedes el selector no se pinta; la importación sigue igual */
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Solo las ACTIVAS: no se inscribe a nadie en una especialidad cerrada ni
  // en una generación cerrada, y el servidor lo vuelve a rechazar (H-109).
  const programasAbiertos = useMemo(() => programs.filter((p) => p.isActive), [programs]);
  const generacionesAbiertas = useMemo(
    () => cohorts.filter((c) => c.isActive && (!programId || c.programId === programId)),
    [cohorts, programId],
  );

  const listas = sim ? eduImportFilasListas(sim.filas) : [];
  const resumen = sim ? eduImportResumen(sim.filas) : null;
  const conProblema = sim ? sim.filas.filter((f) => f.estado !== "ok") : [];

  const faltaGeneracion = entidad === "alumnos" && (!programId || !cohortId);

  /** Sube el archivo y pide la simulación. `mapeo` va cuando se corrigió. */
  async function simular(mapeo?: EduImportMapeo) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entidad", entidad);
      form.append("semestre", semestre);
      if (mapeo) form.append("mapeo", JSON.stringify(mapeo));
      const res = await eduUpload<Simulacion>("/api/instituto/padron/importar", form);
      semestreLeido.current = semestre;
      setSim(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setBusy(false);
    }
  }

  /** Cambia a qué campo va una columna y vuelve a simular con el nuevo mapeo. */
  async function cambiarMapeo(columna: string, campo: string) {
    if (!sim) return;
    const siguiente: EduImportMapeo = { ...sim.mapeo };
    // Un campo solo puede venir de UNA columna: si se reasigna, la anterior
    // se suelta. Sin esto, dos columnas al mismo campo dejarían el resultado
    // a merced del orden de las claves del objeto.
    if (campo) {
      for (const [col, c] of Object.entries(siguiente)) {
        if (c === campo && col !== columna) delete siguiente[col];
      }
      siguiente[columna] = campo;
    } else {
      delete siguiente[columna];
    }
    setSim({ ...sim, mapeo: siguiente });
    await simular(siguiente);
  }

  async function crear() {
    if (!sim || listas.length === 0) return;
    setError(null);
    setBusy(true);
    const acumulado: EduImportResultado[] = [];
    try {
      setProgreso({ hechas: 0, total: listas.length });
      for (let i = 0; i < listas.length; i += EDU_IMPORT_CHUNK) {
        const trozo = listas.slice(i, i + EDU_IMPORT_CHUNK);
        const res = await eduRequest<{ resultados: EduImportResultado[] }>(
          "/api/instituto/padron/importar/confirmar",
          {
            method: "POST",
            body: {
              entidad: sim.entidad,
              archivo: sim.archivo,
              programId: sim.entidad === "alumnos" ? programId : undefined,
              cohortId: sim.entidad === "alumnos" ? cohortId : undefined,
              campusIds,
              semestre,
              filas: trozo.map((f) => ({
                linea: f.linea,
                firstName: f.datos.firstName,
                lastName: f.datos.lastName,
                email: f.datos.email,
                phone: f.datos.phone,
                matricula: f.datos.matricula ?? null,
                semester: f.datos.semester ?? null,
              })),
            },
          },
        );
        acumulado.push(...(res?.resultados ?? []));
        // Se cuenta lo REALMENTE contestado, no el índice del bucle: si un
        // trozo devuelve menos filas de las que se mandaron, el contador
        // tiene que decir la verdad.
        setProgreso({ hechas: acumulado.length, total: listas.length });
      }
      setResultados(acumulado);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : "Se cortó la importación.";
      if (acumulado.length > 0) {
        // 🔴 Lo que ya se creó, se creó: no se puede deshacer (las cuentas no
        // se borran) y tampoco habría que hacerlo. Se enseñan esas
        // credenciales y se dice hasta dónde se llegó, en vez de perderlas
        // junto con el error.
        setResultados(acumulado);
        setError(
          `${mensaje} Se alcanzaron a crear ${acumulado.filter((r) => r.ok).length} de ${listas.length}: copia sus contraseñas y vuelve a subir el archivo con el resto.`,
        );
      } else {
        setError(mensaje);
      }
    } finally {
      setBusy(false);
    }
  }

  // ── El pie cambia con el paso ─────────────────────────────────────────
  const creadas = resultados?.filter((r) => r.ok).length ?? 0;
  const sinInscribir = resultados?.filter((r) => r.ok && !r.inscrito).length ?? 0;

  function cerrarConResumen() {
    if (!resultados) {
      onClose();
      return;
    }
    const partes = [
      `Se crearon ${creadas} ${creadas === 1 ? "cuenta" : "cuentas"} de ${EDU_IMPORT_ENTIDAD_LABELS[entidad].toLowerCase()}.`,
    ];
    if (sinInscribir > 0) {
      partes.push(
        `${sinInscribir} ${sinInscribir === 1 ? "quedó" : "quedaron"} sin inscribir: revísalo en Equipo.`,
      );
    }
    onDone(partes.join(" "));
  }

  return (
    <EduModal
      title="Importar padrón"
      subtitle={
        resultados
          ? "Copia las contraseñas antes de cerrar: se ven una sola vez."
          : "Sube el archivo, revisa qué se va a crear y confirma."
      }
      onClose={resultados ? cerrarConResumen : onClose}
      busy={busy}
      footer={
        resultados ? (
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={cerrarConResumen}
            disabled={busy}
          >
            Ya las copié
          </button>
        ) : (
          <>
            <button
              type="button"
              className="edu-btn edu-btn--ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
            {!sim ? (
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={() => simular()}
                disabled={busy || !file}
              >
                {busy ? "Leyendo…" : "Leer el archivo"}
              </button>
            ) : (
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={crear}
                disabled={busy || listas.length === 0 || faltaGeneracion}
              >
                {busy
                  ? `Creando ${progreso?.hechas ?? 0} de ${progreso?.total ?? listas.length}…`
                  : listas.length === 0
                    ? "Nada que crear"
                    : `Crear ${listas.length} ${listas.length === 1 ? "cuenta" : "cuentas"}`}
              </button>
            )}
          </>
        )
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {/* ── PASO 4 · lo que quedó ──────────────────────────────────────── */}
      {resultados ? (
        <ResultadosImportacion
          entidad={entidad}
          resultados={resultados}
          copiado={copiado}
          onCopiar={async () => {
            const ok = await copiar(eduImportCredencialesTexto(resultados, entidad));
            setCopiado(ok ? "ok" : "falla");
            window.setTimeout(() => setCopiado("listo"), 2200);
          }}
        />
      ) : (
        <>
          {/* ── PASO 1 · para quién y qué archivo ───────────────────────── */}
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-imp-entidad">
              Qué estás importando
            </label>
            <select
              id="edu-imp-entidad"
              className="edu-input"
              value={entidad}
              onChange={(e) => {
                // Cambiar de entidad invalida la lectura: las columnas
                // obligatorias no son las mismas (un docente no lleva
                // matrícula). Se vuelve a empezar en vez de arrastrar un
                // mapeo que ya no significa lo mismo.
                setEntidad(e.target.value as EduImportEntidad);
                setSim(null);
              }}
              disabled={busy || Boolean(sim)}
            >
              <option value="alumnos">Estudiantes (crea su cuenta y los inscribe)</option>
              <option value="docentes">Docentes (crea su cuenta)</option>
            </select>
            <span className="edu-field__hint">
              {entidad === "alumnos"
                ? "Cada renglón crea una cuenta de acceso Y su ficha académica, con la matrícula del archivo."
                : "Cada renglón crea una cuenta de acceso con rol Docente. Las supervisiones se asignan después, en Estudiantes."}
            </span>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-imp-file">
              Archivo (.xlsx o .csv)
            </label>
            <input
              id="edu-imp-file"
              ref={fileRef}
              className="edu-input"
              type="file"
              accept=".xlsx,.csv"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setSim(null);
                setError(null);
              }}
            />
            <span className="edu-field__hint">
              La primera fila tiene que traer los nombres de las columnas. Hasta{" "}
              {EDU_IMPORT_MAX_FILAS} renglones y 5 MB. No hace falta un orden concreto: en el
              siguiente paso se dice qué columna es qué.
            </span>
          </div>

          {/* ── PASO 2 · el mapeo ───────────────────────────────────────── */}
          {sim && (
            <section className="edu-section">
              <h3 className="edu-section__title">Qué columna es qué</h3>
              <p className="edu-section__lead">
                Se detectó solo lo que se reconoció. Corrige lo que haga falta: lo que quede en
                «No importar» no se guarda.
              </p>
              {sim.columnas.map((col) => (
                <div className="edu-field" key={col}>
                  <label className="edu-field__label" htmlFor={`edu-imp-col-${col}`}>
                    {col}
                  </label>
                  <select
                    id={`edu-imp-col-${col}`}
                    className="edu-input edu-input--sm"
                    value={sim.mapeo[col] ?? ""}
                    onChange={(e) => cambiarMapeo(col, e.target.value)}
                    disabled={busy}
                  >
                    <option value="">No importar</option>
                    {sim.campos.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                        {c.requerido ? " (obligatorio)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
          )}

          {/* ── PASO 2b · lo que vale para TODO el archivo ──────────────── */}
          {sim && entidad === "alumnos" && (
            <section className="edu-section">
              <h3 className="edu-section__title">Dónde se inscriben</h3>
              <p className="edu-section__lead">
                Vale para todos los renglones del archivo: un archivo de padrón es una generación
                entrando.
              </p>

              <div className="edu-formgrid edu-formgrid--2">
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor="edu-imp-prog">
                    Especialidad
                  </label>
                  <select
                    id="edu-imp-prog"
                    className="edu-input"
                    value={programId}
                    onChange={(e) => {
                      setProgramId(e.target.value);
                      setCohortId("");
                    }}
                    disabled={busy}
                  >
                    <option value="">Elige…</option>
                    {programasAbiertos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="edu-field">
                  <label className="edu-field__label" htmlFor="edu-imp-gen">
                    Generación
                  </label>
                  <select
                    id="edu-imp-gen"
                    className="edu-input"
                    value={cohortId}
                    onChange={(e) => setCohortId(e.target.value)}
                    disabled={busy || !programId}
                  >
                    <option value="">{programId ? "Elige…" : "Elige la especialidad"}</option>
                    {generacionesAbiertas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-imp-sem">
                  Semestre para los renglones que no lo traigan
                </label>
                <input
                  id="edu-imp-sem"
                  className="edu-input edu-input--sm"
                  type="number"
                  min={1}
                  max={20}
                  value={semestre}
                  onChange={(e) => setSemestre(e.target.value)}
                  disabled={busy}
                  // Solo si de verdad cambió: volver a subir el archivo por
                  // cada vez que el cursor sale del campo es subir 5 MB para
                  // nada.
                  onBlur={() => {
                    if (semestre !== semestreLeido.current) void simular(sim.mapeo);
                  }}
                />
                <span className="edu-field__hint">
                  Si el archivo trae columna de semestre, manda la del archivo.
                </span>
              </div>

              {programasAbiertos.length === 0 && (
                <p className="edu-note">
                  Todavía no hay ninguna especialidad activa. Créala en «Especialidades y
                  generaciones» antes de importar: sin ella no se puede inscribir a nadie.
                </p>
              )}
            </section>
          )}

          {sim && sedes.length > 1 && (
            <section className="edu-section">
              <h3 className="edu-section__title">Sedes</h3>
              {/* 🔴 H-112 · sin marcar ninguna, estas cuentas entran al
                  instituto ENTERO. Es la regla de la ola de sedes (sin filas
                  = todas) y es justo la que sorprende leída al derecho, así
                  que se dice con todas las letras. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sedes.map((c) => (
                  <label
                    key={c.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}
                  >
                    <input
                      type="checkbox"
                      checked={campusIds.includes(c.id)}
                      onChange={() =>
                        setCampusIds((prev) =>
                          prev.includes(c.id)
                            ? prev.filter((x) => x !== c.id)
                            : [...prev, c.id],
                        )
                      }
                      disabled={busy}
                    />
                    <span style={{ overflowWrap: "anywhere" }}>{eduCampusLabel(c)}</span>
                  </label>
                ))}
              </div>
              <p className="edu-note">
                {campusIds.length === 0
                  ? "Sin marcar ninguna, todas estas cuentas entrarán a TODAS las sedes del instituto."
                  : `Entrarán solo a ${campusIds.length === 1 ? "esa sede" : `esas ${campusIds.length} sedes`}. Se puede cambiar después, persona por persona.`}
              </p>
            </section>
          )}

          {/* ── PASO 3 · la simulación ──────────────────────────────────── */}
          {sim && resumen && (
            <section className="edu-section">
              <h3 className="edu-section__title">Qué va a pasar</h3>
              <p className="edu-section__lead">
                <strong>{resumen.listas}</strong>{" "}
                {resumen.listas === 1 ? "cuenta se creará" : "cuentas se crearán"}
                {resumen.chocan > 0 && (
                  <>
                    {" · "}
                    <strong>{resumen.chocan}</strong> {resumen.chocan === 1 ? "choca" : "chocan"}{" "}
                    con algo que ya existe
                  </>
                )}
                {resumen.conError > 0 && (
                  <>
                    {" · "}
                    <strong>{resumen.conError}</strong>{" "}
                    {resumen.conError === 1 ? "renglón no se entiende" : "renglones no se entienden"}
                  </>
                )}
                . Los renglones con problema <strong>no se crean</strong>; el resto sí. Nada se ha
                escrito todavía.
              </p>

              {faltaGeneracion && (
                <div className="edu-banner edu-banner--warn" role="status">
                  <div>
                    <p className="edu-banner__title">Falta decir dónde se inscriben</p>
                    <p className="edu-banner__detail">
                      Elige la especialidad y la generación de arriba. Sin eso no se puede crear a
                      nadie: una cuenta de estudiante sin generación no aparece en ningún padrón.
                    </p>
                  </div>
                </div>
              )}

              {conProblema.length > 0 && (
                <ListaFilas
                  titulo={`${conProblema.length} ${conProblema.length === 1 ? "renglón" : "renglones"} que NO se crearán`}
                  filas={conProblema}
                />
              )}
              <ListaFilas
                titulo={`${listas.length} ${listas.length === 1 ? "renglón listo" : "renglones listos"}`}
                filas={listas}
              />
            </section>
          )}

          {!sim && (
            <p className="edu-note">
              <FileUp size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Nada se escribe al leer el archivo: primero se enseña qué se crearía y qué chocaría,
              y solo después se confirma.
            </p>
          )}
        </>
      )}
    </EduModal>
  );
}

/**
 * Los renglones del archivo.
 *
 * ⚠️ Se pintan como mucho {MAX_PINTADOS} y se dice cuántos faltan. Un
 * archivo de 200 renglones dentro de un modal serían 200 tarjetas que
 * nadie va a leer, y lo que hay que mirar de verdad son los que fallan —que
 * salen primero y completos.
 */
function ListaFilas({ titulo, filas }: { titulo: string; filas: EduImportFila[] }) {
  const [abierto, setAbierto] = useState(filas.some((f) => f.estado !== "ok"));
  if (filas.length === 0) return null;
  const visibles = filas.slice(0, MAX_PINTADOS);

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="edu-btn edu-btn--ghost edu-btn--sm"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        {abierto ? "Ocultar" : "Ver"} · {titulo}
      </button>

      {abierto && (
        <div className="edu-tablewrap" style={{ marginTop: 8 }}>
          <div className="edu-table">
            {visibles.map((f) => (
              <div
                key={`${f.linea}-${f.datos.email}`}
                className={`edu-row ${f.estado === "ok" ? "" : "edu-row--off"}`}
              >
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Renglón {f.linea}</span>
                  <span className="edu-cell__value edu-cell__value--strong">
                    {[f.datos.firstName, f.datos.lastName].filter(Boolean).join(" ") || "(sin nombre)"}
                  </span>
                  <span className="edu-cell__sub">{f.datos.email || "(sin correo)"}</span>
                  {f.datos.matricula && (
                    <span className="edu-cell__sub">Matrícula {f.datos.matricula}</span>
                  )}
                </div>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Estado</span>
                  {f.estado === "ok" ? (
                    <span className="edu-tag edu-tag--ok">Se creará</span>
                  ) : (
                    <span className="edu-tag edu-tag--warn">
                      {f.estado === "choca" ? "Choca" : "No se entiende"}
                    </span>
                  )}
                  {f.problemas.map((p, i) => (
                    <span className="edu-cell__sub" key={i}>
                      {p}
                    </span>
                  ))}
                  {f.avisos.map((a, i) => (
                    <span className="edu-cell__sub" key={`a${i}`}>
                      <AlertTriangle size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {filas.length > visibles.length && (
            <p className="edu-note" style={{ marginTop: 6 }}>
              Y {filas.length - visibles.length} más que no caben en pantalla. Se tratan igual.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lo que quedó, con las contraseñas temporales.
 *
 * 🔴 SE VEN UNA SOLA VEZ. No se guardan en ninguna parte, así que este
 * panel NO se cierra solo: hay que pulsar «Ya las copié». Es el mismo trato
 * que el panel de credenciales del alta de equipo, y por la misma razón.
 */
function ResultadosImportacion({
  entidad,
  resultados,
  copiado,
  onCopiar,
}: {
  entidad: EduImportEntidad;
  resultados: EduImportResultado[];
  copiado: "listo" | "ok" | "falla";
  onCopiar: () => void;
}) {
  const creadas = resultados.filter((r) => r.ok);
  const fallidas = resultados.filter((r) => !r.ok);
  const sinInscribir = creadas.filter((r) => !r.inscrito);

  return (
    <>
      <div className="edu-creds">
        <div className="edu-creds__head">
          <div>
            <p className="edu-banner__title">
              {creadas.length} {creadas.length === 1 ? "cuenta creada" : "cuentas creadas"}
            </p>
            <p className="edu-banner__detail">
              Las contraseñas temporales <strong>se ven una sola vez</strong> y no se guardan en
              ninguna parte. Cópialas antes de cerrar: al entrar, cada persona tendrá que definir
              la suya.
            </p>
          </div>
          <div className="edu-creds__acciones">
            <button type="button" className="edu-btn edu-btn--ghost edu-btn--sm" onClick={onCopiar}>
              {copiado === "ok" ? <Check size={15} /> : <Copy size={15} />}
              {copiado === "ok"
                ? "Copiado"
                : copiado === "falla"
                  ? "Cópialo a mano"
                  : "Copiar todo"}
            </button>
          </div>
        </div>

        <div className="edu-tablewrap">
          {/* `--creds` es la MISMA tabla del alta de equipo (nombre, correo,
              una columna corta y la contraseña): se reusa en vez de declarar
              otra rejilla idéntica con otro nombre. */}
          <div className="edu-table edu-table--creds">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Persona</span>
              <span>Correo</span>
              <span>{entidad === "alumnos" ? "Matrícula" : "Renglón"}</span>
              <span>Contraseña temporal</span>
            </div>
            {creadas.map((r) => (
              <div className="edu-row" key={`${r.linea}-${r.email}`}>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Persona</span>
                  <span className="edu-cell__value edu-cell__value--strong">{r.name}</span>
                  {!r.inscrito && r.error && <span className="edu-cell__sub">{r.error}</span>}
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Correo</span>
                  <span className="edu-cell__value">{r.email}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">
                    {entidad === "alumnos" ? "Matrícula" : "Renglón"}
                  </span>
                  <span className="edu-cell__value">
                    {entidad === "alumnos" ? (r.matricula ?? "—") : r.linea}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Contraseña temporal</span>
                  {r.tempPassword ? (
                    <code className="edu-cell__value">{r.tempPassword}</code>
                  ) : (
                    <span className="edu-cell__sub">
                      Ya tenía cuenta en DaleControl: entra con su contraseña de siempre.
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sinInscribir.length > 0 && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              {sinInscribir.length}{" "}
              {sinInscribir.length === 1 ? "quedó sin inscribir" : "quedaron sin inscribir"}
            </p>
            <p className="edu-banner__detail">
              Su cuenta SÍ se creó y su contraseña está en la tabla de arriba, pero no quedó su
              ficha académica. Inscríbelos a mano desde Estudiantes; el motivo está en cada
              renglón.
            </p>
          </div>
        </div>
      )}

      {fallidas.length > 0 && (
        <section className="edu-section">
          <h3 className="edu-section__title">
            {fallidas.length} {fallidas.length === 1 ? "renglón no entró" : "renglones no entraron"}
          </h3>
          <div className="edu-tablewrap">
            <div className="edu-table">
              {fallidas.slice(0, MAX_PINTADOS).map((r) => (
                <div className="edu-row edu-row--off" key={`f-${r.linea}-${r.email}`}>
                  <div className="edu-cell edu-cell--wide">
                    <span className="edu-cell__label">Renglón {r.linea}</span>
                    <span className="edu-cell__value">{r.name || r.email}</span>
                    <span className="edu-cell__sub">{r.error}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
