"use client";

/* ═══════════════════════════════════════════════════════════════════════
   🔴 H-157 · EL LÍMITE DE ERROR QUE ATRAPA LO QUE LANZA EL LAYOUT DEL
   PANEL.

   Hasta esta ola el único `error.tsx` del vertical era el del grupo
   `(panel)`, y por la regla de Next un `error.tsx` **no atrapa lo que
   lanza su PROPIO layout**: sube al límite de arriba. Como no había
   ninguno bajo `/instituto`, ese "arriba" era la RAÍZ del monorepo, cuyo
   único escape rotulado es la portada comercial del producto dental. Una
   docente cuyo layout revienta —y ese layout resuelve sesión, permisos,
   navegación y ALCANCE POR SEDE, así que tiene de dónde reventar— se
   quedaba mirando una pantalla de otro producto con un botón que la sacaba
   del instituto.

   Este archivo es ese "arriba". Cubre:
     · lo que lance `(panel)/layout.tsx` — sesión, permisos, sedes;
     · lo que lance el login, el cambio de contraseña, la carta pública y
       el 404 del vertical, que viven fuera del grupo y no tenían ninguno.

   El `(panel)/error.tsx` SIGUE existiendo y sigue siendo el bueno para el
   caso normal: cuando falla una PANTALLA, él sustituye solo el hueco y el
   menú se queda pintado. Éste es el de más afuera — el que se ve cuando ya
   no hay menú que dejar en pie.

   ── SIN DEPENDENCIAS, A PROPÓSITO ────────────────────────────────────
   Ni hoja de estilos del vertical, ni componentes, ni iconos: los estilos
   van en línea y el texto en español. Una pantalla de último recurso que
   depende de algo que también puede fallar no es una pantalla de último
   recurso. (Es la misma decisión, escrita igual, que el error.tsx del
   grupo.)

   Y en un build de PRODUCCIÓN no hay overlay rojo: la consola de quien lo
   sufre sale limpia, sin una sola pista. Por eso el useEffect escribe el
   error a mano.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";

export default function ErrorInstitutoRaiz({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[instituto] falló el armazón del vertical (layout o pantalla suelta):", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "#F5F7FB",
        fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: "100%",
          padding: 26,
          borderRadius: 14,
          border: "1px solid rgba(20,26,43,.12)",
          background: "#FFFFFF",
          color: "#141A2B",
          textAlign: "center",
        }}
      >
        <strong style={{ display: "block", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
          El instituto no se pudo abrir
        </strong>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "#4A5468", margin: "0 0 20px" }}>
          Los datos de tu escuela siguen exactamente donde estaban: esto falló al ARMAR la
          pantalla, no al guardar nada. Vuelve a intentarlo y, si sigue igual, avísale a la
          dirección con el código de abajo.
        </p>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}
        >
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#344E8C",
              color: "#fff",
              border: 0,
              padding: "13px 24px",
              borderRadius: 999,
              fontWeight: 650,
              fontSize: 15,
              minHeight: 46,
              cursor: "pointer",
            }}
          >
            Volver a intentarlo
          </button>
          {/* 🔴 La salida es del INSTITUTO y a su propia puerta. El escape
              del boundary de raíz lleva a la portada comercial del producto
              dental, que es justo lo que este archivo viene a evitar. Es un
              <a> y no un <Link>: si lo que falló fue el armazón, una
              navegación del router puede volver a fallar; ésta recarga. */}
          <a
            href="/instituto/login"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              color: "#2A3F70",
              border: "1px solid rgba(20,26,43,.2)",
              padding: "13px 24px",
              borderRadius: 999,
              fontWeight: 650,
              fontSize: 15,
              minHeight: 46,
              textDecoration: "none",
            }}
          >
            Ir a la entrada del instituto
          </a>
        </div>
        {error.digest && (
          <p style={{ marginTop: 18, fontSize: 12, color: "#67707F" }}>
            Código para soporte: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
