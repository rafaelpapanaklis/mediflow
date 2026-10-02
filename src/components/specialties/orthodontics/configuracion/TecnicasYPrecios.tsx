"use client";
// Ortodoncia — Configuración: «Técnicas y precios» (ws1-t10). La lista de técnicas es de CADA clínica:
// se agregan las propias (p. ej. «Brackets de zafiro»), se edita nombre, tipo base y precios, y se quita
// cualquiera, también las 7 de siempre. «Quitar» solo deja de ofrecerla en casos nuevos: los casos que ya
// la usan siguen mostrando su nombre.
//
// ws1-t12 (ticket 3 de BEVADENT, 6b): cada técnica tiene tres precios. «Pago inicial» (la factura de colocación
// en «Pago por control»), «Precio por control» (lo que se cobra al firmar cada control de un caso con esa técnica;
// el caso lo copia al abrirse) y «Precio total» (lo que el alta propone en «Precio total a plazos»). Vacío = cae
// al catálogo (inicial y control) o no se propone nada (total).

import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Info, Plus, Tag, Trash2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import t from "./tecnicas-y-precios.module.css";
import { guardarTecnicasDeLaClinicaAction } from "@/app/actions/orthodontics/guardarTecnicasDeLaClinica";
import { isFailure } from "@/app/actions/orthodontics/result";
import { TECNICAS_ORTO, type TecnicaOrto } from "@/lib/orthodontics/precios-por-tecnica";
import type { OrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import {
  NOMBRE_MAXIMO,
  TECNICAS_MAXIMAS,
  faltanDeSiempre,
  idNuevoDeTecnica,
  normalizarTecnicas,
  precioValido,
  restaurarDeSiempre,
  soloConPrecioTotal,
  tecnicasDeSiempre,
  validarTecnicas,
  type TecnicaClinica,
} from "@/lib/orthodontics/tecnicas-de-la-clinica";
import type { TecnicasDeLaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { useTextosTecnicasYPrecios } from "./textos-tecnicas-y-precios";

interface Fila {
  id: string;
  nombre: string;
  base: TecnicaOrto;
  precio: string;
  pagoInicial: string;
  precioControl: string;
  activa: boolean;
}

type CampoDePrecio = "pagoInicial" | "precioControl" | "precio";

const aTexto = (n: number | null) => (n != null ? String(n) : "");
const aFila = (x: TecnicaClinica): Fila => ({
  ...x,
  precio: aTexto(x.precio),
  pagoInicial: aTexto(x.pagoInicial),
  precioControl: aTexto(x.precioControl),
});
const vacioANull = (v: string) => (v.trim() === "" ? null : v);
const aTecnica = (f: Fila): TecnicaClinica[] =>
  normalizarTecnicas([{ ...f, precio: vacioANull(f.precio), pagoInicial: vacioANull(f.pagoInicial), precioControl: vacioANull(f.precioControl) }]) ?? [];
const precioMalo = (v: string) => v.trim() !== "" && precioValido(v) === null;

export function TecnicasYPrecios({
  iniciales,
  modoDeCobro,
  puedeEditar = true,
  columnaPrecioDelCaso = true,
}: {
  iniciales?: TecnicasDeLaClinica;
  /** Cómo cobra la clínica (lo que se está eligiendo arriba, aunque aún no se guarde). */
  modoDeCobro?: OrthoBillingMode;
  /** `settings.edit`: sin él, la tabla se ve pero no se cambia (el servidor también lo exige). */
  puedeEditar?: boolean;
  /** false = falta sql/ws1-t12-precio-control-por-caso.sql. */
  columnaPrecioDelCaso?: boolean;
}) {
  const tx = useTextosTecnicasYPrecios();
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
  const problema = validarTecnicas(
    filas.map((f) => ({ nombre: f.nombre, precio: vacioANull(f.precio), pagoInicial: vacioANull(f.pagoInicial), precioControl: vacioANull(f.precioControl) })),
  );
  const sinCambios = JSON.stringify(actuales) === JSON.stringify(guardadas);
  const puedeRestaurar = faltanDeSiempre(filas.flatMap(aTecnica));
  const sinPreciosPorControl = modoDeCobro === "PAGO_POR_CONTROL" ? soloConPrecioTotal(filas) : [];

  const cambiar = (id: string, campo: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...campo } : f)));

  function agregar() {
    if (filas.length >= TECNICAS_MAXIMAS) {
      toast.error(tx.maximo(TECNICAS_MAXIMAS));
      return;
    }
    const id = idNuevoDeTecnica(filas.flatMap(aTecnica));
    setFilas((fs) => [...fs, { id, nombre: "", base: "METAL_BRACKETS", precio: "", pagoInicial: "", precioControl: "", activa: true }]);
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
    toast.success(tx.restauradas);
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
      toast.success(tx.guardadas);
    } finally {
      setGuardando(false);
    }
  }

  const campoDePrecio = (f: Fila, campo: CampoDePrecio, etiqueta: string, placeholder: string) => {
    const id = `${idBase}-${campo}-${f.id}`;
    return (
      <div className={t.campo}>
        <label className={t.etiqueta} htmlFor={id}>{etiqueta}</label>
        <input
          id={id}
          className="input-new"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={f[campo]}
          aria-invalid={precioMalo(f[campo])}
          aria-label={`${etiqueta} · ${f.nombre.trim() || tx.sinNombre}`}
          disabled={!puedeEditar}
          onChange={(e) => cambiar(f.id, { [campo]: e.target.value } as Partial<Fila>)}
        />
      </div>
    );
  };

  return (
    <Tarjeta icono={Tag} titulo={tx.titulo} sub={tx.sub}>
      <div className={s.tarjetaCuerpo}>
        {iniciales && !iniciales.columnaLista ? (
          <div className={t.nota} role="status">
            <AlertTriangle size={15} strokeWidth={1.9} aria-hidden />
            <span>{tx.faltaSql}</span>
          </div>
        ) : null}
        {!columnaPrecioDelCaso ? (
          <div className={t.nota} role="status">
            <AlertTriangle size={15} strokeWidth={1.9} aria-hidden />
            <span>{tx.faltaSqlCaso}</span>
          </div>
        ) : null}
        {sinPreciosPorControl.length > 0 ? (
          <div className={t.aviso} role="status">
            <AlertTriangle size={15} strokeWidth={1.9} aria-hidden />
            <span>{tx.avisoModoPorControl(sinPreciosPorControl.map((n) => `«${n}»`).join(", "))}</span>
          </div>
        ) : null}
        {!puedeEditar ? (
          <div className={t.nota} role="status">
            <Info size={15} strokeWidth={1.9} aria-hidden />
            <span>{tx.soloLectura}</span>
          </div>
        ) : null}

        {activas.length === 0 ? (
          <p className={s.pie} style={{ marginTop: 0 }}>{tx.ninguna}</p>
        ) : (
          <ul className={s.tecnicas}>
            {activas.map((f) => {
              const nombreMalo = f.nombre.trim() === "";
              const idN = `${idBase}-n-${f.id}`;
              const idB = `${idBase}-b-${f.id}`;
              return (
                <li key={f.id} className={t.fila} role="group" aria-label={f.nombre.trim() || tx.sinNombre}>
                  <div className={t.campo}>
                    <label className={t.etiqueta} htmlFor={idN}>{tx.nombre}</label>
                    <input
                      id={idN}
                      ref={(el) => {
                        refNombre.current[f.id] = el;
                      }}
                      className="input-new"
                      value={f.nombre}
                      maxLength={NOMBRE_MAXIMO}
                      placeholder={tx.phNombre}
                      aria-invalid={nombreMalo}
                      disabled={!puedeEditar}
                      onChange={(e) => cambiar(f.id, { nombre: e.target.value })}
                    />
                  </div>
                  <div className={t.campo}>
                    <label className={t.etiqueta} htmlFor={idB}>{tx.tipoBase}</label>
                    <select id={idB} className="input-new" value={f.base} disabled={!puedeEditar} onChange={(e) => cambiar(f.id, { base: e.target.value as TecnicaOrto })}>
                      {TECNICAS_ORTO.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  {campoDePrecio(f, "pagoInicial", tx.pagoInicial, tx.phDelCatalogo)}
                  {campoDePrecio(f, "precioControl", tx.precioControl, tx.phDelCatalogo)}
                  {campoDePrecio(f, "precio", tx.precioTotal, tx.phSinPrecio)}
                  {!puedeEditar ? (
                    <span />
                  ) : confirmando === f.id ? (
                    <div className={t.confirma} role="alertdialog" aria-label={tx.quitarAria(f.nombre.trim())}>
                      <span>{tx.confirmarQuitar(f.nombre.trim())}</span>
                      <ButtonNew type="button" size="sm" variant="secondary" onClick={() => quitar(f.id)}>{tx.quitar}</ButtonNew>
                      <ButtonNew type="button" size="sm" variant="secondary" onClick={() => setConfirmando(null)}>{tx.cancelar}</ButtonNew>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={s.botonIcono}
                      aria-label={tx.quitarAria(f.nombre.trim())}
                      title={tx.quitar}
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
        <p className={s.pie}>{tx.ayudaVacios}</p>

        {quitadas.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <p className={s.campoEtiqueta} style={{ margin: "0 0 6px" }}>{tx.quitadas}</p>
            <ul className={s.tecnicas}>
              {quitadas.map((f) => (
                <li key={f.id} className={s.tecnicaQuitada}>
                  <span>{f.nombre.trim() || tx.sinNombre}</span>
                  {puedeEditar ? (
                    <ButtonNew type="button" size="sm" variant="secondary" onClick={() => cambiar(f.id, { activa: true })}>
                      {tx.volverAOfrecer}
                    </ButtonNew>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {puedeEditar ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              <ButtonNew type="button" variant="secondary" size="sm" icon={<Plus size={15} strokeWidth={1.9} aria-hidden />} onClick={agregar}>
                {tx.agregar}
              </ButtonNew>
              {puedeRestaurar ? (
                <ButtonNew type="button" variant="secondary" size="sm" onClick={restaurar}>
                  {tx.restaurar}
                </ButtonNew>
              ) : null}
            </div>
            {problema ? (
              <p className={s.pie} role="alert">{problema}</p>
            ) : null}
            <div style={{ marginTop: 14 }}>
              <ButtonNew variant="primary" onClick={guardar} disabled={guardando || sinCambios || problema !== null}>
                {guardando ? tx.guardando : tx.guardar}
              </ButtonNew>
            </div>
          </>
        ) : null}
      </div>
    </Tarjeta>
  );
}
