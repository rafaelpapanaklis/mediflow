"use client";

import { useMemo } from "react";
import { ChevronDown, FolderOpen, MoreHorizontal, Stethoscope } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildPatientNavItems,
  type PatientNavItem,
  type PatientNavPediatricsConfig,
} from "@/components/dashboard/patient-detail/patient-nav-items";
import { useT } from "@/i18n/i18n-provider";
import { construirMenuFicha, type IdGrupo } from "./menu-estructura";
import { CLASES_REDISENO } from "./raiz";
import s from "./rediseno.module.css";

/**
 * El menú de la ficha, rediseñado: seis apartados siempre a la vista y tres
 * desplegables fijos, iguales en toda pantalla.
 *
 * Lo que sustituye: una barra que MIDE en vivo el ancho que le sobra y decide
 * cuántos apartados enseñar. A 1440 px con el menú lateral abierto caben cinco
 * de diecisiete y los otros doce viven dentro de «Más» y «Administrativo»; y
 * como la medida es en vivo, abrir o cerrar el menú lateral cambia el menú de
 * la ficha. Un menú que cambia de contenido no se aprende con el músculo.
 *
 * Aquí no hay `ResizeObserver` ni capa espejo: la forma está decidida en
 * `menu-estructura.ts` y es la misma a 1440, a 1280 y en iPad. En el teléfono
 * la fila se DESLIZA (los seis fijos siguen siendo los seis fijos), no se
 * reorganiza.
 *
 * Cuando el apartado abierto vive dentro de un grupo, el botón del grupo dice
 * dónde estás: «Clínico · Recetas».
 */

export interface FichaMenuProps {
  activeTab: string;
  onSelect: (tabId: string) => void;
  counts: {
    historia?: number;
    historialConsultas?: number;
    odontograma?: number;
    radiografias?: number;
    fotos?: number;
    tratamiento?: number;
    referencias?: number;
    agenda?: number;
    facturacion?: number;
    implantes?: number;
  };
  hasBalance: boolean;
  pediatrics?: PatientNavPediatricsConfig;
  showPeriodontics?: boolean;
  showEndodontics?: boolean;
  showImplants?: boolean;
  showOrthodontics?: boolean;
  showBilling?: boolean;
  showConsents?: boolean;
  showXrays?: boolean;
  showPrescriptions?: boolean;
}

const ICONO_GRUPO: Record<IdGrupo, typeof Stethoscope> = {
  clinico: Stethoscope,
  archivos: FolderOpen,
  mas: MoreHorizontal,
};

export function FichaMenu({
  activeTab,
  onSelect,
  counts,
  hasBalance,
  pediatrics,
  showPeriodontics,
  showEndodontics,
  showImplants,
  showOrthodontics,
  showBilling,
  showConsents,
  showXrays,
  showPrescriptions,
}: FichaMenuProps) {
  const t = useT();

  const menu = useMemo(
    () =>
      construirMenuFicha(
        buildPatientNavItems({
          pediatrics: pediatrics ?? { state: "hidden" },
          showPeriodontics: Boolean(showPeriodontics),
          showEndodontics: Boolean(showEndodontics),
          showImplants: Boolean(showImplants),
          showOrthodontics: Boolean(showOrthodontics),
          showBilling,
          showConsents,
          showXrays,
          showPrescriptions,
        }),
      ),
    [
      pediatrics,
      showPeriodontics,
      showEndodontics,
      showImplants,
      showOrthodontics,
      showBilling,
      showConsents,
      showXrays,
      showPrescriptions,
    ],
  );

  const contadorDe: Record<string, number | undefined> = {
    historia: counts.historia,
    "historial-consultas": counts.historialConsultas,
    odontograma: counts.odontograma,
    radiografias: counts.radiografias,
    fotos: counts.fotos,
    tratamiento: counts.tratamiento,
    referencias: counts.referencias,
    agenda: counts.agenda,
    facturacion: counts.facturacion,
    implantes: counts.implantes,
  };

  /** El contador de Facturación se pinta en rojo cuando el paciente debe. */
  const esDeuda = (id: string) => id === "facturacion" && hasBalance;

  const contador = (id: string, dentroDeActivo: boolean) => {
    const n = contadorDe[id];
    if (n === undefined || n <= 0) return null;
    return (
      <span
        className={[s.contador, esDeuda(id) && !dentroDeActivo ? s.contadorDeuda : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {n}
      </span>
    );
  };

  const pintarFijo = (item: PatientNavItem) => {
    const Icono = item.icon;
    const activo = activeTab === item.id;
    const apagado = item.disabled === true;
    return (
      <button
        key={item.id}
        type="button"
        className={[s.item, activo ? s.itemActivo : "", apagado ? s.itemApagado : ""]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (!apagado) onSelect(item.id);
        }}
        disabled={apagado}
        aria-disabled={apagado || undefined}
        aria-current={activo ? "page" : undefined}
        title={apagado ? item.disabledReason : t(item.labelKey)}
        aria-label={item.shortLabelKey ? t(item.labelKey) : undefined}
      >
        <Icono size={16} strokeWidth={1.75} aria-hidden className={s.itemIcono} />
        {/* La etiqueta corta («Plan» por «Plan de tratamiento») es una decisión
            de PRESENTACIÓN, la misma que ya tomaba la barra de siempre: el
            nombre completo del módulo sigue en el tooltip y en el desplegable.
            Con el nombre largo, los nueve botones no cabían a 1440 y el menú
            volvía a esconder cosas, que es justo lo que se venía a arreglar. */}
        <span>{item.shortLabelKey ? t(item.shortLabelKey) : t(item.labelKey)}</span>
        {contador(item.id, activo)}
      </button>
    );
  };

  const pintarOpcion = (item: PatientNavItem) => {
    const Icono = item.icon;
    const activo = activeTab === item.id;
    const apagado = item.disabled === true;
    return (
      <DropdownMenuItem
        key={item.id}
        disabled={apagado}
        onSelect={() => {
          if (!apagado) onSelect(item.id);
        }}
        className={[s.opcion, activo ? s.opcionActiva : ""].filter(Boolean).join(" ")}
        aria-current={activo ? "page" : undefined}
      >
        <Icono size={16} strokeWidth={1.75} aria-hidden className={s.itemIcono} />
        <span className={s.opcionEtiqueta}>{t(item.labelKey)}</span>
        {item.isNew && <span className={s.nuevo}>{t("patients.quickNav.newBadge")}</span>}
        {contador(item.id, false)}
      </DropdownMenuItem>
    );
  };

  return (
    <div className={s.menuPegajoso}>
      <nav className={s.menu} aria-label={t("patients.tabs.sectionsAria")}>
        <div className={s.menuFijos}>{menu.fijos.map(pintarFijo)}</div>

        {menu.grupos.length > 0 && <span className={s.menuSeparador} aria-hidden />}

        <div className={s.menuGrupos}>
        {menu.grupos.map((grupo) => {
          const dentro = grupo.items.find((i) => i.id === activeTab);
          const nombre = t(grupo.labelKey);
          const Icono = ICONO_GRUPO[grupo.id];
          // «Clínico · Recetas» — estar dentro de un desplegable no puede
          // significar no saber dónde estás.
          const etiqueta = dentro ? `${nombre} · ${t(dentro.labelKey)}` : nombre;
          const hayNovedad = grupo.items.some(
            (i) => i.isNew || (contadorDe[i.id] ?? 0) > 0,
          );
          return (
            <DropdownMenu key={grupo.id}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={[s.item, s.grupoTrigger, dentro ? s.grupoDentro : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={etiqueta}
                >
                  {dentro ? (
                    <dentro.icon size={16} strokeWidth={1.75} aria-hidden className={s.itemIcono} />
                  ) : (
                    <Icono size={16} strokeWidth={1.75} aria-hidden className={s.itemIcono} />
                  )}
                  <span>{etiqueta}</span>
                  {!dentro && hayNovedad && <span className={s.punto} aria-hidden />}
                  <ChevronDown size={13} strokeWidth={2} aria-hidden className={s.chevron} />
                </button>
              </DropdownMenuTrigger>
              {/* El desplegable cuelga del <body> por el portal de Radix, o
                  sea FUERA de la raíz del rediseño: sin estas clases se
                  quedaría sin la tipografía y sin los tokens de color. */}
              <DropdownMenuContent align="start" className={`${CLASES_REDISENO} ${s.desplegable}`}>
                <div className={s.desplegableTitulo}>{nombre}</div>
                {grupo.items.map(pintarOpcion)}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        </div>
      </nav>
    </div>
  );
}
