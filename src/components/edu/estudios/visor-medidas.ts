"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LAS MEDIDAS DEL VISOR — la VENTANA real, nunca el aparato adivinado.
 *
 * Todo lo de este archivo sale de dos APIs del navegador y de nada más:
 *   · `matchMedia` para saber si la ventana da o no para una rejilla, y
 *   · `ResizeObserver` + `getComputedStyle` para saber cuánto mide de
 *     verdad la caja donde caben los paneles.
 *
 * 🔴 POR QUÉ NO SE MIRA EL USER-AGENT. Un iPad Pro en horizontal tiene más
 * pantalla que muchas laptops, y un teléfono girado tiene MENOS alto que
 * ancho. Preguntar "¿es una tablet?" contesta la pregunta equivocada: la
 * que importa es "¿cuánta pantalla hay AHORA?". El user-agent sigue vivo
 * en cbct-viewer.tsx para UNA cosa distinta —cuánta MEMORIA se le puede
 * pedir al aparato— y eso sí es una propiedad del hardware, no del vidrio.
 *
 * 🔴 NI UNA CONSULTA DE CONTENEDOR. El visor se abre en una hoja `fixed` a
 * pantalla completa; un @container lo ataría al ancho de la columna que lo
 * contiene y el `fixed` quedaría atrapado dentro. Es la misma razón por la
 * que el cajón del menú del vertical usa @media. Aquí la responsividad
 * viene de MEDIR la ventana y la caja real, que tiene la misma propiedad
 * (nada queda atrapado) y además puede hacer una cuenta que un corte fijo
 * en el CSS no puede: elegir el reparto de columnas que hace los paneles
 * MÁS GRANDES en la pantalla que hay delante. El CSS conserva un @media de
 * respaldo por si el primer pintado llega antes que la primera medida.
 *
 * 🔴 GIRAR EL APARATO NO PUEDE VOLVER A DECODIFICAR NADA. Por eso todo lo
 * de aquí devuelve NÚMEROS (un lado en px), no una decisión de montar o
 * desmontar: el volumen —668 cortes, 296 MB— vive en el estado del visor y
 * los paneles solo cambian de tamaño. Y por eso la consulta "compacto"
 * usa el LADO MENOR de la ventana: es el mismo antes y después del giro,
 * así que un teléfono que rota no cruza el umbral ni remonta un panel.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Hueco entre paneles. Tiene que ser el MISMO número que el `gap` de
 *  `.edu-visor3d-grid` en edu-theme.css: si se separan, los "cuadrados"
 *  dejan de serlo por la diferencia. */
export const EDU_REJILLA_GAP = 8;

/**
 * Alto de la barra de control que MprPane pinta BAJO el corte (la regleta
 * del número de corte: `py-1.5` + un `input[type=range]`). No es un número
 * inventado: es el alto que hay que descontar del lado del cuadrado para
 * que la TARJETA entera —imagen + barra— salga cuadrada, y el mismo que se
 * le da por CSS a la barra del panel del volumen para que las cuatro
 * tarjetas midan igual. Si el dental cambiara esa barra, el desajuste es
 * de un par de píxeles: nada se rompe, solo deja de ser exacto.
 */
export const EDU_PANEL_CHROME = 34;

/** Por debajo de esto un corte ya no se lee; antes que encogerlo más, que
 *  la rejilla se desplace. */
const EDU_PANEL_MIN = 220;

/** Paneles CUADRADOS de la rejilla: axial, coronal, sagital y volumen. La
 *  panorámica no cuenta — es ancha por naturaleza y va en su propia fila. */
const EDU_PANELES_CUADRADOS = 4;

/**
 * Repartos posibles de esos cuatro paneles. Son tres y no cuatro a
 * propósito: con 3 columnas el cuarto panel se queda solo en la segunda
 * fila y deja dos huecos, y encima nunca gana —una rejilla de 3 necesita
 * exactamente el mismo alto que una de 2 (dos filas) con columnas más
 * estrechas, así que 2 le gana siempre—.
 *   · 1 → una columna, cuatro filas (ventana angosta y alta)
 *   · 2 → el 2×2 de siempre
 *   · 4 → una sola fila (monitores anchos: es lo que evita dejar media
 *         pantalla en negro con paneles pequeños en el centro)
 */
export const EDU_COLUMNAS_CANDIDATAS = [1, 2, 4];

/**
 * "Compacto" = una vista a la vez. Se cumple si la ventana es angosta O si
 * es baja EN UN APARATO TÁCTIL (un teléfono acostado). Fíjate que la coma
 * es un OR y el `and` liga solo a la segunda: `(angosta) OR (baja Y dedo)`.
 *
 * El umbral se compara SIEMPRE contra el lado menor efectivo, así que un
 * teléfono da "compacto" de pie y acostado: girarlo no cambia de rama y no
 * remonta nada. Un iPad de pie (768) o acostado (1024) nunca es compacto.
 *
 * ⚠️ Este texto tiene que coincidir con el @media de `.edu-visor3d-grid`
 * en edu-theme.css, donde queda anotado el mismo trato.
 */
export const EDU_MEDIA_COMPACTO =
  "(max-width: 599.98px), (max-height: 599.98px) and (pointer: coarse)";

/** ¿Se maneja con el dedo? Decide el TEXTO de la ayuda del visor, no el
 *  tamaño de nada. */
export const EDU_MEDIA_TACTIL = "(pointer: coarse)";

/**
 * matchMedia como estado de React.
 *
 * 🔴 SE LEE YA EN EL PRIMER RENDER, no en un efecto. Si empezara en `false`
 * y se corrigiera después, un teléfono montaría por un instante las cinco
 * vistas —incluidas la textura 3D y la panorámica— antes de darse cuenta de
 * que solo cabía una. En el servidor no hay ventana y devuelve `false`, que
 * es correcto porque quien lo usa (el visor CBCT) entra por
 * `dynamic(ssr:false)` y no se pinta nunca en el HTML del servidor: no hay
 * hidratación que desencajar.
 */
export function useEduMedia(query: string): boolean {
  const [activa, setActiva] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const leer = () => setActiva(mql.matches);
    leer();
    // Safari viejo no tiene addEventListener en MediaQueryList.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", leer);
      return () => mql.removeEventListener("change", leer);
    }
    mql.addListener(leer);
    return () => mql.removeListener(leer);
  }, [query]);

  return activa;
}

/** El ancestro que DESPLAZA. Es quien manda cuánto alto hay de verdad: la
 *  ventana puede ser enorme y la caja del visor pequeña. */
function eduScroller(el: HTMLElement): HTMLElement {
  let n: HTMLElement | null = el.parentElement;
  while (n) {
    const ov = window.getComputedStyle(n).overflowY;
    if (ov === "auto" || ov === "scroll" || ov === "overlay") return n;
    n = n.parentElement;
  }
  return document.documentElement;
}

export interface EduMedidasRejilla {
  /** Lado del panel CUADRADO, en px (tarjeta entera: imagen + barra). */
  lado: number;
  /** Alto libre real bajo la rejilla dentro del contenedor que desplaza. */
  disponible: number;
  /** Columnas elegidas (1, 2 o 4). Se APLICAN en línea sobre la rejilla. */
  columnas: number;
  /** Ancho al que hay que atar la rejilla para que las celdas salgan
   *  cuadradas cuando manda el ALTO (si no, la celda sería más ancha que
   *  alta y "cuadrado" se quedaría en promesa). */
  anchoMax: number;
}

const CERO: EduMedidasRejilla = { lado: 0, disponible: 0, columnas: 2, anchoMax: 0 };

/**
 * Elige el reparto que hace los paneles MÁS GRANDES, con la regla de que
 * los cuatro cuadrados quepan en la pantalla sin desplazar.
 *
 * Para cada candidato: con N columnas, los 4 paneles ocupan ceil(4/N)
 * filas, y el lado no puede pasar ni del ancho de columna ni del alto
 * libre repartido entre esas filas. Gana el lado mayor; a igualdad, el
 * reparto de MENOS columnas (el 2×2 antes que la tira de cuatro).
 *
 * Esto es lo que impide el error de "paneles chicos en medio de un monitor
 * enorme": en una ventana 1834×650 dos filas de cuadrados topan en 321 px
 * y usan 979 px de 1834; una sola fila de cuatro llega a 448 px y usa el
 * ancho entero. La cuenta lo ve; un corte fijo en el CSS, no.
 */
export function eduMejorReparto(
  anchoLibre: number,
  disponible: number,
): { columnas: number; lado: number } {
  let mejor = { columnas: 2, lado: 0 };
  for (const n of EDU_COLUMNAS_CANDIDATAS) {
    const filas = Math.ceil(EDU_PANELES_CUADRADOS / n);
    const porAncho = Math.floor((anchoLibre - (n - 1) * EDU_REJILLA_GAP) / n);
    const porAlto = Math.floor((disponible - (filas - 1) * EDU_REJILLA_GAP) / filas);
    const lado = Math.min(porAncho, porAlto);
    if (lado > mejor.lado) mejor = { columnas: n, lado };
  }
  return mejor;
}

/**
 * Mide la rejilla y devuelve el reparto y el lado del cuadrado.
 *
 * No hay bucle de medida: el ancho se lee del PADRE (que no cambia cuando
 * la rejilla se estrecha) y el alto de la POSICIÓN de la rejilla (que no
 * se mueve cuando sus filas crecen). Y aun así, `setState` solo dispara si
 * algún número cambió de verdad.
 */
export function useEduMedidasRejilla(
  rejillaRef: RefObject<HTMLElement | null>,
  pieRef: RefObject<HTMLElement | null>,
  listo: boolean,
): EduMedidasRejilla {
  const [medidas, setMedidas] = useState<EduMedidasRejilla>(CERO);
  const rafRef = useRef(0);

  const medir = useCallback(() => {
    rafRef.current = 0;
    const rejilla = rejillaRef.current;
    if (!rejilla || typeof window === "undefined") return;

    // Alto libre: desde donde empieza la rejilla hasta el fondo del
    // contenedor que desplaza, menos lo que va DEBAJO (los dos avisos).
    // Se mide en coordenadas del contenido (sumando scrollTop) para que
    // desplazar la vista no cambie el resultado.
    const scroller = eduScroller(rejilla);
    const cajaScroller = scroller.getBoundingClientRect();
    const cajaRejilla = rejilla.getBoundingClientRect();
    const arriba = cajaRejilla.top - cajaScroller.top + scroller.scrollTop;
    const pie = pieRef.current ? pieRef.current.offsetHeight : 0;
    const disponible = Math.max(
      EDU_PANEL_MIN + EDU_PANEL_CHROME,
      Math.round(scroller.clientHeight - arriba - pie - EDU_REJILLA_GAP * 2),
    );

    // Ancho libre: el del PADRE, no el de la rejilla — la rejilla ya puede
    // venir atada por el `anchoMax` de la medición anterior.
    const padre = rejilla.parentElement;
    const anchoLibre = padre ? padre.clientWidth : rejilla.clientWidth;

    const reparto = eduMejorReparto(anchoLibre, disponible);
    const columnas = reparto.columnas;
    const lado = Math.max(EDU_PANEL_MIN, reparto.lado);
    const anchoMax = columnas * lado + (columnas - 1) * EDU_REJILLA_GAP;

    setMedidas((prev) =>
      prev.lado === lado &&
      prev.disponible === disponible &&
      prev.columnas === columnas &&
      prev.anchoMax === anchoMax
        ? prev
        : { lado, disponible, columnas, anchoMax },
    );
  }, [rejillaRef, pieRef]);

  useEffect(() => {
    if (!listo) return;
    const rejilla = rejillaRef.current;
    if (!rejilla) return;
    if (typeof ResizeObserver === "undefined") {
      medir();
      return;
    }

    const pedir = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(medir);
    };

    const ro = new ResizeObserver(pedir);
    const scroller = eduScroller(rejilla);
    if (scroller !== document.documentElement) ro.observe(scroller);
    if (rejilla.parentElement) ro.observe(rejilla.parentElement);
    if (pieRef.current) ro.observe(pieRef.current);

    // El giro del aparato no siempre llega por el ResizeObserver a tiempo.
    window.addEventListener("resize", pedir);
    window.addEventListener("orientationchange", pedir);
    pedir();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      ro.disconnect();
      window.removeEventListener("resize", pedir);
      window.removeEventListener("orientationchange", pedir);
    };
  }, [listo, medir, rejillaRef, pieRef]);

  return medidas;
}

export interface EduPantallaCompleta {
  /** ¿El navegador deja poner un ELEMENTO a pantalla completa? En el
   *  iPhone no (allí solo el vídeo), y entonces el botón no se pinta: la
   *  hoja del visor ya ocupa la ventana entera de todos modos. */
  soportada: boolean;
  activa: boolean;
  alternar: () => void;
}

type ConWebkit = {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};

/** Pantalla completa DE VERDAD (la del sistema operativo), sobre el
 *  elemento que se le pase. Con prefijo webkit de respaldo para Safari. */
export function useEduPantallaCompleta(ref: RefObject<HTMLElement | null>): EduPantallaCompleta {
  const [soportada, setSoportada] = useState(false);
  const [activa, setActiva] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const doc = document as Document & ConWebkit;
    setSoportada(Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    const leer = () => setActiva(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    leer();
    document.addEventListener("fullscreenchange", leer);
    document.addEventListener("webkitfullscreenchange", leer);
    return () => {
      document.removeEventListener("fullscreenchange", leer);
      document.removeEventListener("webkitfullscreenchange", leer);
    };
  }, []);

  const alternar = useCallback(() => {
    if (typeof document === "undefined") return;
    const doc = document as Document & ConWebkit;
    const el = ref.current as (HTMLElement & ConWebkit) | null;
    try {
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.exitFullscreen) void doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) void doc.webkitExitFullscreen();
        return;
      }
      if (!el) return;
      if (el.requestFullscreen) void el.requestFullscreen();
      else if (el.webkitRequestFullscreen) void el.webkitRequestFullscreen();
    } catch {
      /* El navegador puede negarse (permisos, iframe). No es motivo para
         romper nada: la hoja del visor ya ocupa la ventana entera. */
    }
  }, [ref]);

  return { soportada, activa, alternar };
}
