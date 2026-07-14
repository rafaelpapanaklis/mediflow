import type { CSSProperties, ReactNode } from "react";

/**
 * Marco de "ventana de navegador" de los mockups del reference: 3 puntos de
 * semáforo + pill con la URL + slot opcional a la derecha. Decorativo.
 * `stretch` = la ventana llena la altura de su contenedor flex (los 3 mockups
 * del trío se estiran a la MISMA altura, CAMBIOS §1).
 */
export function BrowserFrame({
  url,
  right,
  children,
  shadow = "0 18px 44px rgba(15,23,42,.10)",
  small = false,
  stretch = false,
}: {
  url: string;
  right?: ReactNode;
  children: ReactNode;
  shadow?: string;
  small?: boolean;
  stretch?: boolean;
}) {
  const dot: CSSProperties = { width: small ? 8 : 9, height: small ? 8 : 9, borderRadius: "50%" };
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: small ? 14 : 16, boxShadow: shadow, overflow: "hidden", ...(stretch ? { flex: 1, display: "flex", flexDirection: "column" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: small ? 6 : 7, padding: small ? "8px 12px" : "9px 14px", borderBottom: "1px solid #eef2f7", background: "#f8fafc" }}>
        <span style={{ ...dot, background: "#fca5a5" }} />
        <span style={{ ...dot, background: "#fcd34d" }} />
        <span style={{ ...dot, background: "#86efac" }} />
        <span style={{ marginLeft: small ? 6 : 8, fontSize: small ? 10 : 11, color: "#94a3b8", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: small ? "2px 9px" : "2px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {url}
        </span>
        {right}
      </div>
      {stretch ? <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>{children}</div> : children}
    </div>
  );
}
