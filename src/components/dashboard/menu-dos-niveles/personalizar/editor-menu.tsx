"use client";
// «Personalizar»: la pantalla donde cada persona se acomoda SU menú.
//
// Tres formas de mover lo mismo, porque una sola no le sirve a todo el mundo:
//   · ARRASTRANDO, con el ratón o con el dedo (en el teléfono hay que mantener
//     pulsada la agarradera un momento; así el dedo sigue sirviendo para
//     desplazar la lista).
//   · Con las FLECHAS ↑ ↓ de cada fila, que mueven dentro de su grupo.
//   · Con «Mover a…», que la lleva a cualquier otro grupo. Flechas y «Mover a…»
//     son botones de verdad: funcionan con teclado y con lector de pantalla, y
//     son el camino de quien no puede arrastrar. Por eso la agarradera está
//     marcada como decorativa: no aporta nada que estos botones no hagan.
//
// Nada de lo que pasa aquí toca la base hasta que se pulsa «Guardar»: si el
// guardado falla, el menú se queda exactamente como estaba.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { NavItemDef } from "@/components/dashboard/sidebar-nav";
import type { TFunction } from "@/i18n/t";
import { useT } from "@/i18n/i18n-provider";
import {
  MAX_LARGO_NOMBRE,
  aplicarDiseno,
  disenoDesdeArmado,
  esSeccionDeFabrica,
  esSubmenuDeFabrica,
  nuevoIdSeccion,
  nuevoIdSubmenu,
  type DisenoMenu,
  type EntradaGuardada,
} from "@/lib/menu-personalizado/diseno";
import { claveContenedor, soltar } from "@/lib/menu-personalizado/arrastre";
import { avisarCambioDeMenu } from "@/lib/menu-personalizado/avisos";
import {
  CONTENEDOR_RAIZ,
  borrarSeccion,
  borrarSubmenu,
  crearSeccion,
  crearSubmenu,
  desplazarOpcion,
  desplazarSeccion,
  moverOpcion,
  moverSubmenu,
  opcionesDe,
  puedeDesplazarOpcion,
  renombrarSeccion,
  renombrarSubmenu,
  seccionVacia,
  submenuVacio,
  type Contenedor,
} from "@/lib/menu-personalizado/editar";
import { ICONO_DE } from "../estructura";
import { Icono } from "../icono";
import { CLASES_MENU } from "../clases";
import s from "./editor-menu.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export interface EditorMenuProps {
  abierto: boolean;
  alCerrar: () => void;
  /** Lo que hay guardado hoy (ya saneado), o null si nunca personalizó. */
  diseno: DisenoMenu | null;
  revision: string | null;
  /** Las opciones que ESTA persona ve ahora. El editor no puede enseñar otras. */
  visibles: NavItemDef[];
  /** Se llama al guardar o al restablecer, con lo que quedó. */
  alAplicar: (diseno: DisenoMenu | null, revision: string | null) => void;
}

type Aviso = { tono: "error" | "info"; texto: string } | null;

/** Cuánto se espera al servidor antes de dar el guardado por fallido. */
const LIMITE_ESPERA = 15_000;

export function EditorMenu({ abierto, alCerrar, diseno, revision, visibles, alAplicar }: EditorMenuProps) {
  const t = useT();
  const router = useRouter();
  const etiqueta = useCallback((id: string) => t(`menuDosNiveles.nav.${id}`), [t]);

  const inicial = useCallback(
    (base: DisenoMenu | null) => disenoDesdeArmado(aplicarDiseno(base, visibles, { conservarVacios: true })),
    [visibles],
  );

  const [borrador, setBorrador] = useState<DisenoMenu>(() => inicial(diseno));
  const [revisionBase, setRevisionBase] = useState<string | null>(revision);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [conflicto, setConflicto] = useState<{ diseno: DisenoMenu | null; revision: string | null } | null>(null);
  const [confirmandoReset, setConfirmandoReset] = useState(false);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const alAbrir = useRef<string>("");
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const antesDeArrastrar = useRef<DisenoMenu | null>(null);

  // Al ABRIR se parte de lo que hay guardado: si la persona guardó en otra
  // pestaña, lo que ve aquí es lo último, no lo que tenía en pantalla.
  //
  // Solo al abrir, y por eso el `ref`: con el diálogo abierto llegan props
  // nuevas del servidor cada vez que el panel se vuelve a pintar (y eso pasa,
  // por ejemplo, cuando otra pestaña guarda), y reiniciar aquí borraría sin
  // avisar lo que la persona lleva acomodado. Si lo guardado cambió por debajo,
  // quien lo dice es el aviso de conflicto al pulsar Guardar, no un borrón.
  const estabaAbierto = useRef(false);
  useEffect(() => {
    if (!abierto || estabaAbierto.current) {
      estabaAbierto.current = abierto;
      return;
    }
    estabaAbierto.current = true;
    const partida = inicial(diseno);
    alAbrir.current = JSON.stringify(partida);
    setBorrador(partida);
    setRevisionBase(revision);
    setAviso(null);
    setConflicto(null);
    setConfirmandoReset(false);
    setConfirmandoCierre(false);
    setRenombrando(null);
  }, [abierto, diseno, revision, inicial]);

  /** ¿Hay algo acomodado sin guardar? (para no cerrar en falso con Escape) */
  const hayCambios = JSON.stringify(borrador) !== alAbrir.current;
  const intentarCerrar = useCallback(() => {
    if (guardando) return;
    if (hayCambios && !confirmandoCierre) {
      setConfirmandoCierre(true);
      return;
    }
    alCerrar();
  }, [guardando, hayCambios, confirmandoCierre, alCerrar]);

  const sensores = useSensors(
    // Con el ratón hace falta arrastrar 6 px: un clic simple no arrastra nada.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Con el dedo, 220 ms sin soltar. Sin esta espera, arrastrar la agarradera
    // y desplazar la lista serían el mismo gesto y la lista no se movería.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const destinos = useMemo(() => listaDeDestinos(borrador, t), [borrador, t]);

  // ── Arrastre ─────────────────────────────────────────────────────
  const alEmpezar = (e: DragStartEvent) => {
    antesDeArrastrar.current = borrador;
    setArrastrando(String(e.active.id));
  };

  const alPasarPorEncima = (e: DragOverEvent) => {
    const activo = String(e.active.id);
    const encima = e.over ? String(e.over.id) : null;
    if (!encima || encima === activo) return;
    setBorrador((actual) => soltar(actual, activo, encima));
  };

  const alSoltar = () => {
    // No se vuelve a mover nada aquí: `onDragOver` ya dejó la fila donde se ve
    // durante el arrastre. Repetirlo con el mismo destino movía la opción UNA
    // POSICIÓN MÁS que lo que enseñaba la vista previa.
    setArrastrando(null);
    antesDeArrastrar.current = null;
  };

  const alCancelar = () => {
    // Escape en mitad del arrastre: se deshacen los saltos del onDragOver.
    if (antesDeArrastrar.current) setBorrador(antesDeArrastrar.current);
    antesDeArrastrar.current = null;
    setArrastrando(null);
  };

  // ── Guardar / restablecer ────────────────────────────────────────
  const guardar = async (revisionAUsar: string | null = revisionBase) => {
    setGuardando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/menu-personalizado", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diseno: borrador, revision: revisionAUsar }),
        // Sin este tope, un servidor que ni responde ni corta dejaba el diálogo
        // en «Guardando…» para siempre, y con él no se podía ni cerrar.
        signal: AbortSignal.timeout(LIMITE_ESPERA),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        diseno?: DisenoMenu;
        revision?: string;
        error?: string;
        actual?: { diseno: DisenoMenu | null; revision: string | null };
      };
      if (res.status === 409 && json.actual) {
        // Otra pestaña (u otro dispositivo) guardó mientras esta editaba. No se
        // pisa nada sin preguntar: se enseña el choque y decide la persona.
        setConflicto({ diseno: json.actual.diseno ?? null, revision: json.actual.revision ?? null });
        return;
      }
      if (res.status === 503) {
        setAviso({ tono: "error", texto: t("menuPersonalizado.errores.sinTabla") });
        return;
      }
      if (!res.ok || !json.ok) {
        setAviso({ tono: "error", texto: t("menuPersonalizado.errores.guardar") });
        return;
      }
      alAplicar(json.diseno ?? borrador, json.revision ?? null);
      avisarCambioDeMenu();
      router.refresh();
      alCerrar();
    } catch {
      setAviso({ tono: "error", texto: t("menuPersonalizado.errores.guardar") });
    } finally {
      setGuardando(false);
    }
  };

  const restablecer = async () => {
    setGuardando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/menu-personalizado", { method: "DELETE", signal: AbortSignal.timeout(LIMITE_ESPERA) });
      if (!res.ok) {
        setAviso({ tono: "error", texto: t("menuPersonalizado.errores.restablecer") });
        return;
      }
      alAplicar(null, null);
      avisarCambioDeMenu();
      router.refresh();
      alCerrar();
    } catch {
      setAviso({ tono: "error", texto: t("menuPersonalizado.errores.restablecer") });
    } finally {
      setGuardando(false);
      setConfirmandoReset(false);
    }
  };

  // ── Piezas ───────────────────────────────────────────────────────
  const porId = useMemo(() => new Map(visibles.map((it) => [it.id, it] as const)), [visibles]);

  const filaOpcion = (id: string, contenedor: Contenedor) => {
    const item = porId.get(id);
    if (!item) return null;
    return (
      <FilaOpcion
        key={id}
        id={id}
        texto={etiqueta(id)}
        icono={ICONO_DE[id] ?? "chevron_right"}
        contenedor={contenedor}
        destinos={destinos}
        arrastrandoEsta={arrastrando === `op:${id}`}
        puedeSubir={puedeDesplazarOpcion(borrador, id, -1)}
        puedeBajar={puedeDesplazarOpcion(borrador, id, 1)}
        alSubir={() => setBorrador((d) => desplazarOpcion(d, id, -1))}
        alBajar={() => setBorrador((d) => desplazarOpcion(d, id, 1))}
        alMoverA={(destino) =>
          setBorrador((d) => moverOpcion(d, id, destino, opcionesDe(d, destino).length))
        }
        t={t}
      />
    );
  };

  const filaSubmenu = (entrada: Extract<EntradaGuardada, { tipo: "submenu" }>, indice: number) => {
    const vacio = submenuVacio(borrador, entrada.id);
    const soloUnaSeccionSinNombre = entrada.secciones.length === 1 && !entrada.secciones[0].nombre;
    return (
      <div key={entrada.id} className={s.submenu}>
        <FilaContenedor
          tipo="submenu"
          id={`sm:${entrada.id}`}
          icono={esSubmenuDeFabrica(entrada.id) ? "apps" : "folder"}
          texto={nombreSubmenu(entrada, t)}
          renombrando={renombrando === `sm:${entrada.id}`}
          alRenombrar={(nombre) => {
            setBorrador((d) => renombrarSubmenu(d, entrada.id, nombre));
            setRenombrando(null);
          }}
          alEmpezarRenombre={() => setRenombrando(`sm:${entrada.id}`)}
          alCancelarRenombre={() => setRenombrando(null)}
          arrastrandoEsta={arrastrando === `sm:${entrada.id}`}
          puedeSubir={indice > 0}
          puedeBajar={indice < borrador.entradas.length - 1}
          alSubir={() => setBorrador((d) => moverSubmenu(d, entrada.id, indice - 1))}
          alBajar={() => setBorrador((d) => moverSubmenu(d, entrada.id, indice + 1))}
          puedeBorrar={vacio}
          motivoNoBorrar={t("menuPersonalizado.soloVacio")}
          alBorrar={() => setBorrador((d) => borrarSubmenu(d, entrada.id))}
          t={t}
        />
        <div className={s.dentro}>
          {entrada.secciones.map((seccion, i) => (
            <div key={seccion.id} className={s.seccion}>
              {!soloUnaSeccionSinNombre && (
                <FilaContenedor
                  tipo="seccion"
                  id={`sc:${entrada.id}:${seccion.id}`}
                  texto={nombreSeccion(seccion.id, seccion.nombre, t)}
                  renombrando={renombrando === `sc:${entrada.id}:${seccion.id}`}
                  alRenombrar={(nombre) => {
                    setBorrador((d) => renombrarSeccion(d, entrada.id, seccion.id, nombre));
                    setRenombrando(null);
                  }}
                  alEmpezarRenombre={() => setRenombrando(`sc:${entrada.id}:${seccion.id}`)}
                  alCancelarRenombre={() => setRenombrando(null)}
                  puedeSubir={i > 0}
                  puedeBajar={i < entrada.secciones.length - 1}
                  alSubir={() => setBorrador((d) => desplazarSeccion(d, entrada.id, seccion.id, -1))}
                  alBajar={() => setBorrador((d) => desplazarSeccion(d, entrada.id, seccion.id, 1))}
                  puedeBorrar={seccionVacia(borrador, entrada.id, seccion.id) && entrada.secciones.length > 1}
                  motivoNoBorrar={
                    entrada.secciones.length > 1
                      ? t("menuPersonalizado.soloVacio")
                      : t("menuPersonalizado.ultimoGrupo")
                  }
                  alBorrar={() => setBorrador((d) => borrarSeccion(d, entrada.id, seccion.id))}
                  t={t}
                />
              )}
              <ZonaSoltar contenedor={{ submenuId: entrada.id, seccionId: seccion.id }} vacia={seccion.opciones.length === 0} t={t}>
                {seccion.opciones.map((id) => filaOpcion(id, { submenuId: entrada.id, seccionId: seccion.id }))}
              </ZonaSoltar>
            </div>
          ))}
          <button
            type="button"
            className={s.botonTexto}
            onClick={() => {
              const id = nuevoIdSeccion();
              setBorrador((d) => {
                const hecho = crearSeccion(d, entrada.id, t("menuPersonalizado.seccionNueva"), id);
                if (!hecho) {
                  setAviso({ tono: "error", texto: t("menuPersonalizado.errores.tope") });
                  return d;
                }
                return hecho.diseno;
              });
              setRenombrando(`sc:${entrada.id}:${id}`);
            }}
          >
            <Icono nombre="add" />
            {t("menuPersonalizado.nuevaSeccion")}
          </button>
        </div>
      </div>
    );
  };

  const opcionesRaiz = borrador.entradas.filter((e) => e.tipo === "opcion").length;

  return (
    <Dialog.Root
      open={abierto}
      onOpenChange={(v) => {
        if (!v) intentarCerrar();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={cx(CLASES_MENU, s.velo)} />
        <Dialog.Content className={cx(CLASES_MENU, s.panel)} aria-describedby="personalizar-desc">
          <header className={s.cabecera}>
            <div>
              <Dialog.Title className={s.titulo}>{t("menuPersonalizado.titulo")}</Dialog.Title>
              <Dialog.Description id="personalizar-desc" className={s.subtitulo}>
                {t("menuPersonalizado.explicacion")}
              </Dialog.Description>
            </div>
            <Dialog.Close className={s.botonIcono} aria-label={t("menuPersonalizado.cerrar")}>
              <Icono nombre="close" />
            </Dialog.Close>
          </header>

          {conflicto && (
            <div className={s.conflicto} role="alert">
              <p>{t("menuPersonalizado.conflicto.texto")}</p>
              <div className={s.conflictoBotones}>
                <button
                  type="button"
                  className={s.botonSecundario}
                  onClick={() => {
                    setBorrador(inicial(conflicto.diseno));
                    setRevisionBase(conflicto.revision);
                    setConflicto(null);
                  }}
                >
                  {t("menuPersonalizado.conflicto.verElOtro")}
                </button>
                <button
                  type="button"
                  className={s.botonSecundario}
                  onClick={() => {
                    const rev = conflicto.revision;
                    setConflicto(null);
                    setRevisionBase(rev);
                    void guardar(rev);
                  }}
                >
                  {t("menuPersonalizado.conflicto.encima")}
                </button>
              </div>
            </div>
          )}

          {aviso && (
            <p className={cx(s.aviso, aviso.tono === "error" && s.avisoError)} role="alert">
              {aviso.texto}
            </p>
          )}

          <DndContext
            sensors={sensores}
            collisionDetection={deteccion}
            // Las filas se recolocan MIENTRAS se arrastra, así que las zonas hay
            // que volver a medirlas: con la medición de una sola vez, soltar
            // encima de «Administración» acababa dejando la opción donde estaba
            // esa fila ANTES de que todo se moviera.
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={alEmpezar}
            onDragOver={alPasarPorEncima}
            onDragEnd={alSoltar}
            onDragCancel={alCancelar}
            accessibility={{ screenReaderInstructions: { draggable: t("menuPersonalizado.instruccionesArrastre") } }}
          >
            <div className={s.lista}>
              <h3 className={s.tituloGrupo}>{t("menuPersonalizado.menuPrincipal")}</h3>
              <ZonaSoltar contenedor={CONTENEDOR_RAIZ} vacia={opcionesRaiz === 0} t={t}>
                {borrador.entradas.map((e, i) =>
                  e.tipo === "opcion" ? filaOpcion(e.id, CONTENEDOR_RAIZ) : filaSubmenu(e, i),
                )}
              </ZonaSoltar>
              <button
                type="button"
                className={s.botonTexto}
                onClick={() => {
                  const id = nuevoIdSubmenu();
                  setBorrador((d) => {
                    const hecho = crearSubmenu(d, t("menuPersonalizado.submenuNuevo"), { submenu: id });
                    if (!hecho) {
                      setAviso({ tono: "error", texto: t("menuPersonalizado.errores.tope") });
                      return d;
                    }
                    return hecho.diseno;
                  });
                  setRenombrando(`sm:${id}`);
                }}
              >
                <Icono nombre="create_new_folder" />
                {t("menuPersonalizado.nuevoSubmenu")}
              </button>
            </div>

            <DragOverlay dropAnimation={null}>
              {arrastrando ? <div className={s.fantasma}>{textoDeArrastre(arrastrando, borrador, etiqueta, t)}</div> : null}
            </DragOverlay>
          </DndContext>

          <footer className={s.pie}>
            {confirmandoCierre ? (
              <div className={s.confirmar} role="alert">
                <span>{t("menuPersonalizado.confirmarCierre")}</span>
                <button type="button" className={s.botonSecundario} onClick={() => setConfirmandoCierre(false)}>
                  {t("menuPersonalizado.seguirEditando")}
                </button>
                <button type="button" className={s.botonPeligro} onClick={alCerrar}>
                  {t("menuPersonalizado.salirSinGuardar")}
                </button>
              </div>
            ) : confirmandoReset ? (
              <div className={s.confirmar} role="alert">
                <span>{t("menuPersonalizado.confirmarReset")}</span>
                <button type="button" className={s.botonSecundario} onClick={() => setConfirmandoReset(false)}>
                  {t("menuPersonalizado.no")}
                </button>
                <button type="button" className={s.botonPeligro} onClick={() => void restablecer()} disabled={guardando}>
                  {t("menuPersonalizado.siRestablecer")}
                </button>
              </div>
            ) : (
              <button type="button" className={s.botonTextoPie} onClick={() => setConfirmandoReset(true)} disabled={guardando}>
                <Icono nombre="restart_alt" />
                {t("menuPersonalizado.restablecer")}
              </button>
            )}
            {/* Con una pregunta en pie (salir o restablecer), estos dos se
                quitan de en medio: si no, el segundo clic en «Cancelar» —el
                gesto natural de «cancelar, cancelar»— se saltaba la
                confirmación y tiraba el borrador. */}
            {!confirmandoCierre && !confirmandoReset && (
              <div className={s.pieDerecha}>
                <button type="button" className={s.botonSecundario} onClick={intentarCerrar} disabled={guardando}>
                  {t("menuPersonalizado.cancelar")}
                </button>
                <button type="button" className={s.botonPrimario} onClick={() => void guardar()} disabled={guardando}>
                  {guardando ? t("menuPersonalizado.guardando") : t("menuPersonalizado.guardar")}
                </button>
              </div>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Piezas
// ═══════════════════════════════════════════════════════════════════

/** Un contenedor es zona de soltar aunque esté vacío: si no, no habría cómo llenarlo. */
function ZonaSoltar({
  contenedor,
  vacia,
  children,
  t,
}: {
  contenedor: Contenedor;
  vacia: boolean;
  children: React.ReactNode;
  t: TFunction;
}) {
  const id = claveContenedor(contenedor);
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cx(s.zona, isOver && s.zonaEncima)}>
      {children}
      {vacia && <p className={s.vacio}>{t("menuPersonalizado.vacio")}</p>}
    </div>
  );
}

function FilaOpcion({
  id,
  texto,
  icono,
  contenedor,
  destinos,
  arrastrandoEsta,
  puedeSubir,
  puedeBajar,
  alSubir,
  alBajar,
  alMoverA,
  t,
}: {
  id: string;
  texto: string;
  icono: string;
  contenedor: Contenedor;
  destinos: { contenedor: Contenedor; etiqueta: string }[];
  arrastrandoEsta: boolean;
  puedeSubir: boolean;
  puedeBajar: boolean;
  alSubir: () => void;
  alBajar: () => void;
  alMoverA: (destino: Contenedor) => void;
  t: TFunction;
}) {
  const dndId = `op:${id}`;
  const { setNodeRef: refSoltar } = useDroppable({ id: dndId });
  const { setNodeRef: refArrastrar, attributes, listeners } = useDraggable({ id: dndId });
  const aqui = claveContenedor(contenedor);

  return (
    <div
      ref={(nodo) => {
        refSoltar(nodo);
        refArrastrar(nodo);
      }}
      className={cx(s.fila, arrastrandoEsta && s.filaArrastrando)}
    >
      <span
        className={s.agarradera}
        // Decorativa a propósito: lo que hace (mover) está en los botones de al
        // lado, que sí son accesibles con teclado y lector de pantalla.
        aria-hidden
        {...attributes}
        {...listeners}
        tabIndex={-1}
      >
        <Icono nombre="drag_indicator" />
      </span>
      <Icono nombre={icono} className={s.iconoFila} />
      <span className={s.textoFila}>{texto}</span>
      <BotonesMover
        nombre={texto}
        puedeSubir={puedeSubir}
        puedeBajar={puedeBajar}
        alSubir={alSubir}
        alBajar={alBajar}
        t={t}
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={s.botonIcono} aria-label={t("menuPersonalizado.moverA", { nombre: texto })}>
          <Icono nombre="more_vert" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className={cx(CLASES_MENU, s.desplegable)}>
            <DropdownMenu.Label className={s.desplegableTitulo}>{t("menuPersonalizado.moverAQue")}</DropdownMenu.Label>
            {destinos.map((d) => {
              const esActual = claveContenedor(d.contenedor) === aqui;
              return (
                <DropdownMenu.Item
                  key={claveContenedor(d.contenedor)}
                  className={s.desplegableItem}
                  disabled={esActual}
                  onSelect={() => alMoverA(d.contenedor)}
                >
                  {esActual ? <Icono nombre="check" /> : <span className={s.huecoIcono} />}
                  {d.etiqueta}
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function FilaContenedor({
  tipo,
  id,
  icono,
  texto,
  renombrando,
  alRenombrar,
  alEmpezarRenombre,
  alCancelarRenombre,
  arrastrandoEsta,
  puedeSubir,
  puedeBajar,
  alSubir,
  alBajar,
  puedeBorrar,
  motivoNoBorrar,
  alBorrar,
  t,
}: {
  tipo: "submenu" | "seccion";
  id: string;
  icono?: string;
  texto: string;
  renombrando: boolean;
  alRenombrar: (nombre: string) => void;
  alEmpezarRenombre: () => void;
  alCancelarRenombre: () => void;
  arrastrandoEsta?: boolean;
  puedeSubir: boolean;
  puedeBajar: boolean;
  alSubir: () => void;
  alBajar: () => void;
  puedeBorrar: boolean;
  motivoNoBorrar: string;
  alBorrar: () => void;
  t: TFunction;
}) {
  const esSubmenu = tipo === "submenu";
  const { setNodeRef: refSoltar } = useDroppable({ id });
  const { setNodeRef: refArrastrar, attributes, listeners } = useDraggable({ id, disabled: !esSubmenu });

  if (renombrando) {
    return (
      <form
        className={cx(s.fila, s.filaContenedor)}
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("nombre") as HTMLInputElement | null;
          alRenombrar(input?.value ?? "");
        }}
      >
        <input
          name="nombre"
          className={s.entradaNombre}
          defaultValue={texto}
          maxLength={MAX_LARGO_NOMBRE}
          autoFocus
          aria-label={t("menuPersonalizado.nombreDe", { nombre: texto })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              alCancelarRenombre();
            }
          }}
        />
        <button type="submit" className={s.botonIcono} aria-label={t("menuPersonalizado.aceptarNombre")}>
          <Icono nombre="check" />
        </button>
        <button type="button" className={s.botonIcono} aria-label={t("menuPersonalizado.cancelar")} onClick={alCancelarRenombre}>
          <Icono nombre="close" />
        </button>
      </form>
    );
  }

  return (
    <div
      ref={(nodo) => {
        refSoltar(nodo);
        if (esSubmenu) refArrastrar(nodo);
      }}
      className={cx(s.fila, s.filaContenedor, esSubmenu ? s.filaSubmenu : s.filaSeccion, arrastrandoEsta && s.filaArrastrando)}
    >
      {esSubmenu ? (
        <span className={s.agarradera} aria-hidden {...attributes} {...listeners} tabIndex={-1}>
          <Icono nombre="drag_indicator" />
        </span>
      ) : (
        <span className={s.huecoAgarradera} aria-hidden />
      )}
      {icono && <Icono nombre={icono} className={s.iconoFila} />}
      <span className={s.textoFila}>{texto}</span>
      <button type="button" className={s.botonIcono} aria-label={t("menuPersonalizado.renombrar", { nombre: texto })} onClick={alEmpezarRenombre}>
        <Icono nombre="edit" />
      </button>
      <BotonesMover nombre={texto} puedeSubir={puedeSubir} puedeBajar={puedeBajar} alSubir={alSubir} alBajar={alBajar} t={t} />
      <button
        type="button"
        className={cx(s.botonIcono, s.botonBorrar)}
        aria-label={t("menuPersonalizado.borrar", { nombre: texto })}
        title={puedeBorrar ? undefined : motivoNoBorrar}
        disabled={!puedeBorrar}
        onClick={alBorrar}
      >
        <Icono nombre="delete" />
      </button>
    </div>
  );
}

function BotonesMover({
  nombre,
  puedeSubir,
  puedeBajar,
  alSubir,
  alBajar,
  t,
}: {
  nombre: string;
  puedeSubir: boolean;
  puedeBajar: boolean;
  alSubir: () => void;
  alBajar: () => void;
  t: TFunction;
}) {
  return (
    <>
      <button
        type="button"
        className={s.botonIcono}
        aria-label={t("menuPersonalizado.subir", { nombre })}
        disabled={!puedeSubir}
        onClick={alSubir}
      >
        <Icono nombre="arrow_upward" />
      </button>
      <button
        type="button"
        className={s.botonIcono}
        aria-label={t("menuPersonalizado.bajar", { nombre })}
        disabled={!puedeBajar}
        onClick={alBajar}
      >
        <Icono nombre="arrow_downward" />
      </button>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Qué hay debajo del dedo/puntero cuando se suelta. Las zonas están METIDAS unas
 * dentro de otras (la raíz contiene los submenús, que contienen sus secciones),
 * así que el criterio de dnd-kit por defecto —el área que más se solapa— elegiría
 * siempre la más grande, que es justo la equivocada. Aquí gana la MÁS PEQUEÑA de
 * las que están bajo el puntero, y entre iguales, la fila antes que su zona.
 */
const deteccion: CollisionDetection = (args) => {
  const bajoElPuntero = pointerWithin(args);
  const candidatos = bajoElPuntero.length > 0 ? bajoElPuntero : rectIntersection(args);
  const rango = (id: string) => (id.startsWith("op:") ? 0 : id.startsWith("sc:") ? 1 : id.startsWith("sm:") ? 2 : 3);
  const area = (id: string | number) => {
    const r = args.droppableRects.get(id);
    return r ? r.width * r.height : Number.POSITIVE_INFINITY;
  };
  return [...candidatos].sort((a, b) => {
    const porRango = rango(String(a.id)) - rango(String(b.id));
    return porRango !== 0 ? porRango : area(a.id) - area(b.id);
  });
};

function nombreSubmenu(
  entrada: Extract<EntradaGuardada, { tipo: "submenu" }>,
  t: TFunction,
): string {
  if (entrada.nombre) return entrada.nombre;
  if (esSubmenuDeFabrica(entrada.id)) return t("menuDosNiveles.admin.titulo");
  return t("menuPersonalizado.submenuSinNombre");
}

function nombreSeccion(
  id: string,
  nombre: string | null,
  t: TFunction,
): string {
  if (nombre) return nombre;
  if (esSeccionDeFabrica(id)) return t(`menuDosNiveles.grupo.${id}`);
  return t("menuPersonalizado.seccionSinNombre");
}

function listaDeDestinos(
  diseno: DisenoMenu,
  t: TFunction,
): { contenedor: Contenedor; etiqueta: string }[] {
  const lista: { contenedor: Contenedor; etiqueta: string }[] = [
    { contenedor: CONTENEDOR_RAIZ, etiqueta: t("menuPersonalizado.menuPrincipal") },
  ];
  for (const e of diseno.entradas) {
    if (e.tipo !== "submenu") continue;
    const nombre = nombreSubmenu(e, t);
    const unaSola = e.secciones.length === 1;
    for (const s of e.secciones) {
      const etiquetaSeccion = unaSola && !s.nombre ? nombre : `${nombre} › ${nombreSeccion(s.id, s.nombre, t)}`;
      lista.push({ contenedor: { submenuId: e.id, seccionId: s.id }, etiqueta: etiquetaSeccion });
    }
  }
  return lista;
}

function textoDeArrastre(
  activo: string,
  diseno: DisenoMenu,
  etiqueta: (id: string) => string,
  t: TFunction,
): string {
  if (activo.startsWith("op:")) return etiqueta(activo.slice(3));
  const submenuId = activo.slice(3);
  const e = diseno.entradas.find((x) => x.tipo === "submenu" && x.id === submenuId);
  return e && e.tipo === "submenu" ? nombreSubmenu(e, t) : "";
}

