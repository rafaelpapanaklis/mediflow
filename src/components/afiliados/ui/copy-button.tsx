"use client";

/**
 * Panel de afiliado — COPIAR AL PORTAPAPELES.
 *
 * Tres afordancias del diseño sobre la misma lógica: el botón lleno
 * ("Copiar" del link corto), el botón cuadrado de icono (los dos enlaces
 * secundarios) y el botón-código de la cabecera ("CÓDIGO W64W6PKH ⧉").
 *
 * `navigator.clipboard` no existe en contexto inseguro ni en algunos
 * navegadores in-app (el de Facebook, que es justo donde muchos afiliados
 * abren su panel): se conserva el respaldo con <textarea> + execCommand que
 * traía el diseño. Sin él, copiar el link fallaría en silencio precisamente
 * para quien más lo usa.
 */
import type { ReactNode } from "react";
import { showPanelToast } from "./panel-toast";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Cae al respaldo de abajo.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function run(text: string, okMsg: string) {
  const ok = await copyText(text);
  showPanelToast(ok ? okMsg : "No se pudo copiar");
}

const COPY_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
    <path d="M15.5 4.5H7A2.5 2.5 0 0 0 4.5 7v8.5" />
  </svg>
);

/** Botón con texto. `variant` sigue las clases de panel.css. */
export function CopyButton({
  text,
  toast,
  label = "Copiar",
  ariaLabel,
  variant = "primary",
  block,
}: {
  text: string;
  toast: string;
  label?: ReactNode;
  ariaLabel: string;
  variant?: "primary" | "outline" | "default";
  block?: boolean;
}) {
  const cls = [
    "dcafp-btn",
    variant === "primary" ? "dcafp-btn--primary" : "",
    variant === "outline" ? "dcafp-btn--outline" : "",
    block ? "dcafp-btn--block" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={cls} aria-label={ariaLabel} onClick={() => run(text, toast)}>
      {COPY_ICON}
      {label}
    </button>
  );
}

/** Botón cuadrado de 44px, solo icono. */
export function CopyIconButton({
  text,
  toast,
  ariaLabel,
}: {
  text: string;
  toast: string;
  ariaLabel: string;
}) {
  return (
    <button type="button" className="dcafp-iconbtn" aria-label={ariaLabel} onClick={() => run(text, toast)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
        <path d="M15.5 4.5H7A2.5 2.5 0 0 0 4.5 7v8.5" />
      </svg>
    </button>
  );
}

/** El botón-código de la cabecera de enlaces: etiqueta + valor monoespaciado. */
export function CopyCodeButton({
  code,
  toast = "Código copiado",
  kicker = "CÓDIGO",
}: {
  code: string;
  toast?: string;
  kicker?: string;
}) {
  return (
    <button
      type="button"
      className="dcafp-codebtn"
      aria-label={`Copiar código de referido ${code}`}
      onClick={() => run(code, toast)}
    >
      <span className="dcafp-codebtn__k">{kicker}</span>
      <span className="dcafp-codebtn__v">{code}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: "var(--dcafp-ink-3)" }}>
        <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
        <path d="M15.5 4.5H7A2.5 2.5 0 0 0 4.5 7v8.5" />
      </svg>
    </button>
  );
}
