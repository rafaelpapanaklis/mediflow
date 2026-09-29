"use client";
// Ortodoncia — Configuración: las listas del «Plan de tratamiento» (ws1-t12). Cada clínica edita las suyas:
// brackets, alineadores, placas, aditamentos, prescripciones (tubos y bandas) y tipos de cementación. Vienen con
// las de Dentalink de ejemplo; se agregan propias y se quita cualquiera. «Quitar» solo deja de ofrecerla en planes
// NUEVOS: los casos que ya la usan conservan su texto. Mismo modelo que «Técnicas y precios».

import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, ListChecks, Plus, Trash2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import c from "@/components/specialties/orthodontics/redesign/plan-tratamiento.module.css";
import { guardarOpcionesDelPlanAction } from "@/app/actions/orthodontics/guardarOpcionesDelPlan";
import { isFailure } from "@/app/actions/orthodontics/result";
import {
  AYUDA_DE_LISTA,
  FRECUENCIAS_DE_CONTROL,
  FRECUENCIA_DE_CONTROL_DIAS_POR_OMISION,
  LISTAS_DEL_PLAN,
  OPCIONES_MAXIMAS_POR_LISTA,
  ROTULO_DE_LISTA,
  TEXTO_MAXIMO,
  faltanDeEjemplo,
  idNuevoDeOpcion,
  normalizarOpciones,
  restaurarDeEjemplo,
  validarOpciones,
  type ListaDelPlan,
  type OpcionDelPlan,
  type OpcionesDelPlan,
} from "@/lib/orthodontics/plan-detalle";
import type { OpcionesDeLaClinica } from "@/lib/orthodontics/plan-detalle-db";

export function OpcionesDelPlanDeTratamiento({ iniciales }: { iniciales?: OpcionesDeLaClinica }) {
  const idBase = useId();
  const inicial = iniciales?.opciones ?? normalizarOpciones(null);
  const [listas, setListas] = useState<OpcionesDelPlan>(inicial);
  const [guardadas, setGuardadas] = useState<OpcionesDelPlan>(inicial);
  // Cada cuántos días se cita un control: propone los «controles previstos» de cada plan (duración ÷ frecuencia).
  const [frecuencia, setFrecuencia] = useState<number>(iniciales?.frecuenciaControlDias ?? FRECUENCIA_DE_CONTROL_DIAS_POR_OMISION);
  const [frecuenciaGuardada, setFrecuenciaGuardada] = useState<number>(frecuencia);
  const [guardando, setGuardando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [enfocar, setEnfocar] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!enfocar) return;
    refs.current[enfocar]?.focus();
    setEnfocar(null);
  }, [enfocar, listas]);

  const problema = validarOpciones(listas);
  const sinCambios = JSON.stringify(listas) === JSON.stringify(guardadas) && frecuencia === frecuenciaGuardada;

  const cambiarLista = (l: ListaDelPlan, fn: (x: OpcionDelPlan[]) => OpcionDelPlan[]) =>
    setListas((antes) => ({ ...antes, [l]: fn(antes[l]) }));

  function agregar(l: ListaDelPlan) {
    if (listas[l].length >= OPCIONES_MAXIMAS_POR_LISTA) {
      toast.error(`Máximo ${OPCIONES_MAXIMAS_POR_LISTA} opciones en «${ROTULO_DE_LISTA[l]}».`);
      return;
    }
    const id = idNuevoDeOpcion(listas[l]);
    cambiarLista(l, (x) => [...x, { id, nombre: "", activa: true }]);
    setEnfocar(`${l}:${id}`);
  }

  function quitar(l: ListaDelPlan, id: string) {
    setConfirmando(null);
    // Una opción que aún no se guardó no tiene casos que la usen: se descarta sin más.
    if (!guardadas[l].some((g) => g.id === id)) cambiarLista(l, (x) => x.filter((o) => o.id !== id));
    else cambiarLista(l, (x) => x.map((o) => (o.id === id ? { ...o, activa: false } : o)));
  }

  async function guardar() {
    if (problema) {
      toast.error(problema);
      return;
    }
    setGuardando(true);
    try {
      const r = await guardarOpcionesDelPlanAction({ opciones: listas, frecuenciaControlDias: frecuencia });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      setGuardadas(r.data.opciones);
      setListas(r.data.opciones);
      setFrecuencia(r.data.frecuenciaControlDias);
      setFrecuenciaGuardada(r.data.frecuenciaControlDias);
      toast.success("Listas del plan de tratamiento guardadas.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta
      icono={ListChecks}
      titulo="Plan de tratamiento"
      sub="Las listas que se ofrecen al completar el plan de tratamiento de un caso: brackets, alineadores, placas, aditamentos, prescripciones de tubos y bandas, y tipos de cementación. Vienen con las de ejemplo; agrega las tuyas o quita las que no uses. Quitar una solo deja de ofrecerla en planes nuevos: los casos que ya la usan conservan su texto."
    >
      <div className={s.tarjetaCuerpo}>
        {iniciales && !iniciales.columna ? (
          <div className={s.campoAyuda} role="status" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <AlertTriangle size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
            <span>Falta aplicar sql/ortodoncia-plan-de-tratamiento.sql para guardar tus listas. Mientras, ves las de ejemplo.</span>
          </div>
        ) : null}

        <div className={c.listaBloque} style={{ marginBottom: 14 }}>
          <h4 className={c.listaTitulo}>Frecuencia de control</h4>
          <p className={c.listaAyuda}>Cada cuánto cita tu clínica un control. Con ella, el plan de tratamiento propone los controles previstos (duración ÷ frecuencia); se puede cambiar en cada caso.</p>
          <select
            className="input-new"
            value={frecuencia}
            onChange={(e) => setFrecuencia(Number(e.target.value))}
            aria-label="Frecuencia de control"
            style={{ maxWidth: 260 }}
          >
            {FRECUENCIAS_DE_CONTROL.map((f) => (
              <option key={f.dias} value={f.dias}>{f.texto}</option>
            ))}
            {!FRECUENCIAS_DE_CONTROL.some((f) => f.dias === frecuencia) ? <option value={frecuencia}>Cada {frecuencia} días</option> : null}
          </select>
        </div>

        <div className={c.listas}>
          {LISTAS_DEL_PLAN.map((l) => {
            const activas = listas[l].filter((o) => o.activa);
            const quitadas = listas[l].filter((o) => !o.activa);
            return (
              <section key={l} className={c.listaBloque} aria-labelledby={`${idBase}-${l}`}>
                <h4 id={`${idBase}-${l}`} className={c.listaTitulo}>{ROTULO_DE_LISTA[l]}</h4>
                <p className={c.listaAyuda}>{AYUDA_DE_LISTA[l]}</p>

                {activas.length === 0 ? (
                  <p className={s.pie} style={{ marginTop: 0 }}>No ofreces ninguna opción en esta lista.</p>
                ) : (
                  <ul className={c.listaEditable}>
                    {activas.map((o) => {
                      const claveRef = `${l}:${o.id}`;
                      const vacio = o.nombre.trim() === "";
                      return (
                        <li key={o.id} className={c.opcionFila}>
                          <input
                            ref={(el) => {
                              refs.current[claveRef] = el;
                            }}
                            className="input-new"
                            value={o.nombre}
                            maxLength={TEXTO_MAXIMO}
                            placeholder="Nombre"
                            aria-label={`${ROTULO_DE_LISTA[l]}: nombre de la opción`}
                            aria-invalid={vacio}
                            onChange={(e) => cambiarLista(l, (x) => x.map((y) => (y.id === o.id ? { ...y, nombre: e.target.value } : y)))}
                          />
                          {confirmando === claveRef ? (
                            <span className={s.tecnicaConfirma} role="alertdialog" aria-label={`Quitar ${o.nombre.trim() || "la opción"}`}>
                              <ButtonNew type="button" size="sm" variant="secondary" onClick={() => quitar(l, o.id)}>Quitar</ButtonNew>
                              <ButtonNew type="button" size="sm" variant="secondary" onClick={() => setConfirmando(null)}>No</ButtonNew>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={s.botonIcono}
                              aria-label={`Quitar ${o.nombre.trim() || "la opción"}`}
                              title="Quitar"
                              onClick={() => setConfirmando(claveRef)}
                            >
                              <Trash2 size={15} strokeWidth={1.9} aria-hidden />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {quitadas.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <p className={s.campoEtiqueta} style={{ margin: "0 0 6px" }}>Quitadas (no se ofrecen en planes nuevos)</p>
                    <ul className={c.listaEditable}>
                      {quitadas.map((o) => (
                        <li key={o.id} className={c.opcionQuitada}>
                          <span>{o.nombre.trim() || "Sin nombre"}</span>
                          <ButtonNew type="button" size="sm" variant="secondary" onClick={() => cambiarLista(l, (x) => x.map((y) => (y.id === o.id ? { ...y, activa: true } : y)))}>
                            Volver a ofrecer
                          </ButtonNew>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  <ButtonNew type="button" variant="secondary" size="sm" icon={<Plus size={15} strokeWidth={1.9} aria-hidden />} onClick={() => agregar(l)}>
                    Agregar
                  </ButtonNew>
                  {faltanDeEjemplo(l, listas[l]) ? (
                    <ButtonNew
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        cambiarLista(l, (x) => restaurarDeEjemplo(l, x));
                        toast.success("Las de ejemplo volvieron a la lista. Guarda para aplicarlo.");
                      }}
                    >
                      Restaurar las de ejemplo
                    </ButtonNew>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>

        {problema ? (
          <p className={s.pie} role="alert">{problema}</p>
        ) : null}
        <div style={{ marginTop: 14 }}>
          <ButtonNew variant="primary" onClick={guardar} disabled={guardando || sinCambios || problema !== null || (iniciales ? !iniciales.columna : false)}>
            {guardando ? "Guardando…" : "Guardar listas"}
          </ButtonNew>
        </div>
      </div>
    </Tarjeta>
  );
}
