"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Database, RefreshCw, ShieldCheck, Sparkles, Wallet, Wand2,
} from "lucide-react";
import rd from "@/components/dashboard/pagina-web-rediseno/pagina-web.module.css";
import {
  aplicarServicios, nombreNormalizado, MAX_SERVICIOS,
  type LecturaDeClinica, type Redaccion, type ServicioAprobado, type ServicioPropuesto,
} from "@/lib/landing-autocompletar/core";
import s from "./autocompletar.module.css";

/**
 * AUTOCOMPLETAR LA PÁGINA WEB — el panel de propuestas.
 *
 * PROPONE, NO PUBLICA. Este componente no guarda nada por su cuenta: cada
 * «Aprobar y guardar» llama a `onAprobar`, que es el `save()` de siempre de
 * `LandingConfigClient` (PATCH /api/clinic-landing, con su lista literal y sus
 * validadores). Abrir el panel y pedir la redacción solo LEE.
 *
 * Cada dato enseña de dónde salió: los duros (tratamientos, precios, doctores,
 * horario) vienen copiados de la base; los textos los redacta la IA y traen su
 * aviso si mencionan algo que no sale de los datos de la clínica.
 *
 * Solo lo monta la rama `if (rediseno)` de `LandingConfigClient`: con la
 * bandera `menu-dos-niveles` apagada, esto no existe.
 */

interface Props {
  puedeEditar: boolean;
  /** `clinic.landingActive`: si está publicada, aprobar = lo ven los pacientes. */
  publicada: boolean;
  guardando: boolean;
  /** Lo que la página tiene HOY, para enseñar la diferencia. */
  actual: {
    eslogan: string;
    presentacion: string;
    preguntas: Record<string, unknown>[];
  };
  /** El `save()` de la pantalla. Devuelve true si se guardó. */
  onAprobar: (data: Record<string, unknown>, mensaje: string) => Promise<boolean>;
}

type ErrorDePanel = { texto: string; sinSaldo?: boolean };

const ETIQUETA_ESTADO: Record<ServicioPropuesto["estado"], string> = {
  nuevo: "No está en tu página",
  distinto: "Tu página dice otra cosa",
  "sin-precio": "En tu página, sin precio",
  igual: "Ya está igual",
};

const pesos = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function motivo(res: Response): Promise<ErrorDePanel> {
  if (res.status === 429) return { texto: "Has pedido varias redacciones seguidas. Espera unos minutos y vuelve a intentarlo." };
  try {
    const j = await res.json();
    if (j?.error) return { texto: String(j.error), sinSaldo: j.sinSaldo === true };
  } catch { /* respuesta sin JSON */ }
  return { texto: "No pudimos leer los datos de tu clínica. Vuelve a intentarlo." };
}

export function PanelAutocompletar({ puedeEditar, publicada, guardando, actual, onAprobar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState<LecturaDeClinica | null>(null);
  const [costoCents, setCostoCents] = useState<number | null>(null);
  const [maxARedactar, setMaxARedactar] = useState(24);
  const [error, setError] = useState<ErrorDePanel | null>(null);

  /** ids de servicios marcados para aprobar. */
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [conPrecios, setConPrecios] = useState(true);

  const [redactando, setRedactando] = useState(false);
  const [redaccion, setRedaccion] = useState<Redaccion | null>(null);
  const [cobradoCents, setCobradoCents] = useState<number | null>(null);
  /** Textos editables antes de aprobar. */
  const [eslogan, setEslogan] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [descsUsadas, setDescsUsadas] = useState<Set<string>>(new Set());
  const [preguntas, setPreguntas] = useState<{ pregunta: string; respuesta: string; avisos: string[] }[]>([]);
  const [whatsapp, setWhatsapp] = useState("");
  /** Qué quedó ya guardado en esta sesión, para decirlo en su sitio. */
  const [guardado, setGuardado] = useState<Set<string>>(new Set());

  const marcarGuardado = (clave: string) => setGuardado(g => new Set(g).add(clave));

  async function leer(trasGuardar = false) {
    setLeyendo(true);
    setError(null);
    try {
      const res = await fetch("/api/clinic-landing/autocompletar", { cache: "no-store" });
      if (!res.ok) { setError(await motivo(res)); return; }
      const j = await res.json() as { lectura: LecturaDeClinica; costoEstimadoCents: number | null; maxServiciosARedactar: number };
      setLectura(j.lectura);
      setCostoCents(j.costoEstimadoCents);
      setMaxARedactar(j.maxServiciosARedactar);
      setWhatsapp(j.lectura.whatsappSugerido ?? "");
      if (!trasGuardar) {
        // De entrada van marcados lo nuevo y lo que cambió de precio. «Sin
        // precio» NO: una clínica puede no publicar ese precio a propósito.
        setMarcados(new Set(j.lectura.servicios.filter(x => x.estado === "nuevo" || x.estado === "distinto").map(x => x.id)));
      } else {
        setMarcados(new Set());
      }
    } catch {
      setError({ texto: "No pudimos leer los datos de tu clínica. Revisa tu conexión y vuelve a intentarlo." });
    } finally {
      setLeyendo(false);
    }
  }

  function alternar() {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir && !lectura && !leyendo) void leer();
  }

  /** Lo que se manda a redactar: lo marcado y lo que ya está en la página sin descripción. */
  const idsARedactar = useMemo(() => {
    if (!lectura) return [] as string[];
    return lectura.servicios
      .filter(x => marcados.has(x.id) || (x.enPagina && !x.enPagina.desc))
      .slice(0, maxARedactar)
      .map(x => x.id);
  }, [lectura, marcados, maxARedactar]);

  async function redactar() {
    setRedactando(true);
    setError(null);
    try {
      const res = await fetch("/api/clinic-landing/autocompletar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servicios: idsARedactar }),
      });
      if (!res.ok) { setError(await motivo(res)); return; }
      const j = await res.json() as { redaccion: Redaccion; cobradoCents: number | null };
      setRedaccion(j.redaccion);
      setCobradoCents(j.cobradoCents);
      setEslogan(j.redaccion.eslogan?.texto ?? "");
      setPresentacion(j.redaccion.presentacion?.texto ?? "");
      setPreguntas(j.redaccion.preguntas);
      setDescs(Object.fromEntries(j.redaccion.servicios.map(x => [x.id, x.desc.texto])));
      // Una descripción redactada se usa de entrada SOLO donde hoy no hay
      // ninguna Y no trae avisos. Donde la clínica ya escribió la suya, o el
      // texto menciona algo dudoso, hay que marcarla a mano.
      const sinDesc = new Set((lectura?.servicios ?? []).filter(x => !x.enPagina?.desc && !x.descripcionTarifario).map(x => x.id));
      setDescsUsadas(new Set(j.redaccion.servicios.filter(x => sinDesc.has(x.id) && x.desc.avisos.length === 0).map(x => x.id)));
      setGuardado(g => new Set([...g].filter(k => k === "servicios" || k === "whatsapp")));
    } catch {
      setError({ texto: "No pudimos hablar con la IA. Revisa tu conexión y vuelve a intentarlo." });
    } finally {
      setRedactando(false);
    }
  }

  /* ── aprobar, campo por campo ─────────────────────────────── */

  /** Servicios que el botón va a guardar: los marcados, más los que solo estrenan descripción. */
  const aprobados = useMemo<ServicioAprobado[]>(() => {
    if (!lectura) return [];
    const out: ServicioAprobado[] = [];
    for (const p of lectura.servicios) {
      const marcado = marcados.has(p.id);
      const usaDesc = descsUsadas.has(p.id) && !!descs[p.id]?.trim();
      if (!marcado && !(usaDesc && p.indiceGuardado !== null)) continue;
      out.push({
        id: p.id,
        // Un servicio que solo estrena descripción no toca su precio.
        conPrecio: marcado && conPrecios,
        desc: usaDesc ? descs[p.id].trim() : undefined,
      });
    }
    return out;
  }, [lectura, marcados, descsUsadas, descs, conPrecios]);

  async function aprobarServicios() {
    if (!lectura || aprobados.length === 0) return;
    const r = aplicarServicios(lectura.serviciosGuardados, lectura.servicios, aprobados);
    if (r.ok === false) { setError({ texto: r.motivo }); return; }
    setError(null);
    const ok = await onAprobar({ landingServices: r.servicios },
      aprobados.length === 1 ? "Servicio guardado en tu página" : `${aprobados.length} servicios guardados en tu página`);
    if (ok) { marcarGuardado("servicios"); setDescsUsadas(new Set()); await leer(true); }
  }

  async function aprobarTexto(clave: "eslogan" | "presentacion") {
    const texto = (clave === "eslogan" ? eslogan : presentacion).trim();
    if (!texto) return;
    const ok = await onAprobar(
      clave === "eslogan" ? { landingTagline: texto } : { description: texto },
      clave === "eslogan" ? "Eslogan guardado en tu página" : "Presentación guardada en tu página",
    );
    if (ok) marcarGuardado(clave);
  }

  async function aprobarPregunta(i: number) {
    const p = preguntas[i];
    if (!p?.pregunta.trim() || !p.respuesta.trim()) return;
    // Se AÑADE al final: las preguntas que la clínica ya tenía no se tocan.
    const yaEsta = actual.preguntas.some(f => nombreNormalizado(f?.question ?? f?.q) === nombreNormalizado(p.pregunta));
    if (yaEsta) { marcarGuardado(`pregunta:${i}`); return; }
    const ok = await onAprobar(
      { landingFaqs: [...actual.preguntas, { question: p.pregunta.trim(), answer: p.respuesta.trim() }] },
      "Pregunta guardada en tu página",
    );
    if (ok) marcarGuardado(`pregunta:${i}`);
  }

  async function aprobarWhatsapp() {
    const v = whatsapp.trim();
    if (!v) return;
    const ok = await onAprobar({ landingWhatsapp: v }, "WhatsApp guardado en tu página");
    if (ok) marcarGuardado("whatsapp");
  }

  /* ── pintar ───────────────────────────────────────────────── */

  if (!puedeEditar) return null;

  const seleccionables = lectura?.servicios.filter(x => x.estado !== "igual") ?? [];
  const bloqueado = guardando || leyendo || redactando;
  const Flecha = abierto ? ChevronDown : ChevronRight;

  return (
    <div className={s.panel}>
      <button type="button" onClick={alternar} aria-expanded={abierto} className={`${rd.bannerClic} ${s.bannerBoton}`}>
        <span className={rd.bannerClicIcono}><Wand2 size={17} strokeWidth={1.9} /></span>
        <span style={{ minWidth: 0 }}>
          <span className={rd.bannerClicTitulo}>Autocompletar con lo que ya tienes en tu clínica</span>
          <span className={rd.bannerClicSub}>Lee tu tarifario, tu equipo y tu horario y te propone qué poner. Nada llega a tu página hasta que lo apruebes.</span>
        </span>
        <Flecha size={18} className="ml-auto shrink-0" style={{ color: "var(--m2-texto-3)" }} />
      </button>

      {abierto && (
        <>
          <div className={s.regla}>
            <ShieldCheck size={16} strokeWidth={1.75} />
            <div>
              <b>Esto propone, no publica.</b>{" "}
              Los tratamientos, precios, doctores y horarios se copian de lo que ya cargaste; la IA solo redacta textos.{" "}
              {publicada
                ? "Tu página está publicada: lo que apruebes lo ven tus pacientes en cuanto se guarda."
                : "Tu página está oculta: lo que apruebes se guarda, pero nadie lo ve hasta que la publiques."}
            </div>
          </div>

          {error && (
            <div className={s.error} role="alert">
              {error.sinSaldo ? <Wallet size={16} strokeWidth={1.75} /> : <AlertTriangle size={16} strokeWidth={1.75} />}
              <div>
                {error.texto}{" "}
                {error.sinSaldo && <Link href="/dashboard/whatsapp/bot/saldo">Ir al monedero de IA</Link>}
              </div>
            </div>
          )}

          {leyendo && !lectura && (
            <div className={rd.tarjeta}>
              <p className={rd.tarjetaSub} style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <RefreshCw size={14} className={s.girando} /> Leyendo tu tarifario, tu equipo y tu horario…
              </p>
            </div>
          )}

          {lectura && (
            <>
              {lectura.faltantes.length > 0 && (
                <ul className={s.faltantes}>
                  {lectura.faltantes.map(f => (
                    <li key={f.que} className={s.faltante}>
                      <AlertTriangle size={16} strokeWidth={1.75} />
                      <div>{f.texto} {f.href !== "/dashboard/landing" && <Link href={f.href}>Ir a arreglarlo</Link>}</div>
                    </li>
                  ))}
                </ul>
              )}

              {/* ── TRATAMIENTOS Y PRECIOS: copiados ── */}
              {lectura.tarifarioActivos > 0 && (
                <div className={rd.tarjeta}>
                  <div className={rd.tarjetaCabeza}>
                    <div>
                      <h3 className={rd.tarjetaTitulo}><Database size={16} strokeWidth={1.75} /> Tratamientos y precios</h3>
                      <p className={s.origen}>
                        Copiado de tu tarifario · {lectura.tarifarioActivos} {lectura.tarifarioActivos === 1 ? "procedimiento activo" : "procedimientos activos"} ·{" "}
                        <Link href="/dashboard/procedures" target="_blank">Ver el tarifario</Link>
                      </p>
                    </div>
                    {guardado.has("servicios") && <span className={`${rd.insignia} ${rd.insigniaExito}`}><Check size={11} strokeWidth={2.5} /> Guardado</span>}
                  </div>

                  <div className={s.barraServicios}>
                    <div className={s.barraServiciosLado}>
                      <button type="button" disabled={bloqueado || seleccionables.length === 0} className={`${rd.boton} ${rd.botonPeq}`}
                        onClick={() => setMarcados(new Set(seleccionables.map(x => x.id)))}>Marcar todos</button>
                      <button type="button" disabled={bloqueado || marcados.size === 0} className={`${rd.boton} ${rd.botonPeq} ${rd.botonSuave}`}
                        onClick={() => setMarcados(new Set())}>Ninguno</button>
                    </div>
                    <label className={s.conmutador}>
                      <input type="checkbox" className={s.casilla} checked={conPrecios} disabled={bloqueado}
                        onChange={e => setConPrecios(e.target.checked)} />
                      Publicar los precios
                    </label>
                  </div>

                  <ul className={s.servicios}>
                    {lectura.servicios.map(p => {
                      const igual = p.estado === "igual";
                      const desc = descs[p.id];
                      const avisos = redaccion?.servicios.find(x => x.id === p.id)?.desc.avisos ?? [];
                      return (
                        <li key={p.id} className={igual ? `${s.servicio} ${s.servicioQuieto}` : s.servicio}>
                          <input type="checkbox" className={s.casilla} aria-label={`Aprobar ${p.nombre}`}
                            checked={marcados.has(p.id)} disabled={igual || bloqueado}
                            onChange={e => setMarcados(m => { const n = new Set(m); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                          <div style={{ minWidth: 0 }}>
                            <div className={s.servicioNombre}>
                              {p.nombre}
                              <span className={`${rd.insignia} ${igual ? rd.insigniaExito : p.estado === "distinto" ? rd.insigniaAlerta : rd.insigniaNeutra}`}>
                                {ETIQUETA_ESTADO[p.estado]}
                              </span>
                            </div>
                            <div className={s.servicioDetalle}>
                              {p.categoria}{p.duracionMin ? ` · ${p.duracionMin} min` : ""}
                              {p.enPagina?.duracionMin && p.duracionMin && p.enPagina.duracionMin !== p.duracionMin ? ` (tu página dice ${p.enPagina.duracionMin} min)` : ""}
                              {p.descripcionTarifario && !desc ? ` · «${p.descripcionTarifario}»` : ""}
                            </div>
                          </div>
                          <div className={s.servicioCifras}>
                            {p.estado === "distinto" && p.enPagina?.precio && <span className={s.precioAntes}>{p.enPagina.precio}</span>}
                            <span className={s.precio}>{p.precio || "Sin precio en el tarifario"}</span>
                            {!conPrecios && !igual && <span className={s.precioNota}>no se publicará</span>}
                          </div>
                          {desc !== undefined && (
                            <div className={s.servicioDesc}>
                              <label className={s.conmutador} style={{ marginBottom: 6 }}>
                                <input type="checkbox" className={s.casilla} checked={descsUsadas.has(p.id)} disabled={bloqueado}
                                  onChange={e => setDescsUsadas(m => { const n = new Set(m); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                                Usar esta descripción redactada por la IA
                              </label>
                              {p.enPagina?.desc && <div className={s.hoy} style={{ marginBottom: 6 }}><b>Hoy en tu página:</b> {p.enPagina.desc}</div>}
                              <textarea rows={2} maxLength={180} value={desc} disabled={bloqueado} className={rd.textarea}
                                aria-label={`Descripción de ${p.nombre}`}
                                onChange={e => setDescs(d => ({ ...d, [p.id]: e.target.value }))} />
                              {avisos.map(a => <div key={a} className={s.aviso}><AlertTriangle size={14} strokeWidth={1.75} /> {a}</div>)}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <div className={s.pie} style={{ marginTop: 12 }}>
                    <button type="button" onClick={aprobarServicios} disabled={bloqueado || aprobados.length === 0}
                      className={`${rd.boton} ${rd.botonPrincipal}`}>
                      <Check size={16} strokeWidth={1.75} />
                      {aprobados.length === 0 ? "Marca qué servicios aprobar"
                        : `Aprobar y guardar ${aprobados.length} ${aprobados.length === 1 ? "servicio" : "servicios"}`}
                    </button>
                    <span className={s.costo}>
                      Lo que ya tienes escrito en tu página no se borra ni se reordena. Tope: {MAX_SERVICIOS} servicios.
                    </span>
                  </div>
                </div>
              )}

              {/* ── DOCTORES Y HORARIO: ya salen solos ── */}
              <div className={rd.tarjeta}>
                <h3 className={rd.tarjetaTitulo}><Database size={16} strokeWidth={1.75} /> Doctores y horario</h3>
                <p className={s.origen}>
                  Tu página ya los toma sola de <Link href="/dashboard/team" target="_blank">tu equipo</Link> y de
                  tu horario de atención cada vez que alguien la abre: aquí no hay nada que aprobar, solo comprobar.
                </p>
                <ul className={s.personas}>
                  {lectura.doctores.length === 0 && <li>No hay doctores activos.</li>}
                  {lectura.doctores.map((d, i) => (
                    <li key={`${d.nombre}-${i}`}>
                      <b>{d.nombre}</b> · {d.especialidad ?? "sin especialidad escrita"} · {d.tieneCedula ? "cédula registrada" : "sin cédula registrada"}
                    </li>
                  ))}
                  <li><b>Horario:</b> {lectura.horario || "sin horario de atención configurado"}</li>
                </ul>
              </div>

              {/* ── WHATSAPP: copiado del teléfono, solo si falta ── */}
              {lectura.whatsappSugerido && (
                <div className={rd.tarjeta}>
                  <div className={s.propuestaCabeza}>
                    <h3 className={rd.tarjetaTitulo}><Database size={16} strokeWidth={1.75} /> WhatsApp de tu página</h3>
                    {guardado.has("whatsapp") && <span className={`${rd.insignia} ${rd.insigniaExito}`}><Check size={11} strokeWidth={2.5} /> Guardado</span>}
                  </div>
                  <p className={s.origen}>Tu página no tiene WhatsApp. Este es el teléfono de tu clínica: compruébalo, puede ser un fijo.</p>
                  <div className={s.pie} style={{ marginTop: 10 }}>
                    <input value={whatsapp} inputMode="tel" maxLength={200} disabled={bloqueado} onChange={e => setWhatsapp(e.target.value)}
                      aria-label="WhatsApp de tu página" className={rd.input} style={{ maxWidth: 240 }} />
                    <button type="button" onClick={aprobarWhatsapp} disabled={bloqueado || !whatsapp.trim()} className={`${rd.boton} ${rd.botonPrincipal} ${rd.botonPeq}`}>
                      <Check size={16} strokeWidth={1.75} /> Aprobar y guardar
                    </button>
                  </div>
                </div>
              )}

              {/* ── TEXTOS: los redacta la IA ── */}
              <div className={rd.tarjeta}>
                <div className={rd.tarjetaCabeza} style={{ display: "block" }}>
                  <h3 className={rd.tarjetaTitulo}><Sparkles size={16} strokeWidth={1.75} /> Textos redactados con IA</h3>
                  <p className={rd.tarjetaSub}>
                    Eslogan, presentación, preguntas frecuentes y la descripción de {idsARedactar.length}{" "}
                    {idsARedactar.length === 1 ? "servicio" : "servicios"} (los marcados arriba y los que hoy no tienen descripción; máximo {maxARedactar}).
                    La IA solo ve el nombre de tu clínica, tu ciudad, tu dirección, tu horario, tus doctores y los nombres de tus tratamientos. No ve precios ni pacientes.
                  </p>
                </div>
                <div className={s.pie}>
                  <button type="button" onClick={redactar} disabled={bloqueado} className={`${rd.boton} ${redaccion ? "" : rd.botonPrincipal}`}>
                    {redactando ? <RefreshCw size={16} className={s.girando} /> : <Sparkles size={16} strokeWidth={1.75} />}
                    {redactando ? "Redactando…" : redaccion ? "Volver a redactar" : "Redactar con IA"}
                  </button>
                  <span className={s.costo}>
                    {cobradoCents !== null
                      ? <>Se descontaron <b>{pesos(cobradoCents)}</b> de tu saldo de IA.</>
                      : costoCents !== null
                        ? <>Cuesta alrededor de <b>{pesos(costoCents)}</b> de tu saldo de IA cada vez. Leer tus datos no cuesta.</>
                        : <>Se descuenta de tu saldo de IA cada vez. Leer tus datos no cuesta.</>}
                  </span>
                </div>

                {redaccion && (
                  <div style={{ marginTop: 18 }}>
                    {redaccion.eslogan && (
                      <div className={s.propuesta}>
                        <div className={s.propuestaCabeza}>
                          <h4 className={s.propuestaTitulo}>Eslogan</h4>
                          {guardado.has("eslogan") && <span className={`${rd.insignia} ${rd.insigniaExito}`}><Check size={11} strokeWidth={2.5} /> Guardado</span>}
                        </div>
                        <div className={s.hoy}><b>Hoy en tu página:</b> {actual.eslogan.trim() || "nada escrito"}</div>
                        <input value={eslogan} maxLength={300} disabled={bloqueado} onChange={e => setEslogan(e.target.value)} aria-label="Eslogan propuesto" className={rd.input} />
                        {redaccion.eslogan.avisos.map(a => <div key={a} className={s.aviso}><AlertTriangle size={14} strokeWidth={1.75} /> {a}</div>)}
                        <div className={s.pie}>
                          <button type="button" onClick={() => aprobarTexto("eslogan")} disabled={bloqueado || !eslogan.trim()} className={`${rd.boton} ${rd.botonPrincipal} ${rd.botonPeq}`}>
                            <Check size={16} strokeWidth={1.75} /> {actual.eslogan.trim() ? "Reemplazar y guardar" : "Aprobar y guardar"}
                          </button>
                        </div>
                      </div>
                    )}

                    {redaccion.presentacion && (
                      <div className={s.propuesta}>
                        <div className={s.propuestaCabeza}>
                          <h4 className={s.propuestaTitulo}>Presentación de la clínica</h4>
                          {guardado.has("presentacion") && <span className={`${rd.insignia} ${rd.insigniaExito}`}><Check size={11} strokeWidth={2.5} /> Guardado</span>}
                        </div>
                        <div className={s.hoy}><b>Hoy en tu página:</b> {actual.presentacion.trim() || "nada escrito"}</div>
                        <textarea rows={4} maxLength={5000} value={presentacion} disabled={bloqueado} onChange={e => setPresentacion(e.target.value)} aria-label="Presentación propuesta" className={rd.textarea} />
                        {redaccion.presentacion.avisos.map(a => <div key={a} className={s.aviso}><AlertTriangle size={14} strokeWidth={1.75} /> {a}</div>)}
                        <div className={s.pie}>
                          <button type="button" onClick={() => aprobarTexto("presentacion")} disabled={bloqueado || !presentacion.trim()} className={`${rd.boton} ${rd.botonPrincipal} ${rd.botonPeq}`}>
                            <Check size={16} strokeWidth={1.75} /> {actual.presentacion.trim() ? "Reemplazar y guardar" : "Aprobar y guardar"}
                          </button>
                        </div>
                      </div>
                    )}

                    {preguntas.map((p, i) => (
                      <div key={i} className={s.propuesta}>
                        <div className={s.propuestaCabeza}>
                          <h4 className={s.propuestaTitulo}>Pregunta frecuente {i + 1}</h4>
                          {guardado.has(`pregunta:${i}`) && <span className={`${rd.insignia} ${rd.insigniaExito}`}><Check size={11} strokeWidth={2.5} /> Guardada</span>}
                        </div>
                        <input value={p.pregunta} maxLength={200} disabled={bloqueado} aria-label={`Pregunta ${i + 1}`} className={rd.input}
                          onChange={e => setPreguntas(l => l.map((x, j) => j === i ? { ...x, pregunta: e.target.value } : x))} />
                        <textarea rows={2} maxLength={320} value={p.respuesta} disabled={bloqueado} aria-label={`Respuesta ${i + 1}`} className={rd.textarea}
                          onChange={e => setPreguntas(l => l.map((x, j) => j === i ? { ...x, respuesta: e.target.value } : x))} />
                        {p.avisos.map(a => <div key={a} className={s.aviso}><AlertTriangle size={14} strokeWidth={1.75} /> {a}</div>)}
                        <div className={s.pie}>
                          <button type="button" onClick={() => aprobarPregunta(i)} disabled={bloqueado || guardado.has(`pregunta:${i}`) || !p.pregunta.trim() || !p.respuesta.trim()}
                            className={`${rd.boton} ${rd.botonPrincipal} ${rd.botonPeq}`}>
                            <Check size={16} strokeWidth={1.75} /> Aprobar y añadir a mis preguntas
                          </button>
                        </div>
                      </div>
                    ))}

                    {redaccion.servicios.length > 0 && (
                      <p className={s.costo} style={{ marginTop: 16 }}>
                        Las descripciones de los servicios están arriba, dentro de cada tratamiento: se guardan con el botón de servicios.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
