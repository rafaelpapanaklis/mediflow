"use client";
// Ortodoncia — REEVALUACIONES (ws1-t8): la versión actual del caso, su historial en solo lectura (con «qué
// cambió» de una versión a la siguiente) y «Nueva reevaluación», que guarda la versión actual fechada e
// inmutable y deja editar la nueva. Sin sql/ortodoncia-reevaluaciones.sql no se pinta nada.
//
// Al crear la reevaluación, `onReevaluacionCreada` abre el editor precargado con la versión actual (hoy
// «Editar diagnóstico»; con la ventana de 2 pasos de ws1-t12, esa misma ventana).

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ArrowRight, History, Loader2, RotateCcw, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { useCajon } from "../atoms/useCajon";
import { crearReevaluacion, leerVersionesDelCaso, type VersionesDelCaso as Datos } from "@/app/actions/orthodontics/versionesDelCaso";
import { isFailure } from "@/app/actions/orthodontics/result";
import { MOTIVO_MINIMO, fechaDma } from "@/lib/orthodontics/versiones-caso";
import orto from "../orto.module.css";
import alta from "../alta-caso.module.css";
import dx from "../diagnostico.module.css";

export interface VersionesDelCasoProps {
  treatmentPlanId: string;
  /** Sin permiso de edición no se ofrece «Nueva reevaluación». */
  puedeReevaluar: boolean;
  onReevaluacionCreada?: () => void;
}

export function VersionesDelCaso(props: VersionesDelCasoProps) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [historial, setHistorial] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(
    () =>
      leerVersionesDelCaso(props.treatmentPlanId)
        .then((r) => setDatos(isFailure(r) ? null : r.data))
        .catch(() => setDatos(null)),
    [props.treatmentPlanId],
  );
  useEffect(() => {
    void cargar();
  }, [cargar]);
  // La versión vigente es lo que HOY está en la ficha: el historial se vuelve a leer al abrirlo (lo cargado al
  // montar la pestaña ya no sirve si después se editó el diagnóstico o el plan).
  const abrirHistorial = async () => {
    setAbriendo(true);
    await cargar();
    setAbriendo(false);
    setHistorial(true);
  };

  if (!datos || !datos.tabla || datos.linea.length === 0) return null;
  const actual = datos.linea[datos.linea.length - 1]!;
  const previas = datos.linea.length - 1;

  return (
    <>
      <div className={dx.dxVersiones}>
        <span className={dx.dxVersionActual}>
          <span className={dx.dxVersionPunto} aria-hidden />
          <strong>{actual.etiqueta}</strong>
          <span className={orto.tonoApagado}>vigente desde {fechaDma(actual.desde, datos.zona)}</span>
        </span>
        <span className={dx.dxVersionesAcciones}>
          {previas > 0 ? (
            <button type="button" className={dx.dxCompletar} onClick={abrirHistorial} disabled={abriendo}>
              {abriendo ? (
                <Loader2 size={13} strokeWidth={1.9} className="inline mr-1 animate-spin" aria-hidden />
              ) : (
                <History size={13} strokeWidth={1.9} className="inline mr-1" aria-hidden />
              )}
              Historial ({previas} {previas === 1 ? "versión anterior" : "versiones anteriores"})
            </button>
          ) : null}
          {props.puedeReevaluar ? (
            <button type="button" className={dx.dxCompletar} onClick={() => setNueva(true)}>
              <RotateCcw size={13} strokeWidth={1.9} className="inline mr-1" aria-hidden />
              Nueva reevaluación
            </button>
          ) : null}
        </span>
      </div>
      {historial ? <Historial datos={datos} onClose={() => setHistorial(false)} /> : null}
      {nueva ? (
        <NuevaReevaluacion
          treatmentPlanId={props.treatmentPlanId}
          etiquetaActual={actual.etiqueta}
          siguiente={`Reevaluación ${actual.numero + 1}`}
          onClose={() => setNueva(false)}
          onCreada={() => {
            setNueva(false);
            cargar();
            props.onReevaluacionCreada?.();
          }}
        />
      ) : null}
    </>
  );
}

function Historial({ datos, onClose }: { datos: Datos; onClose: () => void }) {
  const ref = useCajon<HTMLDivElement>(onClose);
  const [elegida, setElegida] = useState(Math.max(0, datos.linea.length - 2));
  const punto = datos.linea[elegida]!;
  const v = datos.versiones[elegida]!;
  const siguiente = datos.linea[elegida + 1];
  return (
    <>
      <div className={orto.velo} onClick={onClose} aria-hidden />
      <div className={alta.marco}>
        <div ref={ref} tabIndex={-1} className={`${alta.ventana} ${dx.dxVentanaAncha}`} role="dialog" aria-modal="true" aria-labelledby="versiones-titulo">
          <header className={alta.cabeza}>
            <div className="min-w-0">
              <div className={orto.cajonCeja}>Reevaluaciones</div>
              <h3 id="versiones-titulo" className={orto.cajonTitulo}>Historial del caso</h3>
              <p className={orto.cajonSub}>Cada versión es una copia fechada del diagnóstico y del plan. Solo lectura: no se cambian ni se borran.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className={orto.botonIcono}>
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>
          <div className={alta.cuerpo}>
            <div className={dx.dxPaso}>
              <nav aria-label="Versiones del caso">
                <ul className={dx.dxIndice}>
                  {datos.linea.map((p, i) => (
                    <li key={p.numero}>
                      <button
                        type="button"
                        className={`${dx.dxIndiceBoton} ${i === elegida ? dx.dxIndiceActivo : ""}`}
                        aria-current={i === elegida ? "true" : undefined}
                        onClick={() => setElegida(i)}
                      >
                        <span className={dx.dxIndiceNombre}>
                          {p.etiqueta}
                          <span className={dx.dxHitoFecha}>{fechaDma(p.desde, datos.zona)}{p.actual ? " · vigente" : ""}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className={dx.dxContenido}>
                <header className={dx.dxContenidoCabeza}>
                  <h4 className={dx.dxContenidoTitulo}>{punto.etiqueta}</h4>
                  <p className={dx.dxContenidoSub}>
                    {fechaDma(punto.desde, datos.zona)} → {punto.hasta ? fechaDma(punto.hasta, datos.zona) : "hoy"}
                    {v.cerradaPor ? ` · cerrada por ${v.cerradaPor}` : ""}
                    {punto.motivo ? ` · motivo: ${punto.motivo}` : ""}
                  </p>
                </header>

                {punto.actual ? (
                  <p className={dx.dxAvisoVigente}>
                    Vigente: son los datos de hoy en la ficha y se siguen editando. Se congela al abrir la siguiente reevaluación.
                  </p>
                ) : null}
                {siguiente ? (
                  <QueCambio cambios={v.cambiosALaSiguiente} siguiente={siguiente.actual ? `${siguiente.etiqueta} (vigente, datos de hoy)` : siguiente.etiqueta} />
                ) : null}

                <div className={dx.dxTarjetas}>
                  {v.legible.diagnostico.map((s) => (
                    <section key={s.clave} className={dx.dxBloque} aria-label={s.titulo}>
                      <header className={dx.dxBloqueCabeza}>
                        <h5 className={dx.dxBloqueTitulo}>{s.titulo}</h5>
                      </header>
                      <div className={dx.dxRenglones}>
                        {s.lineas.map((l) => (
                          <div key={l.clave} className={dx.dxRenglon}>
                            <span className={dx.dxRenglonEtiqueta}>{l.etiqueta}</span>
                            <span className={dx.dxRenglonValor}>{l.valor}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                  {v.legible.plan.length > 0 ? (
                    <section className={dx.dxBloque} aria-label="Plan de tratamiento">
                      <header className={dx.dxBloqueCabeza}>
                        <h5 className={dx.dxBloqueTitulo}>Plan de tratamiento</h5>
                      </header>
                      <div className={dx.dxRenglones}>
                        {v.legible.plan.map((l) => (
                          <div key={l.clave} className={dx.dxRenglon}>
                            <span className={dx.dxRenglonEtiqueta}>{l.etiqueta}</span>
                            <span className={dx.dxRenglonValor}>{l.valor}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
                {v.legible.resumen ? (
                  <div className={dx.dxResumen}>
                    <div className={dx.dxResumenEtiqueta}>Resumen diagnóstico</div>
                    <p className={dx.dxResumenTexto}>{v.legible.resumen}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <footer className={alta.pie}>
            <span className={alta.pieNota}>Las versiones anteriores se conservan completas (NOM-004).</span>
            <div className={alta.pieBotones}>
              <Btn variant="secondary" size="md" onClick={onClose}>
                Cerrar
              </Btn>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

/**
 * «Qué cambió»: lo que cambió de valor o se quitó, renglón por renglón (antes → después); lo que solo se capturó
 * en la versión siguiente (antes vacío), en una línea: si no, una reevaluación que completa el diagnóstico
 * entierra los cambios de verdad bajo 30 renglones «— → dato».
 */
function QueCambio({ cambios, siguiente }: { cambios: Datos["versiones"][number]["cambiosALaSiguiente"]; siguiente: string }) {
  if (cambios.length === 0) return <p className={dx.dxContenidoSub}>Sin cambios respecto a {siguiente.toLowerCase()}.</p>;
  const cambiados = cambios.filter((c) => c.antes !== null);
  const nuevos = cambios.filter((c) => c.antes === null);
  return (
    <section className={dx.dxBloque} aria-label="Qué cambió">
      <header className={dx.dxBloqueCabeza}>
        <h5 className={dx.dxBloqueTitulo}>Qué cambió en {siguiente.toLowerCase()}</h5>
        <span className={dx.dxBloqueCuenta}>
          {cambiados.length} cambio{cambiados.length === 1 ? "" : "s"}
          {nuevos.length ? ` · ${nuevos.length} dato${nuevos.length === 1 ? "" : "s"} nuevo${nuevos.length === 1 ? "" : "s"}` : ""}
        </span>
      </header>
      <div className={dx.dxRenglones}>
        {cambiados.map((c, k) => (
          <div key={k} className={`${dx.dxRenglon} ${dx.dxRenglonLargo}`}>
            <span className={dx.dxRenglonEtiqueta}>
              {c.parte === "Plan de tratamiento" ? "Plan" : c.apartado} · {c.etiqueta}
            </span>
            <span className={dx.dxCambio}>
              <span className={dx.dxCambioAntes}>{c.antes}</span>
              <ArrowRight size={12} strokeWidth={2} aria-label="pasó a" />
              <span className={dx.dxCambioDespues}>{c.despues ?? "sin dato"}</span>
            </span>
          </div>
        ))}
        {nuevos.length ? (
          <div className={`${dx.dxRenglon} ${dx.dxRenglonLargo}`}>
            <span className={dx.dxRenglonEtiqueta}>Se capturó por primera vez</span>
            <span className={dx.dxRenglonValor}>{nuevos.map((c) => c.etiqueta).join(", ")}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function NuevaReevaluacion({
  treatmentPlanId,
  etiquetaActual,
  siguiente,
  onClose,
  onCreada,
}: {
  treatmentPlanId: string;
  etiquetaActual: string;
  siguiente: string;
  onClose: () => void;
  onCreada: () => void;
}) {
  const ref = useCajon<HTMLDivElement>(onClose);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const corto = motivo.trim().length < MOTIVO_MINIMO;

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      const r = await crearReevaluacion({ treatmentPlanId, motivo });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success(`${r.data.etiqueta} abierta: «${etiquetaActual}» quedó guardada.`);
      onCreada();
    } catch {
      setError("No se pudo guardar la reevaluación. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <div className={orto.velo} onClick={onClose} aria-hidden />
      <div className={alta.marco}>
        <div ref={ref} tabIndex={-1} className={`${alta.ventana} ${dx.dxVentanaChica}`} role="dialog" aria-modal="true" aria-labelledby="reevaluar-titulo">
          <header className={alta.cabeza}>
            <div className="min-w-0">
              <div className={orto.cajonCeja}>Reevaluación</div>
              <h3 id="reevaluar-titulo" className={orto.cajonTitulo}>Nueva reevaluación</h3>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className={orto.botonIcono}>
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>
          <div className={alta.cuerpo}>
            <p className="text-[13px] leading-relaxed text-[color:var(--pr-texto-2)]">
              Se guarda «{etiquetaActual}» tal como está hoy —diagnóstico y plan de tratamiento completos, con fecha y tu nombre— y no se
              podrá cambiar. Después editas la {siguiente.toLowerCase()} con los datos actuales como punto de partida.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[color:var(--pr-texto-2)]">Motivo de la reevaluación</span>
              <textarea
                className={`${orto.entrada} min-h-[90px]`}
                maxLength={500}
                value={motivo}
                placeholder="p. ej. control radiográfico a los 12 meses; se cambia el anclaje superior"
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            {error ? (
              <div className={alta.error} role="alert">
                {error}
              </div>
            ) : null}
          </div>
          <footer className={alta.pie}>
            <span className={alta.pieNota}>Queda registrado en Movimientos del paciente.</span>
            <div className={alta.pieBotones}>
              <Btn variant="ghost" size="md" onClick={onClose}>
                Cancelar
              </Btn>
              <Btn
                variant="primary"
                size="md"
                icon={guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <RotateCcw className="w-3.5 h-3.5" aria-hidden />}
                onClick={guardar}
                disabled={guardando || corto}
              >
                {guardando ? "Guardando…" : `Guardar y abrir ${siguiente.toLowerCase()}`}
              </Btn>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
