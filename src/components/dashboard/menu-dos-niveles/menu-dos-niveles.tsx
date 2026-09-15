"use client";
// Menú de dos niveles del panel dental. Se enciende POR CLÍNICA
// (src/lib/menu-dos-niveles/interruptor.ts); con el interruptor apagado el
// layout pinta el <Sidebar> de siempre y este archivo ni se monta.
//
// Qué opciones ve cada persona NO se decide aquí: sale de opcionesVisibles()
// (estructura.ts), que usa el mismo shouldShowItem que el menú de siempre.
// Aquí solo se decide dónde se pinta cada una.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { instrumentSans, materialSymbols } from "@/fonts/menu";
import {
  ICONO_DE,
  armarMenu,
  filtrarGrupos,
  opcionesSuspendida,
  opcionesVisibles,
  segundoNivelActivo,
  type GrupoArmado,
} from "./estructura";
import { Icono } from "./icono";
import s from "./menu-dos-niveles.module.css";

export interface MenuDosNivelesProps extends SidebarProps {
  /** canUseCaja(user), resuelto en el servidor (caja-pin importa bcrypt). */
  puedeUsarCaja: boolean;
  /** Nombre del plan tal como está en plan_configs («Profesional»). */
  planEtiqueta: string | null;
}

/** Clases que tiene que llevar todo lo que pinta el menú, portales incluidos. */
export const CLASES_MENU = [s.tokens, instrumentSans.variable, materialSymbols.variable].join(" ");

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

  const [encogido, setEncogido] = useEncogido();
  const esMovil = useMedia("(max-width: 1023.98px)");
  const esSuperpuesto = useMedia("(max-width: 1279.98px)");
  const [adminAbierto, setAdminAbierto] = useState(false);
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const [vistaCajon, setVistaCajon] = useState<"principal" | "admin">("principal");
  const [consulta, setConsulta] = useState("");
  const raizRef = useRef<HTMLDivElement>(null);
  const cajonRef = useRef<HTMLElement>(null);

  const isExpired = props.isExpired ?? false;
  const clinicModuleKeys = useMemo(() => props.clinicModuleKeys ?? [], [props.clinicModuleKeys]);

  // Quién ve qué: el filtro del menú de siempre, sin tocar.
  const menu = useMemo(
    () => armarMenu(opcionesVisibles(props.user, props.clinicCategory, clinicModuleKeys)),
    [props.user, props.clinicCategory, clinicModuleKeys],
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
  const gruposFiltrados = useMemo(
    () => filtrarGrupos(menu.grupos, consulta, etiqueta),
    [menu.grupos, consulta, etiqueta],
  );
  const hayAdmin = !isExpired && menu.grupos.length > 0;
  const adminActivo = segundoNivelActivo(pathname, menu.grupos);

  // ── Cierres ──────────────────────────────────────────────────────
  const cerrarAdmin = useCallback((devolverFoco = false) => {
    setAdminAbierto(false);
    setConsulta("");
    // Si el foco estaba dentro del segundo nivel, al desmontarse caería al
    // <body>: se devuelve a la fila «Administración».
    if (devolverFoco) {
      requestAnimationFrame(() => raizRef.current?.querySelector<HTMLElement>("[data-fila-admin]")?.focus());
    }
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
      setVistaCajon("principal");
      setCajonAbierto(true);
    };
    window.addEventListener("mf:open-mobile-sidebar", abrir);
    return () => window.removeEventListener("mf:open-mobile-sidebar", abrir);
  }, []);

  useEffect(() => {
    if (!adminAbierto && !cajonAbierto) return;
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
  }, [adminAbierto, cajonAbierto, cerrarAdmin]);

  // En el cajón, al pasar de una vista a otra se desmonta el botón que tenía el
  // foco: se lleva al primer control de la vista nueva.
  const vistaAnterior = useRef(vistaCajon);
  useEffect(() => {
    if (vistaAnterior.current === vistaCajon) return;
    vistaAnterior.current = vistaCajon;
    if (!cajonAbierto) return;
    cajonRef.current?.querySelector<HTMLElement>(vistaCajon === "admin" ? "[data-foco-cajon]" : "[data-fila-admin]")?.focus();
  }, [vistaCajon, cajonAbierto]);

  // Encima de la pantalla, un clic fuera del menú cierra el segundo nivel.
  useEffect(() => {
    if (!adminAbierto || !esSuperpuesto || esMovil) return;
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
  }, [adminAbierto, esSuperpuesto, esMovil, cerrarAdmin]);

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

  const filaAdmin = (compacto: boolean, abierto: boolean, alPulsar: () => void) => {
    if (!hayAdmin) return null;
    const boton = (
      <button
        type="button"
        className={cx(s.filaAdmin, adminActivo && s.filaAdminActiva)}
        aria-expanded={abierto}
        aria-controls="menu-dos-niveles-admin"
        data-fila-admin=""
        onClick={alPulsar}
      >
        <Icono nombre="apps" />
        {!compacto && <span className={s.itemTexto}>{t("menuDosNiveles.admin.titulo")}</span>}
        {!compacto && <Icono nombre="chevron_right" className={s.tarjetaFlecha} />}
      </button>
    );
    return compacto ? conTooltip("admin", boton, t("menuDosNiveles.admin.titulo")) : boton;
  };

  const tarjetaUsuario = (compacto: boolean) => (
    <TarjetaUsuario
      compacto={compacto}
      user={props.user}
      puedeVerPerfil={puedeVerPerfil}
      alElegir={() => setCajonAbierto(false)}
    />
  );

  const opcionesNivel1 = (compacto: boolean) => (
    <nav aria-label={t("sidebar.navAria")} className={s.navegacion}>
      {(isExpired ? suspendidas : menu.nivel1).map((it) => renderOpcion(it, { compacto }))}
    </nav>
  );

  // ── Segundo nivel ────────────────────────────────────────────────
  const contenidoAdmin = (cabeceraAccion: ReactNode, cabeceraInicio?: ReactNode) => (
    <>
      <div className={s.n2Cabecera}>
        {cabeceraInicio}
        <h2 className={s.n2Titulo} style={{ flex: 1 }}>{t("menuDosNiveles.admin.titulo")}</h2>
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
          placeholder={t("menuDosNiveles.admin.buscar")}
          aria-label={t("menuDosNiveles.admin.buscar")}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <nav aria-label={t("menuDosNiveles.admin.titulo")} className={s.n2Nav}>
        {gruposFiltrados.map((g: GrupoArmado) => (
          <section key={g.id} className={s.grupo} aria-labelledby={`menu2-grupo-${g.id}`}>
            <h3 id={`menu2-grupo-${g.id}`} className={s.grupoTitulo}>{t(`menuDosNiveles.grupo.${g.id}`)}</h3>
            {g.items.map((it) => renderOpcion(it, { segundo: true }))}
          </section>
        ))}
        {gruposFiltrados.length === 0 && (
          <p className={s.sinResultados}>{t("menuDosNiveles.admin.sinResultados", { query: consulta.trim() })}</p>
        )}
      </nav>
    </>
  );

  // ── Teléfono y tableta (< 1024 px): cajón ────────────────────────
  if (esMovil) {
    if (!cajonAbierto) return null;
    return (
      <Tooltip.Provider>
        <div aria-hidden className={s.velo} onClick={() => setCajonAbierto(false)} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t("sidebar.mobileNav")}
          ref={cajonRef}
          className={cx(CLASES_MENU, s.cajon)}
          data-vista={vistaCajon}
        >
          {vistaCajon === "admin" ? (
            <div id="menu-dos-niveles-admin" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
              {contenidoAdmin(
                <button type="button" className={s.botonIcono} onClick={() => setCajonAbierto(false)} aria-label={t("sidebar.closeNav")}>
                  <Icono nombre="close" />
                </button>,
                <button type="button" data-foco-cajon="" className={s.botonIcono} onClick={() => { setVistaCajon("principal"); setConsulta(""); }} aria-label={t("menuDosNiveles.volver")}>
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
              {opcionesNivel1(false)}
              {hayAdmin && <div className={s.separador} />}
              {filaAdmin(false, false, () => setVistaCajon("admin"))}
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
          {opcionesNivel1(encogido)}
          {hayAdmin && <div className={s.separador} />}
          {filaAdmin(encogido, adminAbierto, () => (adminAbierto ? cerrarAdmin() : setAdminAbierto(true)))}
          <div className={s.pie}>{tarjetaUsuario(encogido)}</div>
        </aside>

        {hayAdmin && adminAbierto && (
          <aside id="menu-dos-niveles-admin" aria-label={t("menuDosNiveles.admin.titulo")} className={s.nivel2}>
            {contenidoAdmin(
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
  alElegir,
}: {
  compacto: boolean;
  user: SidebarProps["user"];
  puedeVerPerfil: boolean;
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
