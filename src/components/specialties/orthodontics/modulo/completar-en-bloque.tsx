"use client";
// Módulo de Ortodoncia — «Completar varios a la vez» (ws1-t8, auditoría de BEVADENT: F11 y mejora 8). La tabla de
// los casos con diagnóstico o plan incompleto. Se edita en el sitio y se guarda UNA vez:
//  · doctor tratante (solo si el caso no tiene; cambiarlo es «Datos del caso»),
//  · tiempo de tratamiento y controles previstos (con la propuesta de siempre: duración entre la frecuencia de
//    control de la clínica; «Proponer en los elegidos» la escribe en los que están vacíos),
//  · la marca «Migrado, sin datos de diagnóstico» (solo casos que vinieron de otro sistema): saca el diagnóstico de
//    la alerta sin inventar nada. El diagnóstico se captura en la ficha («Capturar diagnóstico»).
// Solo pinta y junta lo cambiado; las reglas y los permisos los vuelve a comprobar el servidor
// (`completarCasosEnBloque`), que contesta caso por caso.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CheckCircle2, ClipboardCheck, Loader2, Save, Wand2 } from "lucide-react";
import { completarCasosEnBloque, type ResultadoDeUnCaso } from "@/app/actions/orthodontics/modulo/completarCasosEnBloque";
import { isFailure } from "@/app/actions/orthodontics/result";
import { enlaceParaCompletar } from "@/lib/orthodontics/casos-incompletos-ruta";
import {
  CASOS_POR_GUARDADO,
  DURACION_MAXIMA_MESES,
  DURACION_MINIMA_MESES,
  mensajeDePropuesta,
  propuestaDeControles,
  type CambioDeUnCaso,
  type FilaParaCompletar,
} from "@/lib/orthodontics/completar-casos";
import { CONTROLES_MAXIMOS } from "@/lib/orthodontics/plan-detalle";
import { Vacio } from "./piezas";
import s from "./modulo.module.css";

/** Lo que se cambió en una fila (texto tal cual lo escribe la persona; se valida al guardar). */
interface Edicion {
  doctorId?: string;
  duracion?: string;
  controles?: string;
  marca?: boolean;
}

const vacio = (v: string | undefined) => v === undefined || v.trim() === "";

export function CompletarEnBloque({
  filas,
  doctores,
  frecuenciaDias,
  frecuenciaTexto,
  planGuardable,
  doctorGuardable,
}: {
  filas: FilaParaCompletar[];
  doctores: Array<{ id: string; nombre: string }>;
  frecuenciaDias: number;
  /** «cada mes», «cada 3 semanas»… para explicar la propuesta. */
  frecuenciaTexto: string;
  /** Existe la columna del plan (sql/ortodoncia-plan-de-tratamiento.sql pegado). */
  planGuardable: boolean;
  /** Existe la columna del doctor tratante (sql/ortodoncia-nucleo.sql pegado). */
  doctorGuardable: boolean;
}) {
  const router = useRouter();
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [resultados, setResultados] = useState<Record<string, ResultadoDeUnCaso>>({});

  const pendientes = useMemo(() => filas.filter((f) => f.faltan.length > 0), [filas]);
  const marcados = useMemo(() => filas.filter((f) => f.faltan.length === 0 && f.sinDiagnosticoMarcado), [filas]);
  const nombreDoctor = useMemo(() => new Map(doctores.map((d) => [d.id, d.nombre])), [doctores]);

  const editar = (planId: string, cambio: Partial<Edicion>) =>
    setEdiciones((prev) => ({ ...prev, [planId]: { ...prev[planId], ...cambio } }));

  /** El cambio de una fila listo para el servidor, o null si no cambió nada. */
  const cambioDe = (f: FilaParaCompletar): CambioDeUnCaso | null => {
    const e = ediciones[f.planId];
    if (!e) return null;
    const c: CambioDeUnCaso = { planId: f.planId };
    if (e.doctorId && !f.doctorId) c.doctorId = e.doctorId;
    if (!vacio(e.duracion) && Number(e.duracion) !== f.duracionMeses) c.duracionMeses = Number(e.duracion);
    if (!vacio(e.controles) && Number(e.controles) !== f.controlesPrevistos) c.controlesPrevistos = Number(e.controles);
    if (e.marca !== undefined && e.marca !== f.sinDiagnosticoMarcado) c.migradoSinDiagnostico = e.marca;
    return Object.keys(c).length > 1 ? c : null;
  };
  const cambios = filas.map(cambioDe).filter((c): c is CambioDeUnCaso => c !== null);

  const duracionDe = (f: FilaParaCompletar) => ediciones[f.planId]?.duracion ?? (f.duracionMeses ? String(f.duracionMeses) : "");
  const controlesDe = (f: FilaParaCompletar) => ediciones[f.planId]?.controles ?? (f.controlesPrevistos ? String(f.controlesPrevistos) : "");
  const propuestaDe = (f: FilaParaCompletar) => {
    const d = Number(duracionDe(f));
    return Number.isInteger(d) && d > 0 ? propuestaDeControles(d, frecuenciaDias) : f.controlesPropuestos;
  };

  const todosElegidos = pendientes.length > 0 && pendientes.every((f) => elegidos.has(f.planId));
  const alternarTodos = () => setElegidos(todosElegidos ? new Set() : new Set(pendientes.map((f) => f.planId)));
  const alternar = (planId: string) =>
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(planId)) n.delete(planId);
      else n.add(planId);
      return n;
    });

  /** «Proponer controles previstos»: en los elegidos que no tienen, con su duración. */
  const proponerEnElegidos = () => {
    let n = 0;
    let sinTiempo = 0;
    let yaTenian = 0;
    const nuevas: Record<string, Edicion> = {};
    for (const f of pendientes) {
      if (!elegidos.has(f.planId)) continue;
      if (!vacio(controlesDe(f))) {
        yaTenian += 1;
        continue;
      }
      const p = propuestaDe(f);
      if (p === null) {
        sinTiempo += 1;
        continue;
      }
      nuevas[f.planId] = { ...ediciones[f.planId], controles: String(p) };
      n += 1;
    }
    setEdiciones((prev) => ({ ...prev, ...nuevas }));
    // C-84: dice por qué no propuso (casos sin tiempo de tratamiento) en vez de callarlo.
    const m = mensajeDePropuesta({ propuestos: n, sinTiempo, yaTenian });
    if (m.tipo === "exito") toast.success(m.texto, { duration: 8000 });
    else toast(m.texto, { duration: 8000 });
  };

  /** «Marcar como migrados sin diagnóstico»: en los elegidos que vinieron de otro sistema y no tienen diagnóstico. */
  const marcarElegidos = () => {
    let n = 0;
    const nuevas: Record<string, Edicion> = {};
    for (const f of pendientes) {
      if (!elegidos.has(f.planId) || !f.migrado || !f.faltaDiagnostico || f.sinDiagnosticoMarcado) continue;
      nuevas[f.planId] = { ...ediciones[f.planId], marca: true };
      n += 1;
    }
    setEdiciones((prev) => ({ ...prev, ...nuevas }));
    if (n === 0) toast("Ninguno de los elegidos es un caso migrado sin diagnóstico.");
    else toast.success(`Marcados ${n} caso${n === 1 ? "" : "s"}. Revisa y guarda.`);
  };

  const guardar = async () => {
    if (cambios.length === 0 || guardando) return;
    setGuardando(true);
    try {
      const salida: Record<string, ResultadoDeUnCaso> = {};
      let guardados = 0;
      // De CASOS_POR_GUARDADO en CASOS_POR_GUARDADO: el servidor no acepta más de una vez.
      for (let i = 0; i < cambios.length; i += CASOS_POR_GUARDADO) {
        const res = await completarCasosEnBloque({ cambios: cambios.slice(i, i + CASOS_POR_GUARDADO) });
        if (isFailure(res)) {
          toast.error(res.error);
          break;
        }
        guardados += res.data.guardados;
        for (const r of res.data.resultados) salida[r.planId] = r;
      }
      setResultados(salida);
      const fallidos = Object.values(salida).filter((r) => !r.ok).length;
      if (guardados > 0) toast.success(`${guardados} caso${guardados === 1 ? "" : "s"} guardado${guardados === 1 ? "" : "s"}.`);
      if (fallidos > 0) toast.error(`${fallidos} caso${fallidos === 1 ? "" : "s"} no se guardó: el motivo está en su fila.`);
      // Lo guardado deja de estar «cambiado»: se queda solo lo que falló, para corregirlo.
      setEdiciones((prev) => {
        const quedan: Record<string, Edicion> = {};
        for (const [id, e] of Object.entries(prev)) if (salida[id] && !salida[id].ok) quedan[id] = e;
        return quedan;
      });
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. No se cambió nada de lo que no se confirmó.");
    } finally {
      setGuardando(false);
    }
  };

  if (pendientes.length === 0 && marcados.length === 0) {
    return (
      <Vacio
        icono={CheckCircle2}
        tono="neutro"
        titulo="No hay casos que completar"
        pista="Todos los casos activos tienen su diagnóstico y su plan completos."
      />
    );
  }

  return (
    <>
      {!planGuardable ? (
        <p className={s.error} role="alert">
          Falta pegar sql/ortodoncia-plan-de-tratamiento.sql: el tiempo de tratamiento, los controles previstos y la marca no se pueden guardar todavía.
        </p>
      ) : null}

      {pendientes.length > 0 ? (
        <section className={s.tarjeta} aria-label="Casos con diagnóstico o plan incompleto">
          <div className={s.barraHerramientas}>
            <button type="button" className={`${s.boton} ${s.botonPeq}`} onClick={proponerEnElegidos} disabled={elegidos.size === 0 || !planGuardable}>
              <Wand2 size={14} strokeWidth={1.9} aria-hidden />
              Proponer controles previstos
            </button>
            <button type="button" className={`${s.boton} ${s.botonPeq}`} onClick={marcarElegidos} disabled={elegidos.size === 0 || !planGuardable}>
              <ClipboardCheck size={14} strokeWidth={1.9} aria-hidden />
              Marcar como migrados sin diagnóstico
            </button>
            <span className={s.conteo} role="status">
              {elegidos.size > 0 ? `${elegidos.size} elegido${elegidos.size === 1 ? "" : "s"} · ` : ""}
              {pendientes.length} caso{pendientes.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className={`${s.nota} ${s.notaDeSeccion}`}>
            Controles previstos propuestos: el tiempo de tratamiento de cada caso entre la frecuencia de control de la clínica ({frecuenciaTexto}). La
            marca «Migrado, sin datos de diagnóstico» saca el caso de la alerta sin inventar diagnóstico; se puede quitar después.
          </p>
          <div className={s.tablaCaja}>
            <table className={`${s.tabla} ${s.tablaEditable}`} role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    <input type="checkbox" checked={todosElegidos} onChange={alternarTodos} aria-label="Elegir todos los casos" />
                  </th>
                  <th scope="col" role="columnheader">Paciente</th>
                  <th scope="col" role="columnheader">Doctor tratante</th>
                  <th scope="col" role="columnheader">Tiempo (meses)</th>
                  <th scope="col" role="columnheader">Controles previstos</th>
                  <th scope="col" role="columnheader">Diagnóstico</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {pendientes.map((f) => {
                  const e = ediciones[f.planId] ?? {};
                  const r = resultados[f.planId];
                  const propuesta = propuestaDe(f);
                  const marca = e.marca ?? f.sinDiagnosticoMarcado;
                  return (
                    <tr key={f.planId} role="row" className={cambioDe(f) ? s.filaCambiada : undefined}>
                      <td role="cell" className={s.celdaElegir}>
                        <input
                          type="checkbox"
                          checked={elegidos.has(f.planId)}
                          onChange={() => alternar(f.planId)}
                          aria-label={`Elegir el caso de ${f.patientName}`}
                        />
                      </td>
                      <td role="cell">
                        <Link href={`/dashboard/patients/${f.patientId}?tab=ortodoncia`} className={s.nombre}>
                          {f.patientName}
                        </Link>
                        <div className={s.detalle}>Falta: {f.faltan.map((x) => x.texto).join(" · ")}</div>
                        {r && !r.ok ? <div className={`${s.detalle} ${s.detallePeligro}`}>{r.error}</div> : null}
                        {r?.ok ? <div className={s.detalle}>Guardado</div> : null}
                      </td>
                      <td role="cell" data-etiqueta="Doctor tratante">
                        {f.doctorId ? (
                          nombreDoctor.get(f.doctorId) ?? "Asignado"
                        ) : (
                          <select
                            className={`${s.campoEntrada} ${s.campoEnTabla}`}
                            value={e.doctorId ?? ""}
                            onChange={(ev) => editar(f.planId, { doctorId: ev.target.value || undefined })}
                            disabled={!doctorGuardable}
                            aria-label={`Doctor tratante de ${f.patientName}`}
                          >
                            <option value="">— sin asignar —</option>
                            {doctores.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.nombre}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td role="cell" data-etiqueta="Tiempo (meses)">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={DURACION_MINIMA_MESES}
                          max={DURACION_MAXIMA_MESES}
                          className={`${s.campoEntrada} ${s.campoEnTabla} ${s.campoNumero}`}
                          value={duracionDe(f)}
                          placeholder="sin dato"
                          onChange={(ev) => editar(f.planId, { duracion: ev.target.value })}
                          disabled={!planGuardable}
                          aria-label={`Tiempo de tratamiento de ${f.patientName}, en meses`}
                        />
                      </td>
                      <td role="cell" data-etiqueta="Controles previstos">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={CONTROLES_MAXIMOS}
                          className={`${s.campoEntrada} ${s.campoEnTabla} ${s.campoNumero}`}
                          value={controlesDe(f)}
                          placeholder={propuesta !== null ? String(propuesta) : "sin dato"}
                          onChange={(ev) => editar(f.planId, { controles: ev.target.value })}
                          disabled={!planGuardable}
                          aria-label={`Controles previstos de ${f.patientName}`}
                        />
                        {vacio(controlesDe(f)) && propuesta !== null ? (
                          <button
                            type="button"
                            className={`${s.enlace} ${s.enlaceBoton}`}
                            onClick={() => editar(f.planId, { controles: String(propuesta) })}
                            disabled={!planGuardable}
                          >
                            Usar {propuesta}
                          </button>
                        ) : null}
                      </td>
                      <td role="cell" data-etiqueta="Diagnóstico">
                        {f.faltaDiagnostico || f.sinDiagnosticoMarcado ? (
                          <div className={s.celdaDiagnostico}>
                            {f.migrado ? (
                              <label className={s.casilla}>
                                <input
                                  type="checkbox"
                                  checked={marca}
                                  onChange={(ev) => editar(f.planId, { marca: ev.target.checked })}
                                  disabled={!planGuardable}
                                />
                                Migrado, sin datos de diagnóstico
                              </label>
                            ) : null}
                            <Link href={enlaceParaCompletar(f.patientId, "diagnostico")} className={s.enlace}>
                              Capturar diagnóstico
                            </Link>
                          </div>
                        ) : (
                          <span className={s.importeApagado}>Completo</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {marcados.length > 0 ? (
        <section className={s.tarjeta} aria-label="Marcados como migrados sin diagnóstico">
          <p className={`${s.nota} ${s.notaDeSeccion}`}>
            {marcados.length} caso{marcados.length === 1 ? "" : "s"} marcado{marcados.length === 1 ? "" : "s"} como «migrado, sin datos de
            diagnóstico»: no sale{marcados.length === 1 ? "" : "n"} en la alerta. Quita la marca para que vuelva{marcados.length === 1 ? "" : "n"} a pedirse.
          </p>
          <ul className={s.tarjetaLista}>
            {marcados.map((f) => {
              const r = resultados[f.planId];
              const marca = ediciones[f.planId]?.marca ?? true;
              return (
                <li key={f.planId} className={`${s.fila} ${s.filaApilable}`}>
                  <div className={s.filaCuerpo}>
                    <Link href={`/dashboard/patients/${f.patientId}?tab=ortodoncia`} className={`${s.nombre} ${s.nombreEstirado}`}>
                      {f.patientName}
                    </Link>
                    {r && !r.ok ? <div className={`${s.detalle} ${s.detallePeligro}`}>{r.error}</div> : null}
                  </div>
                  <div className={s.filaDerecha}>
                    <label className={s.casilla}>
                      <input
                        type="checkbox"
                        checked={marca}
                        onChange={(ev) => editar(f.planId, { marca: ev.target.checked })}
                        disabled={!planGuardable}
                      />
                      Migrado, sin datos de diagnóstico
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* A la izquierda a propósito: abajo a la derecha vive el botón flotante de Sabina. */}
      <div className={s.barraGuardarBloque}>
        <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={guardar} disabled={cambios.length === 0 || guardando}>
          {guardando ? <Loader2 size={15} strokeWidth={1.9} aria-hidden className={s.girando} /> : <Save size={15} strokeWidth={1.9} aria-hidden />}
          {cambios.length === 0 ? "Sin cambios" : `Guardar ${cambios.length} caso${cambios.length === 1 ? "" : "s"}`}
        </button>
        {cambios.length > 0 && !guardando ? (
          <button type="button" className={s.boton} onClick={() => setEdiciones({})}>
            Descartar cambios
          </button>
        ) : null}
      </div>
    </>
  );
}
