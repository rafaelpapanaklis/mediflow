"use client";
// Menú de dos niveles del panel dental. Se enciende POR CLÍNICA
// (src/lib/menu-dos-niveles/interruptor.ts); con el interruptor apagado el
// layout pinta el <Sidebar> de siempre y este archivo ni se monta.
//
// Qué opciones ve cada persona NO se decide aquí: sale de opcionesVisibles()
// (estructura.ts), que usa el mismo shouldShowItem que el menú de siempre.
// Aquí solo se decide dónde se pinta cada una.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import toast from "react-hot-toast";
import type { Role } from "@prisma/client";
import { useSidebarCounts } from "@/hooks/use-sidebar-counts";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useT } from "@/i18n/i18n-provider";
import { isActivePath, type NavItemDef, type UserRole } from "@/components/dashboard/sidebar-nav";
import {
  ClinicSwitcher,
  cerrarSesionPanel,
  type SidebarProps,
} from "@/components/dashboard/sidebar";
import {
  aplicarDiseno,
  esSeccionDeFabrica,
  esSubmenuDeFabrica,
  filtrarSecciones,
  submenuActivo,
  type DisenoMenu,
  type EntradaArmada,
  type SeccionArmada,
} from "@/lib/menu-personalizado/diseno";
import {
  ICONO_DE,
  opcionesSuspendida,
  opcionesVisibles,
} from "./estructura";
import { Icono } from "./icono";
import { CLASES_MENU } from "./clases";
import { escucharCambioDeMenu } from "@/lib/menu-personalizado/avisos";
import { EditorMenu } from "./personalizar/editor-menu";
import s from "./menu-dos-niveles.module.css";

/** El menú que esta persona se armó a mano, leído en el servidor. */
export interface MenuPersonal {
  /** false = la tabla del SQL aún no existe: ni se ofrece «Personalizar». */
  disponible: boolean;
  diseno: DisenoMenu | null;
  revision: string | null;
}

export interface MenuDosNivelesProps extends SidebarProps {
  /** canUseCaja(user), resuelto en el servidor (caja-pin importa bcrypt). */
  puedeUsarCaja: boolean;
  /** Nombre del plan tal como está en plan_configs («Profesional»). */
  planEtiqueta: string | null;
  /** Lo que haya guardado en «Personalizar». Sin esto, menú de fábrica. */
  menuPersonal?: MenuPersonal;
}

const SIN_PERSONALIZAR: MenuPersonal = { disponible: false, diseno: null, revision: null };

export { CLASES_MENU };

const LS_ENCOGIDO = "menu-dos-niveles-encogido";
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

function useEncogido(): [boolean, (v: boolean) => void] {
  const [valor, setValor] = useState(false);
  useEffect(() => {
    try {
      setValor(window.localStorage.getItem(LS_ENCOGIDO) === "1");
    } catch {}
  }, []);
  const cambiar = useCallback((v: boolean) => {
    setValor(v);
    try { window.localStorage.setItem(LS_ENCOGIDO, v ? "1" : "0"); } catch {}
  }, []);
  return [valor, cambiar];
}

/** true mientras la ventana cumpla la media query (false en el primer render, como el menú de siempre). */
function useMedia(query: string): boolean {
  const [coincide, setCoincide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setCoincide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return coincide;
}

function iniciales(texto: string): string {
  return texto.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function MenuDosNiveles(props: MenuDosNivelesProps) {
  const t = useT();
  const pathname = usePathname();
  const counts = useSidebarCounts();
  const consultaActiva = useActiveConsult().consult;
  const { open: abrirNuevaCita } = useNewAppointmentDialog();

  const router = useRouter();
  const [encogido, setEncogido] = useEncogido();
  const esMovil = useMedia("(max-width: 1023.98px)");
  const esSuperpuesto = useMedia("(max-width: 1279.98px)");
  /** Id del submenú abierto en el segundo nivel («admin» o uno de la persona). */
  const [submenuAbierto, setSubmenuAbierto] = useState<string | null>(null);
  const [editorAbierto, setEditorAbierto] = useState(false);
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const raizRef = useRef<HTMLDivElement>(null);
  const cajonRef = useRef<HTMLElement>(null);

  const isExpired = props.isExpired ?? false;
  const clinicModuleKeys = useMemo(() => props.clinicModuleKeys ?? [], [props.clinicModuleKeys]);

  // Quién ve qué: el filtro del menú de siempre, sin tocar.
  const visibles = useMemo(
    () => opcionesVisibles(props.user, props.clinicCategory, clinicModuleKeys),
    [props.user, props.clinicCategory, clinicModuleKeys],
  );

  // El menú personal solo cambia de SITIO lo de arriba; nunca añade nada. Se
  // guarda en estado para que, al guardar en «Personalizar», el menú cambie sin
  // esperar a que el servidor vuelva a pintar el layout.
  const [personal, setPersonal] = useState<MenuPersonal>(props.menuPersonal ?? SIN_PERSONALIZAR);
  useEffect(() => {
    setPersonal(props.menuPersonal ?? SIN_PERSONALIZAR);
  }, [props.menuPersonal]);

  // Otra pestaña del mismo navegador guardó su menú: se vuelve a pedir el layout.
  useEffect(() => {
    if (!personal.disponible) return;
    return escucharCambioDeMenu(() => router.refresh());
  }, [personal.disponible, router]);

  const menu = useMemo(() => aplicarDiseno(personal.diseno, visibles), [personal.diseno, visibles]);
  const submenus = useMemo(
    () => menu.entradas.filter((e): e is Extract<EntradaArmada, { tipo: "submenu" }> => e.tipo === "submenu"),
    [menu.entradas],
  );
  const suspendidas = useMemo(() => opcionesSuspendida(), []);

  const userParaPermiso = useMemo(
    () => ({
      role: (props.user.role === "ACCOUNTANT" ? "READONLY" : props.user.role) as Role,
      permissionsOverride: props.user.permissionsOverride ?? [],
    }),
    [props.user.role, props.user.permissionsOverride],
  );
  // Mismo patrón que canCreateAppt del menú de siempre (el dueño no se filtra).
  const puede = useCallback(
    (key: PermissionKey) => props.user.role === "SUPER_ADMIN" || hasPermission(userParaPermiso, key),
    [props.user.role, userParaPermiso],
  );
  const puedeCrearCita = puede("agenda.create");
  // «Mi perfil» vive dentro de Configuración, que exige settings.view. A quien
  // no lo tiene no se le enseña: le llevaría a un rebote.
  const puedeVerPerfil = !isExpired && puede("settings.view");

  const etiqueta = useCallback((id: string) => t(`menuDosNiveles.nav.${id}`), [t]);
  /** Nombre de un submenú: el de la persona si lo renombró, si no el de fábrica. */
  const nombreSubmenu = useCallback(
    (entrada: Extract<EntradaArmada, { tipo: "submenu" }>) =>
      entrada.nombre ??
      (esSubmenuDeFabrica(entrada.id) ? t("menuDosNiveles.admin.titulo") : t("menuPersonalizado.submenuSinNombre")),
    [t],
  );
  /** Nombre de una sección del segundo nivel (grupo de fábrica o de la persona). */
  const nombreSeccion = useCallback(
    (seccion: SeccionArmada) =>
      seccion.nombre ??
      (esSeccionDeFabrica(seccion.id)
        ? t(`menuDosNiveles.grupo.${seccion.id}`)
        : t("menuPersonalizado.seccionSinNombre")),
    [t],
  );
  /** Abrir un submenú, o cerrarlo si ya estaba abierto. */
  const alternarSubmenu = useCallback((id: string) => {
    setSubmenuAbierto((abierto) => (abierto === id ? null : id));
    setConsulta("");
  }, []);
  const submenuEnPantalla = useMemo(
    () => submenus.find((sm) => sm.id === submenuAbierto) ?? null,
    [submenus, submenuAbierto],
  );
  const seccionesFiltradas = useMemo(
    () => (submenuEnPantalla ? filtrarSecciones(submenuEnPantalla.secciones, consulta, etiqueta) : []),
    [submenuEnPantalla, consulta, etiqueta],
  );
  // «Personalizar» solo existe con la tabla del SQL aplicada y con la clínica
  // activa: en una suspendida el menú se reduce a Facturación + Soporte.
  const puedePersonalizar = !isExpired && personal.disponible;

  // ── Cierres ──────────────────────────────────────────────────────
  const cerrarAdmin = useCallback((devolverFoco = false) => {
    setSubmenuAbierto((abierto) => {
      // Si el foco estaba dentro del segundo nivel, al desmontarse caería al
      // <body>: se devuelve a la fila del submenú que lo abrió.
      if (devolverFoco && abierto) {
        requestAnimationFrame(() =>
          raizRef.current?.querySelector<HTMLElement>(`[data-fila-submenu="${abierto}"]`)?.focus(),
        );
      }
      return null;
    });
    setConsulta("");
  }, []);

  // Cambiar de pantalla: el cajón del teléfono se cierra; el segundo nivel solo
  // se cierra si estaba encima de la pantalla (entre 1024 y 1279 px). Acoplado
  // se queda abierto para saltar entre pantallas de administración.
  const rutaAnterior = useRef(pathname);
  useEffect(() => {
    if (rutaAnterior.current === pathname) return;
    rutaAnterior.current = pathname;
    setCajonAbierto(false);
    if (esSuperpuesto) cerrarAdmin();
  }, [pathname, esSuperpuesto, cerrarAdmin]);

  useEffect(() => {
    if (!esMovil) setCajonAbierto(false);
  }, [esMovil]);

  // Las tres rayitas de la barra superior (solo existen en el teléfono).
  useEffect(() => {
    const abrir = () => {
      if (!window.matchMedia("(max-width: 1023.98px)").matches) return;
      setSubmenuAbierto(null);
      setConsulta("");
      setCajonAbierto(true);
    };
    window.addEventListener("mf:open-mobile-sidebar", abrir);
    return () => window.removeEventListener("mf:open-mobile-sidebar", abrir);
  }, []);

  useEffect(() => {
    if (submenuAbierto === null && !cajonAbierto) return;
    // Escape solo cierra el menú si el foco está en el menú. Con un diálogo
    // abierto encima (Nueva cita, Ctrl+K…) el Escape es de ese diálogo.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const activo = document.activeElement;
      if (cajonAbierto) {
        if (activo === document.body || (activo && cajonRef.current?.contains(activo))) setCajonAbierto(false);
        return;
      }
      if (activo && raizRef.current?.contains(activo)) cerrarAdmin(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submenuAbierto, cajonAbierto, cerrarAdmin]);

  // En el cajón, al pasar de una vista a otra se desmonta el botón que tenía el
  // foco: se lleva al primer control de la vista nueva.
  const vistaAnterior = useRef(submenuAbierto);
  useEffect(() => {
    if (vistaAnterior.current === submenuAbierto) return;
    const anterior = vistaAnterior.current;
    vistaAnterior.current = submenuAbierto;
    if (!cajonAbierto) return;
    cajonRef.current
      ?.querySelector<HTMLElement>(
        submenuAbierto ? "[data-foco-cajon]" : `[data-fila-submenu="${anterior ?? ""}"]`,
      )
      ?.focus();
  }, [submenuAbierto, cajonAbierto]);

  // Encima de la pantalla, un clic fuera del menú cierra el segundo nivel.
  useEffect(() => {
    if (submenuAbierto === null || !esSuperpuesto || esMovil) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && raizRef.current?.contains(target)) return;
      // Desplegables y diálogos (Nueva sucursal, Nueva cita…) viven en un
      // portal: un clic ahí no es "fuera del menú".
      if (target instanceof Element && target.closest('[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]')) return;
      cerrarAdmin();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [submenuAbierto, esSuperpuesto, esMovil, cerrarAdmin]);

  // ── Opciones ─────────────────────────────────────────────────────
  const renderOpcion = (item: NavItemDef, opts: { segundo?: boolean; compacto?: boolean }) => {
    const compacto = !!opts.compacto;
    const texto = etiqueta(item.id);
    const icono = ICONO_DE[item.id] ?? "chevron_right";
    const claseBase = cx(s.item, opts.segundo && s.itemSegundo);

    if (item.comingSoon) {
      return (
        <div key={item.id} className={cx(claseBase, s.proximamente)} title={`${texto} · ${t("menuDosNiveles.proximamente")}`} aria-disabled="true">
          <Icono nombre={icono} />
          {!compacto && <span className={s.itemTexto}>{texto}</span>}
          {!compacto && <span className={s.etiquetaProximamente}>{t("menuDosNiveles.proximamente")}</span>}
        </div>
      );
    }

    const conteo = item.countKey ? counts[item.countKey] : 0;
    const conConsulta = item.id === "home" && Boolean(consultaActiva);
    const iconoEstilo = item.id === "soporte" ? s.iconoSoporte : undefined;

    // Caja con la misma regla de visibilidad de siempre (billing.view), pero
    // quien no tiene el acceso a Caja activado ya no cae en «Caja no está en tu
    // plan», que es falso: el menú le dice qué pasa de verdad y no navega.
    if (item.id === "billing" && !props.puedeUsarCaja) {
      const aviso = t("menuDosNiveles.cajaSinAcceso");
      const boton = (
        <button
          key={item.id}
          type="button"
          className={claseBase}
          aria-label={`${texto}. ${aviso}`}
          onClick={() => toast(aviso, { id: "menu-caja-sin-acceso" })}
        >
          <Icono nombre={icono} />
          {!compacto && <span className={s.itemTexto}>{texto}</span>}
          {!compacto && <Icono nombre="lock" className={s.candado} />}
        </button>
      );
      return compacto ? conTooltip(item.id, boton, `${texto} · ${t("menuDosNiveles.cajaSinAccesoCorto")}`) : boton;
    }

    const activo = isActivePath(pathname, item.href, item.matchExact);
    const enlace = (
      <Link
        key={item.id}
        href={item.href}
        aria-current={activo ? "page" : undefined}
        className={cx(claseBase, activo && s.itemActivo)}
      >
        <Icono nombre={icono} relleno={activo} className={iconoEstilo} />
        {!compacto && <span className={s.itemTexto}>{texto}</span>}
        {!compacto && conteo > 0 && (
          <span className={s.contador} aria-label={t("sidebar.itemPending", { count: conteo })}>
            {conteo > 99 ? "99+" : conteo}
          </span>
        )}
        {!compacto && conConsulta && (
          <span className={s.puntoConsulta} role="img" aria-label={t("sidebar.consultInProgress")} title={t("sidebar.consultInProgress")} />
        )}
        {compacto && (conteo > 0 || conConsulta) && (
          <span aria-hidden className={s.puntoEncogido} data-consulta={conConsulta ? "true" : undefined} />
        )}
      </Link>
    );
    return compacto ? conTooltip(item.id, enlace, texto, conteo) : enlace;
  };

  function conTooltip(key: string, hijo: ReactNode, texto: string, conteo = 0) {
    return (
      <Tooltip.Root key={key} delayDuration={250}>
        <Tooltip.Trigger asChild>{hijo}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="right" sideOffset={8} className={cx(CLASES_MENU, s.tooltip)}>
            {texto}
            {conteo > 0 && <span className={s.contador}>{conteo > 99 ? "99+" : conteo}</span>}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  // ── Piezas del primer nivel ──────────────────────────────────────
  const marca = (compacto: boolean, accion: ReactNode) => (
    <div className={s.marca}>
      <span className={s.logoCuadro} aria-hidden>
        <svg width="18" height="18" viewBox="0 0 36 36" style={{ color: "var(--m2-activo-texto)" }}>
          <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
        </svg>
      </span>
      {!compacto && (
        <span className={s.logoTexto}>
          <b>Dale</b>Control
        </span>
      )}
      {accion}
    </div>
  );

  const subtituloClinica = [
    props.planEtiqueta,
    (props.allClinics?.length ?? 0) > 1 ? t("menuDosNiveles.sucursales", { count: props.allClinics?.length ?? 0 }) : null,
  ].filter(Boolean).join(" · ");

  const tarjetaClinica = (compacto: boolean) => {
    // En clínica suspendida, igual que hoy: solo si hay otra sede a la que salir.
    if (isExpired && (props.allClinics?.length ?? 0) <= 1) return null;
    return (
      <ClinicSwitcher
        collapsed={compacto}
        clinicName={props.clinicName}
        clinicId={props.clinicId}
        plan={props.plan}
        allClinics={props.allClinics ?? []}
        branches={props.branches}
        apariencia={{
          className: cx(s.tarjeta, s.tarjetaClinica, compacto && s.tarjetaCompacta),
          contentClassName: cx(CLASES_MENU, s.clinicasDesplegable),
          trigger: ({ hasMenu, initials }) => (
            <>
              <span className={s.iniciales} aria-hidden>{initials || "DC"}</span>
              {!compacto && (
                <span className={s.tarjetaTextos}>
                  <span className={s.tarjetaNombre} style={{ display: "block" }} title={props.clinicName}>{props.clinicName}</span>
                  {subtituloClinica && <span className={s.tarjetaSub} style={{ display: "block" }}>{subtituloClinica}</span>}
                </span>
              )}
              {!compacto && hasMenu && <Icono nombre="unfold_more" className={s.tarjetaFlecha} />}
            </>
          ),
        }}
      />
    );
  };

  const botonNuevaCita = (compacto: boolean) => {
    if (isExpired || !puedeCrearCita) return null;
    const boton = (
      <button
        type="button"
        className={s.nuevaCita}
        style={compacto ? { width: 44, marginInline: "auto" } : undefined}
        onClick={() => {
          setCajonAbierto(false);
          abrirNuevaCita({ openAgendaAfter: true });
        }}
        aria-label={t("sidebar.newAppointmentAria")}
      >
        <Icono nombre="add" />
        {!compacto && t("menuDosNiveles.nuevaCita")}
      </button>
    );
    return compacto ? conTooltip("nueva-cita", boton, t("menuDosNiveles.nuevaCita")) : boton;
  };

  /**
   * Fila que abre un segundo nivel. Con el menú de fábrica es «Administración»;
   * quien personalizó puede tener varias, con el nombre que les haya puesto.
   */
  const filaSubmenu = (
    entrada: Extract<EntradaArmada, { tipo: "submenu" }>,
    compacto: boolean,
    abierto: boolean,
    alPulsar: () => void,
  ) => {
    const texto = nombreSubmenu(entrada);
    const activo = submenuActivo(pathname, entrada.secciones);
    const boton = (
      <button
        type="button"
        className={cx(s.filaAdmin, activo && s.filaAdminActiva)}
        aria-expanded={abierto}
        aria-controls="menu-dos-niveles-admin"
        data-fila-submenu={entrada.id}
        onClick={alPulsar}
      >
        <Icono nombre={esSubmenuDeFabrica(entrada.id) ? "apps" : "folder"} />
        {!compacto && <span className={s.itemTexto}>{texto}</span>}
        {!compacto && <Icono nombre="chevron_right" className={s.tarjetaFlecha} />}
      </button>
    );
    return compacto ? conTooltip(`submenu-${entrada.id}`, boton, texto) : boton;
  };

  const tarjetaUsuario = (compacto: boolean) => (
    <TarjetaUsuario
      compacto={compacto}
      user={props.user}
      puedeVerPerfil={puedeVerPerfil}
      puedePersonalizar={puedePersonalizar}
      alPersonalizar={() => {
        setCajonAbierto(false);
        setEditorAbierto(true);
      }}
      alElegir={() => setCajonAbierto(false)}
    />
  );

  // El primer nivel es UNA lista: opciones y submenús en el orden en que estén.
  // Con el diseño de fábrica salen los seis de siempre, la raya y «Administración».
  const opcionesNivel1 = (compacto: boolean, alAbrirSubmenu: (id: string) => void) => (
    <nav aria-label={t("sidebar.navAria")} className={s.navegacion}>
      {isExpired
        ? suspendidas.map((it) => renderOpcion(it, { compacto }))
        : menu.entradas.map((e, i) => {
            const anterior = menu.entradas[i - 1];
            // Una raya donde cambia el tipo de fila (opciones sueltas ↔ submenús).
            const raya = Boolean(anterior) && anterior.tipo !== e.tipo;
            return (
              <Fragment key={e.tipo === "opcion" ? e.item.id : e.id}>
                {raya && <div className={s.separador} />}
                {e.tipo === "opcion"
                  ? renderOpcion(e.item, { compacto })
                  : filaSubmenu(e, compacto, submenuAbierto === e.id, () => alAbrirSubmenu(e.id))}
              </Fragment>
            );
          })}
    </nav>
  );

  // ── Segundo nivel ────────────────────────────────────────────────
  const contenidoSubmenu = (
    entrada: Extract<EntradaArmada, { tipo: "submenu" }>,
    secciones: SeccionArmada[],
    cabeceraAccion: ReactNode,
    cabeceraInicio?: ReactNode,
  ) => {
    const titulo = nombreSubmenu(entrada);
    const deFabrica = esSubmenuDeFabrica(entrada.id);
    const textoBuscar = deFabrica
      ? t("menuDosNiveles.admin.buscar")
      : t("menuPersonalizado.buscarEn", { nombre: titulo });
    // Los grupos de fábrica (DINERO, CLÍNICA…) llevan SIEMPRE su encabezado,
    // aunque queden solos: quitarlo cambiaría el menú de quien no personalizó
    // nada. El que no lo lleva es el grupo sin nombre de un submenú propio, que
    // pintaría un título vacío encima de la lista.
    const conEncabezado = (g: SeccionArmada) => Boolean(g.nombre) || esSeccionDeFabrica(g.id);
    return (
      <>
        <div className={s.n2Cabecera}>
          {cabeceraInicio}
          <h2 className={s.n2Titulo} style={{ flex: 1 }}>{titulo}</h2>
          {cabeceraAccion}
        </div>
        <label className={s.buscador}>
          <Icono nombre="search" />
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && consulta) {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setConsulta("");
              }
            }}
            placeholder={textoBuscar}
            aria-label={textoBuscar}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <nav aria-label={titulo} className={s.n2Nav}>
          {secciones.map((g: SeccionArmada) => (
            <section key={g.id} className={s.grupo} aria-labelledby={conEncabezado(g) ? `menu2-grupo-${g.id}` : undefined}>
              {conEncabezado(g) && (
                <h3 id={`menu2-grupo-${g.id}`} className={s.grupoTitulo}>{nombreSeccion(g)}</h3>
              )}
              {g.items.map((it) => renderOpcion(it, { segundo: true }))}
            </section>
          ))}
          {secciones.length === 0 && (
            <p className={s.sinResultados}>{t("menuDosNiveles.admin.sinResultados", { query: consulta.trim() })}</p>
          )}
        </nav>
      </>
    );
  };

  // «Personalizar» se abre desde la tarjeta de la persona y vive fuera del menú
  // (en un portal), así que sigue en pantalla aunque el cajón del teléfono se
  // cierre al abrirlo.
  const editor = puedePersonalizar ? (
    <EditorMenu
      abierto={editorAbierto}
      alCerrar={() => setEditorAbierto(false)}
      diseno={personal.diseno}
      revision={personal.revision}
      visibles={visibles}
      alAplicar={(diseno, revision) => {
        setPersonal({ disponible: true, diseno, revision });
        cerrarAdmin();
      }}
    />
  ) : null;

  // ── Teléfono y tableta (< 1024 px): cajón ────────────────────────
  if (esMovil) {
    // El mismo envoltorio que en escritorio a propósito: si el elemento raíz
    // cambiara de tipo al cruzar los 1024 px (girar la tableta), React
    // desmontaría el editor y se perdería lo que se estuviera acomodando.
    if (!cajonAbierto) return <Tooltip.Provider>{editor}</Tooltip.Provider>;
    return (
      <Tooltip.Provider>
        {editor}
        <div aria-hidden className={s.velo} onClick={() => setCajonAbierto(false)} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t("sidebar.mobileNav")}
          ref={cajonRef}
          className={cx(CLASES_MENU, s.cajon)}
          data-vista={submenuEnPantalla ? "admin" : "principal"}
        >
          {submenuEnPantalla ? (
            <div id="menu-dos-niveles-admin" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
              {contenidoSubmenu(
                submenuEnPantalla,
                seccionesFiltradas,
                <button type="button" className={s.botonIcono} onClick={() => setCajonAbierto(false)} aria-label={t("sidebar.closeNav")}>
                  <Icono nombre="close" />
                </button>,
                <button type="button" data-foco-cajon="" className={s.botonIcono} onClick={() => cerrarAdmin()} aria-label={t("menuDosNiveles.volver")}>
                  <Icono nombre="arrow_back" />
                </button>,
              )}
            </div>
          ) : (
            <>
              {marca(
                false,
                <button type="button" className={s.botonIcono} onClick={() => setCajonAbierto(false)} aria-label={t("sidebar.closeNav")}>
                  <Icono nombre="close" />
                </button>,
              )}
              {tarjetaClinica(false)}
              {botonNuevaCita(false)}
              {opcionesNivel1(false, alternarSubmenu)}
              <div className={s.pie}>{tarjetaUsuario(false)}</div>
            </>
          )}
        </aside>
      </Tooltip.Provider>
    );
  }

  // ── Escritorio ───────────────────────────────────────────────────
  return (
    <Tooltip.Provider>
      {editor}
      <div ref={raizRef} className={cx(CLASES_MENU, s.raiz)}>
        <aside aria-label={t("sidebar.asideAria")} className={s.nivel1} data-encogido={encogido ? "true" : "false"}>
          {marca(
            encogido,
            <button
              type="button"
              className={s.botonIcono}
              onClick={() => setEncogido(!encogido)}
              aria-label={encogido ? t("sidebar.expand") : t("sidebar.collapse")}
              aria-pressed={encogido}
              title={encogido ? t("sidebar.expand") : t("sidebar.collapse")}
            >
              <Icono nombre={encogido ? "left_panel_open" : "left_panel_close"} />
            </button>,
          )}
          {tarjetaClinica(encogido)}
          {botonNuevaCita(encogido)}
          {opcionesNivel1(encogido, alternarSubmenu)}
          <div className={s.pie}>{tarjetaUsuario(encogido)}</div>
        </aside>

        {submenuEnPantalla && (
          <aside id="menu-dos-niveles-admin" aria-label={nombreSubmenu(submenuEnPantalla)} className={s.nivel2}>
            {contenidoSubmenu(
              submenuEnPantalla,
              seccionesFiltradas,
              <button type="button" className={s.botonIcono} onClick={() => cerrarAdmin(true)} aria-label={t("menuDosNiveles.admin.cerrar")}>
                <Icono nombre="close" />
              </button>,
            )}
          </aside>
        )}
      </div>
    </Tooltip.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tarjeta de la persona: Mi perfil, modo oscuro y cerrar sesión
// ═══════════════════════════════════════════════════════════════════

const ROL_CLAVE: Record<UserRole, string> = {
  SUPER_ADMIN: "menuDosNiveles.rol.owner",
  ADMIN: "menuDosNiveles.rol.admin",
  DOCTOR: "menuDosNiveles.rol.doctor",
  RECEPTIONIST: "menuDosNiveles.rol.receptionist",
  READONLY: "menuDosNiveles.rol.readonly",
  ACCOUNTANT: "menuDosNiveles.rol.accountant",
};

function TarjetaUsuario({
  compacto,
  user,
  puedeVerPerfil,
  puedePersonalizar,
  alPersonalizar,
  alElegir,
}: {
  compacto: boolean;
  user: SidebarProps["user"];
  puedeVerPerfil: boolean;
  /** false mientras falte el SQL de «Personalizar» o la clínica esté suspendida. */
  puedePersonalizar: boolean;
  alPersonalizar: () => void;
  alElegir: () => void;
}) {
  const t = useT();
  const pathname = usePathname();
  const enConfiguracion = pathname === "/dashboard/settings" || (pathname ?? "").startsWith("/dashboard/settings/");
  const [oscuro, setOscuro] = useState(false);

  useEffect(() => {
    const sync = () => setOscuro(document.documentElement.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Misma lógica que el botón «Modo oscuro» del menú de siempre.
  const alternarTema = () => {
    const html = document.documentElement;
    const ahoraOscuro = !html.classList.contains("dark");
    html.classList.toggle("dark", ahoraOscuro);
    try { window.localStorage.setItem("theme", ahoraOscuro ? "dark" : "light"); } catch {}
    setOscuro(ahoraOscuro);
  };

  const nombre = `${user.firstName} ${user.lastName}`.trim();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cx(s.tarjeta, compacto && s.tarjetaCompacta)}
        aria-label={t("sidebar.userMenuAria", { name: nombre })}
      >
        <span className={s.avatar} aria-hidden>{iniciales(nombre) || "?"}</span>
        {!compacto && (
          <span className={s.tarjetaTextos}>
            <span className={s.tarjetaNombre} style={{ display: "block" }}>{nombre}</span>
            <span className={s.tarjetaSub} style={{ display: "block" }}>{t(ROL_CLAVE[user.role])}</span>
          </span>
        )}
        {!compacto && <Icono nombre="unfold_more" className={s.tarjetaFlecha} />}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" side="top" sideOffset={6} className={cx(CLASES_MENU, s.desplegable)}>
          {puedeVerPerfil && (
            <DropdownMenu.Item asChild className={s.desplegableItem} onSelect={alElegir}>
              {/* Dentro de Configuración la pestaña solo se lee al montar la
                  pantalla: ahí se navega "de verdad" para que cambie. */}
              {enConfiguracion ? (
                <a href="/dashboard/settings?tab=perfil">
                  <Icono nombre="person" />
                  {t("menuDosNiveles.miPerfil")}
                </a>
              ) : (
                <Link href="/dashboard/settings?tab=perfil">
                  <Icono nombre="person" />
                  {t("menuDosNiveles.miPerfil")}
                </Link>
              )}
            </DropdownMenu.Item>
          )}
          {puedePersonalizar && (
            <DropdownMenu.Item className={s.desplegableItem} onSelect={alPersonalizar}>
              <Icono nombre="dashboard_customize" />
              {t("menuPersonalizado.entrada")}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            className={s.desplegableItem}
            onSelect={(e) => {
              e.preventDefault();
              alternarTema();
            }}
          >
            <Icono nombre={oscuro ? "light_mode" : "dark_mode"} />
            {oscuro ? t("sidebar.modeLight") : t("sidebar.modeDark")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={s.desplegableSeparador} />
          <DropdownMenu.Item className={cx(s.desplegableItem, s.desplegablePeligro)} onSelect={() => { void cerrarSesionPanel(); }}>
            <Icono nombre="logout" />
            {t("sidebar.logout")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
