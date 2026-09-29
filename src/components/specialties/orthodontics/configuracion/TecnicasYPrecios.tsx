"use client";
// Ortodoncia — Configuración: «Técnicas y precios» (ws1-t10). La lista de técnicas es de CADA clínica:
// se agregan las propias (p. ej. «Brackets de zafiro»), se edita nombre, tipo base y precio, y se quita
// cualquiera, también las 7 de siempre. «Quitar» solo deja de ofrecerla en casos nuevos: los casos que ya
// la usan siguen mostrando su nombre. El precio es lo que el alta propone; cada paciente puede pactar otro.

import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Plus, Tag, Trash2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import { guardarTecnicasDeLaClinicaAction } from "@/app/actions/orthodontics/guardarTecnicasDeLaClinica";
import { isFailure } from "@/app/actions/orthodontics/result";
import { TECNICAS_ORTO, type TecnicaOrto } from "@/lib/orthodontics/precios-por-tecnica";
import {
  NOMBRE_MAXIMO,
  TECNICAS_MAXIMAS,
  faltanDeSiempre,
  idNuevoDeTecnica,
  normalizarTecnicas,
  restaurarDeSiempre,
  tecnicasDeSiempre,
  validarTecnicas,
  type TecnicaClinica,
} from "@/lib/orthodontics/tecnicas-de-la-clinica";
import type { TecnicasDeLaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";

interface Fila {
  id: string;
  nombre: string;
  base: TecnicaOrto;
  precio: string;
  activa: boolean;
}

const aFila = (t: TecnicaClinica): Fila => ({ ...t, precio: t.precio != null ? String(t.precio) : "" });
const aTecnica = (f: Fila): TecnicaClinica[] => normalizarTecnicas([{ ...f, precio: f.precio.trim() === "" ? null : f.precio }]) ?? [];

export function TecnicasYPrecios({ iniciales }: { iniciales?: TecnicasDeLaClinica }) {
  const idBase = useId();
  const inicial = iniciales?.tecnicas ?? tecnicasDeSiempre();
  const [filas, setFilas] = useState<Fila[]>(() => inicial.map(aFila));
  const [guardadas, setGuardadas] = useState<TecnicaClinica[]>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [enfocar, setEnfocar] = useState<string | null>(null);
  const refNombre = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!enfocar) return;
    refNombre.current[enfocar]?.focus();
    setEnfocar(null);
  }, [enfocar, filas]);

  const activas = filas.filter((f) => f.activa);
  const quitadas = filas.filter((f) => !f.activa);
  const actuales = filas.flatMap(aTecnica);
  const problema = validarTecnicas(filas.map((f) => ({ nombre: f.nombre, precio: f.precio.trim() === "" ? null : f.precio })));
  const sinCambios = JSON.stringify(actuales) === JSON.stringify(guardadas);
  const puedeRestaurar = faltanDeSiempre(filas.flatMap(aTecnica));

  const cambiar = (id: string, campo: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...campo } : f)));

  function agregar() {
    if (filas.length >= TECNICAS_MAXIMAS) {
      toast.error(`Máximo ${TECNICAS_MAXIMAS} técnicas.`);
      return;
    }
    const id = idNuevoDeTecnica(filas.flatMap(aTecnica));
    setFilas((fs) => [...fs, { id, nombre: "", base: "METAL_BRACKETS", precio: "", activa: true }]);
    setEnfocar(id);
  }

  function quitar(id: string) {
    setConfirmando(null);
    const f = filas.find((x) => x.id === id);
    // Una técnica que aún no se guardó no tiene casos: se descarta sin más.
    if (f && !guardadas.some((g) => g.id === id)) setFilas((fs) => fs.filter((x) => x.id !== id));
    else cambiar(id, { activa: false });
  }

  function restaurar() {
    const lista = restaurarDeSiempre(filas.flatMap(aTecnica));
    // Las que aún no se guardan y siguen en pantalla (con nombre a medias) se conservan tal cual.
    const pendientes = filas.filter((f) => aTecnica(f).length === 0);
    setFilas([...lista.map(aFila), ...pendientes]);
    toast.success("Las técnicas de siempre volvieron a la lista. Guarda para aplicarlo.");
  }

  async function guardar() {
    if (problema) {
      toast.error(problema);
      return;
    }
    setGuardando(true);
    try {
      const r = await guardarTecnicasDeLaClinicaAction({ tecnicas: actuales });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      setGuardadas(r.data.tecnicas);
      setFilas(r.data.tecnicas.map(aFila));
      toast.success("Técnicas y precios guardados.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta
      icono={Tag}
      titulo="Técnicas y precios"
      sub="Las técnicas que ofrece tu clínica al abrir un caso, y cuánto cuesta el tratamiento con cada una. El costo del caso se propone con el precio de la técnica elegida; puedes cambiarlo para cada paciente. El tipo base decide los textos del consentimiento y el resto del expediente."
    >
      <div className={s.tarjetaCuerpo}>
        {iniciales && !iniciales.columnaLista ? (
          <div className={s.campoAyuda} role="status" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <AlertTriangle size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
            <span>Falta aplicar sql/ortodoncia-tecnicas-propias.sql para guardar tu lista. Mientras, ves las técnicas de siempre.</span>
          </div>
        ) : null}

        {activas.length === 0 ? (
          <p className={s.pie} style={{ marginTop: 0 }}>
            No ofreces ninguna técnica. Agrega una o restaura las de siempre para poder abrir casos nuevos.
          </p>
        ) : (
          <ul className={s.tecnicas}>
            <li className={s.tecnicasCabecera} aria-hidden>
              <span>Nombre</span>
              <span>Tipo base</span>
              <span>Precio (MXN)</span>
              <span />
            </li>
            {activas.map((f) => {
              const nombreMalo = f.nombre.trim() === "";
              const precioMalo = f.precio.trim() !== "" && aTecnica({ ...f, nombre: f.nombre.trim() || "x" }).length > 0 && aTecnica({ ...f, nombre: f.nombre.trim() || "x" })[0]!.precio === null;
              const idN = `${idBase}-n-${f.id}`;
              const idB = `${idBase}-b-${f.id}`;
              const idP = `${idBase}-p-${f.id}`;
              return (
                <li key={f.id} className={s.tecnica}>
                  <div className={s.tecnicaCampo}>
                    <label className={s.tecnicaEtiqueta} htmlFor={idN}>Nombre</label>
                    <input
                      id={idN}
                      ref={(el) => {
                        refNombre.current[f.id] = el;
                      }}
                      className="input-new"
                      value={f.nombre}
                      maxLength={NOMBRE_MAXIMO}
                      placeholder="Nombre de la técnica"
                      aria-invalid={nombreMalo}
                      onChange={(e) => cambiar(f.id, { nombre: e.target.value })}
                    />
                  </div>
                  <div className={s.tecnicaCampo}>
                    <label className={s.tecnicaEtiqueta} htmlFor={idB}>Tipo base</label>
                    <select id={idB} className="input-new" value={f.base} onChange={(e) => cambiar(f.id, { base: e.target.value as TecnicaOrto })}>
                      {TECNICAS_ORTO.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className={s.tecnicaCampo}>
                    <label className={s.tecnicaEtiqueta} htmlFor={idP}>Precio (MXN)</label>
                    <input
                      id={idP}
                      className="input-new"
                      inputMode="decimal"
                      placeholder="Sin precio"
                      value={f.precio}
                      aria-invalid={precioMalo}
                      onChange={(e) => cambiar(f.id, { precio: e.target.value })}
                    />
                  </div>
                  {confirmando === f.id ? (
                    <div className={s.tecnicaConfirma} role="alertdialog" aria-label={`Quitar ${f.nombre.trim() || "la técnica"}`}>
                      <span>¿Quitar «{f.nombre.trim() || "esta técnica"}»? Deja de ofrecerse; los casos que ya la usan la conservan.</span>
                      <ButtonNew type="button" size="sm" variant="secondary" onClick={() => quitar(f.id)}>Quitar</ButtonNew>
                      <ButtonNew type="button" size="sm" variant="secondary" onClick={() => setConfirmando(null)}>Cancelar</ButtonNew>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={s.botonIcono}
                      aria-label={`Quitar ${f.nombre.trim() || "la técnica"}`}
                      title="Quitar"
                      onClick={() => setConfirmando(f.id)}
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
          <div style={{ marginTop: 14 }}>
            <p className={s.campoEtiqueta} style={{ margin: "0 0 6px" }}>Quitadas (no se ofrecen en casos nuevos)</p>
            <ul className={s.tecnicas}>
              {quitadas.map((f) => (
                <li key={f.id} className={s.tecnicaQuitada}>
                  <span>{f.nombre.trim() || "Sin nombre"}</span>
                  <ButtonNew type="button" size="sm" variant="secondary" onClick={() => cambiar(f.id, { activa: true })}>
                    Volver a ofrecer
                  </ButtonNew>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          <ButtonNew type="button" variant="secondary" size="sm" icon={<Plus size={15} strokeWidth={1.9} aria-hidden />} onClick={agregar}>
            Agregar técnica
          </ButtonNew>
          {puedeRestaurar ? (
            <ButtonNew type="button" variant="secondary" size="sm" onClick={restaurar}>
              Restaurar las de siempre
            </ButtonNew>
          ) : null}
        </div>
        {problema ? (
          <p className={s.pie} role="alert">{problema}</p>
        ) : null}
        <div style={{ marginTop: 14 }}>
          <ButtonNew variant="primary" onClick={guardar} disabled={guardando || sinCambios || problema !== null}>
            {guardando ? "Guardando…" : "Guardar técnicas"}
          </ButtonNew>
        </div>
      </div>
    </Tarjeta>
  );
}
