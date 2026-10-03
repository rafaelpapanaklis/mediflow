"use client";
// Ortodoncia — Configuración: los catálogos de la hoja de control (ws1-t9, auditoría BEVADENT, M4). Materiales de arco
// (se encienden o apagan), calibres de arco, tipos y colores de liga, y tipos de mecánica auxiliar. Vienen con los
// valores de fábrica; la clínica agrega los suyos, quita los que no use y puede volver a copiar los de fábrica. «Quitar»
// solo deja de ofrecer: lo ya anotado en hojas y casos conserva su texto. Mismo modelo que «Plan de tratamiento».

import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import c from "@/components/specialties/orthodontics/redesign/plan-tratamiento.module.css";
import { guardarCatalogosDeHojaAction } from "@/app/actions/orthodontics/guardarCatalogosDeHoja";
import { isFailure } from "@/app/actions/orthodontics/result";
import {
  LISTAS_DE_HOJA,
  OPCIONES_MAXIMAS_POR_CATALOGO,
  ROTULO_DE_CATALOGO,
  TEXTO_MAXIMO_CATALOGO,
  copiarDeFabrica,
  faltanDeFabrica,
  idNuevoDeOpcion,
  normalizarCatalogos,
  validarCatalogos,
  type CatalogosDeHoja,
  type ListaDeHoja,
  type OpcionDeCatalogo,
} from "@/lib/orthodontics/hoja-catalogos";
import type { CatalogosDeLaClinica } from "@/lib/orthodontics/hoja-extras-db";
import { useTextosHojaExtras } from "../redesign/textos-hoja-extras";

export function CatalogosDeLaHoja({ iniciales, puedeEditar = true }: { iniciales?: CatalogosDeLaClinica; puedeEditar?: boolean }) {
  const t = useTextosHojaExtras();
  const idBase = useId();
  const inicial = iniciales?.catalogos ?? normalizarCatalogos(null);
  const [listas, setListas] = useState<CatalogosDeHoja>(inicial);
  const [guardadas, setGuardadas] = useState<CatalogosDeHoja>(inicial);
  const [editados, setEditados] = useState(iniciales?.editados ?? false);
  const [guardando, setGuardando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [enfocar, setEnfocar] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const columna = iniciales ? iniciales.columna : true;
  const editable = puedeEditar && columna;

  useEffect(() => {
    if (!enfocar) return;
    refs.current[enfocar]?.focus();
    setEnfocar(null);
  }, [enfocar, listas]);

  const problema = validarCatalogos(listas);
  const sinCambios = JSON.stringify(listas) === JSON.stringify(guardadas);

  const cambiarLista = (l: ListaDeHoja, fn: (x: OpcionDeCatalogo[]) => OpcionDeCatalogo[]) =>
    setListas((antes) => ({ ...antes, [l]: fn(antes[l]) }));

  function agregar(l: ListaDeHoja) {
    if (listas[l].length >= OPCIONES_MAXIMAS_POR_CATALOGO) {
      toast.error(t.cfgMaximo(OPCIONES_MAXIMAS_POR_CATALOGO));
      return;
    }
    const id = idNuevoDeOpcion(listas[l]);
    cambiarLista(l, (x) => [...x, { id, nombre: "", activa: true }]);
    setEnfocar(`${l}:${id}`);
  }

  function quitar(l: ListaDeHoja, id: string) {
    setConfirmando(null);
    // Una opción que aún no se guardó no se usó en ninguna hoja: se descarta sin más.
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
      const r = await guardarCatalogosDeHojaAction({ catalogos: listas });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      setGuardadas(r.data.catalogos);
      setListas(r.data.catalogos);
      setEditados(true);
      toast.success(t.cfgGuardados);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta icono={ClipboardCheck} titulo={t.cfgTitulo} sub={t.cfgSub}>
      <div className={s.tarjetaCuerpo} data-catalogos-hoja>
        {!columna ? (
          <div className={s.campoAyuda} role="status" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <AlertTriangle size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
            <span>{t.cfgFaltaSql}</span>
          </div>
        ) : !puedeEditar ? (
          <p className={s.campoAyuda} role="status" style={{ marginBottom: 12 }}>
            {t.cfgSoloLectura}
          </p>
        ) : !editados ? (
          <p className={s.campoAyuda} style={{ marginBottom: 12 }}>
            {t.cfgDeFabrica}
          </p>
        ) : null}

        <div className={c.listas}>
          {LISTAS_DE_HOJA.map((l) => {
            const rotulo = ROTULO_DE_CATALOGO[l][t.idioma];
            if (l === "arcosMateriales") {
              return (
                <section key={l} className={c.listaBloque} aria-labelledby={`${idBase}-${l}`}>
                  <h4 id={`${idBase}-${l}`} className={c.listaTitulo}>{rotulo}</h4>
                  <p className={c.listaAyuda}>{t.cfgMaterialesAyuda}</p>
                  <ul className={c.listaEditable}>
                    {listas[l].map((o) => (
                      <li key={o.id} className={c.opcionFila}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={o.activa}
                            disabled={!editable}
                            onChange={(e) => cambiarLista(l, (x) => x.map((y) => (y.id === o.id ? { ...y, activa: e.target.checked } : y)))}
                          />
                          {o.nombre}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            }
            const activas = listas[l].filter((o) => o.activa);
            const quitadas = listas[l].filter((o) => !o.activa);
            return (
              <section key={l} className={c.listaBloque} aria-labelledby={`${idBase}-${l}`}>
                <h4 id={`${idBase}-${l}`} className={c.listaTitulo}>{rotulo}</h4>
                {l === "arcosCalibres" ? <p className={c.listaAyuda}>{t.cfgCalibresAyuda}</p> : null}

                {activas.length === 0 ? (
                  <p className={s.pie} style={{ marginTop: 0 }}>{t.cfgNinguna}</p>
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
                            maxLength={TEXTO_MAXIMO_CATALOGO}
                            placeholder={l === "arcosCalibres" ? "016" : t.cfgNombre}
                            aria-label={`${rotulo}: ${t.cfgNombre}`}
                            aria-invalid={vacio}
                            readOnly={!editable}
                            onChange={(e) => cambiarLista(l, (x) => x.map((y) => (y.id === o.id ? { ...y, nombre: e.target.value } : y)))}
                          />
                          {!editable ? null : confirmando === claveRef ? (
                            <span className={s.tecnicaConfirma} role="alertdialog" aria-label={t.cfgQuitarAria(o.nombre.trim())}>
                              <ButtonNew type="button" size="sm" variant="secondary" onClick={() => quitar(l, o.id)}>{t.cfgQuitar}</ButtonNew>
                              <ButtonNew type="button" size="sm" variant="secondary" onClick={() => setConfirmando(null)}>{t.cfgNo}</ButtonNew>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={s.botonIcono}
                              aria-label={t.cfgQuitarAria(o.nombre.trim())}
                              title={t.cfgQuitar}
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
                    <p className={s.campoEtiqueta} style={{ margin: "0 0 6px" }}>{t.cfgQuitadas}</p>
                    <ul className={c.listaEditable}>
                      {quitadas.map((o) => (
                        <li key={o.id} className={c.opcionQuitada}>
                          <span>{o.nombre.trim() || t.cfgSinNombre}</span>
                          {editable ? (
                            <ButtonNew type="button" size="sm" variant="secondary" onClick={() => cambiarLista(l, (x) => x.map((y) => (y.id === o.id ? { ...y, activa: true } : y)))}>
                              {t.cfgVolver}
                            </ButtonNew>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {editable ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    <ButtonNew type="button" variant="secondary" size="sm" icon={<Plus size={15} strokeWidth={1.9} aria-hidden />} onClick={() => agregar(l)}>
                      {t.cfgAgregar}
                    </ButtonNew>
                    {faltanDeFabrica(l, listas[l]) ? (
                      <ButtonNew
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          cambiarLista(l, (x) => copiarDeFabrica(l, x));
                          toast.success(t.cfgCopiados);
                        }}
                      >
                        {t.cfgCopiarFabrica}
                      </ButtonNew>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        {problema ? (
          <p className={s.pie} role="alert">{problema}</p>
        ) : null}
        {editable ? (
          <div style={{ marginTop: 14 }}>
            <ButtonNew variant="primary" onClick={guardar} disabled={guardando || sinCambios || problema !== null}>
              {guardando ? t.cfgGuardando : t.cfgGuardar}
            </ButtonNew>
          </div>
        ) : null}
      </div>
    </Tarjeta>
  );
}
