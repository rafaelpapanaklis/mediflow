"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { Printer } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import {
  PRINT_LOGO_KEY,
  PRINT_PAGE_STYLE_ID,
  PRINT_WIDTH_KEY,
  printWidthClass,
  readPrintWidth,
  thermalPageCss,
  type PrintWidth,
} from "./print-width";

function leer(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function guardar(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* navegador sin almacenamiento: se queda solo para esta vista */
  }
}

/**
 * Ancho de impresión recordado en el navegador. Arranca en «carta» para que el
 * primer pintado sea igual en el servidor y en el navegador; luego lee lo
 * guardado.
 */
export function usePrintSetup() {
  const [width, setWidthState] = useState<PrintWidth>("letter");
  const [logo, setLogoState] = useState(true);
  useEffect(() => {
    setWidthState(readPrintWidth(leer(PRINT_WIDTH_KEY)));
    setLogoState(leer(PRINT_LOGO_KEY) !== "0");
  }, []);
  const setWidth = useCallback((w: PrintWidth) => {
    setWidthState(w);
    guardar(PRINT_WIDTH_KEY, w);
  }, []);
  const setLogo = useCallback((v: boolean) => {
    setLogoState(v);
    guardar(PRINT_LOGO_KEY, v ? "1" : "0");
  }, []);
  return { width, setWidth, logo, setLogo, className: printWidthClass(width) };
}

/**
 * Imprime con la página del ancho elegido: mide el ticket ya pintado a ese
 * ancho y pone (o quita) la regla @page antes de abrir el diálogo.
 */
export function printWithWidth(width: PrintWidth, ticket: RefObject<HTMLElement | null>): void {
  const css = thermalPageCss(width, ticket.current?.getBoundingClientRect().height ?? 0);
  let tag = document.getElementById(PRINT_PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    tag?.remove();
  } else {
    if (!tag) {
      tag = document.createElement("style");
      tag.id = PRINT_PAGE_STYLE_ID;
      document.head.appendChild(tag);
    }
    tag.textContent = css;
  }
  window.print();
}

/** Selector de impresora + logo + botón «Imprimir» (va en la barra de acciones, que no se imprime). */
export function PrintSetupControls({
  t,
  width,
  setWidth,
  logo,
  setLogo,
  withLogo,
  onPrint,
}: {
  t: TFunction;
  width: PrintWidth;
  setWidth: (w: PrintWidth) => void;
  logo: boolean;
  setLogo: (v: boolean) => void;
  /** La barbería tiene logo (si no, no se ofrece la casilla). */
  withLogo: boolean;
  onPrint: () => void;
}) {
  return (
    <>
      <label className="bcaja-print-setup">
        <span>{t("print.printer")}</span>
        <select className="input-new" value={width} onChange={(e) => setWidth(readPrintWidth(e.target.value))} aria-label={t("print.printer")}>
          <option value="letter">{t("print.widthLetter")}</option>
          <option value="80">{t("print.width80")}</option>
          <option value="58">{t("print.width58")}</option>
        </select>
      </label>
      {withLogo && width !== "letter" ? (
        <label className="bcaja-print-setup">
          <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} />
          <span>{t("print.withLogo")}</span>
        </label>
      ) : null}
      <button type="button" className="btn-new barber-btn-primary" onClick={onPrint}>
        <Printer size={14} /> {t("common.print")}
      </button>
    </>
  );
}
