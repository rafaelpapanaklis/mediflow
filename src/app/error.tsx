"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LÍMITE DE ERROR DE LA RAÍZ — la última red de toda la aplicación.

   🔴 POR QUÉ: cuando algo lanza durante el render, React sube buscando el
   primer `error.tsx` y desmonta TODO lo que está debajo. Hasta hoy, en
   varias rutas de este repo ese primer límite no existía, así que el punto
   de desmontaje era la RAÍZ: pantalla en blanco completa, sin menú y sin
   forma de moverse. Y en un build de PRODUCCIÓN no hay overlay rojo: la
   consola sale limpia y no queda una sola pista de qué pasó.

   Este archivo es el suelo. Lo ideal sigue siendo que cada sección tenga el
   suyo (así se conserva su layout y solo se sustituye el hueco de la
   página); esto es lo que atrapa lo que se les escape.

   ── NEUTRO A PROPÓSITO ────────────────────────────────────────────
   Lo ven usuarios del panel dental, de barbería y de inmuebles, así que no
   lleva el color ni la voz de ningún vertical. Sin dependencias: estilos en
   línea, sin diccionario y sin componentes compartidos — una pantalla de
   último recurso no puede depender de algo que también puede fallar.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import { ESPERA_RECARGA_MS, asegurarRecarga, seVaARecargar } from "@/lib/recarga-despliegue";

export default function ErrorRaiz({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // ── VERSIÓN VIEJA TRAS UN DESPLIEGUE ──────────────────────────────
  // Si lo que falló fue cargar un fragmento de JS, la pestaña tiene la versión
  // anterior y recargar lo arregla. Se hace UNA vez (guardia en sessionStorage,
  // ver @/lib/recarga-despliegue); si tras recargar sigue fallando, se enseña
  // la tarjeta de siempre. Se decide al pintar para no enseñar un error que va
  // a durar un instante.
  const [seRecarga, setSeRecarga] = useState(() => seVaARecargar(error));
  const pidioRecarga = useRef(false);

  useEffect(() => {
    // El bug que motiva este archivo no dejaba rastro en la consola. Aquí sí.
    console.error("[app] error no capturado por ninguna sección:", error);
    // En desarrollo React corre el efecto dos veces; la segunda encontraría el
    // guardia puesto y tomaría por fallida una recarga que ya está en camino.
    if (pidioRecarga.current) return;
    if (asegurarRecarga(error)) {
      pidioRecarga.current = true;
      // Si en unos segundos la página sigue aquí, la recarga no ocurrió: se
      // enseña la tarjeta, que al menos tiene botones.
      setTimeout(() => setSeRecarga(false), ESPERA_RECARGA_MS);
    } else {
      // 🔴 «Se puede recargar» se decidió LEYENDO el guardia; escribirlo puede
      // fallar aparte (cuota llena, Safari en privado). Sin esto la pantalla se
      // quedaba en «Actualizando…» para siempre, sin recargar y sin botones.
      setSeRecarga(false);
    }
  }, [error]);

  if (seRecarga) {
    return (
      <div
        role="status"
        style={{
          minHeight: "70vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontSize: 15,
          color: "#475569",
          fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
        }}
      >
        Actualizando a la versión más reciente…
      </div>
    );
  }

  return (
    <div
      role="alert"
      style={{
        minHeight: "70vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        color: "#0f172a",
        fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          textAlign: "center",
          background: "#ffffff",
          border: "1px solid rgba(15,23,42,.10)",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 12px 32px -16px rgba(15,23,42,.25)",
        }}
      >
        <strong style={{ display: "block", fontSize: 21, fontWeight: 650, marginBottom: 10 }}>
          No se pudo mostrar esta pantalla
        </strong>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "#475569", margin: "0 0 22px" }}>
          Tu información está a salvo: esto solo afectó a lo que se estaba pintando. Vuelve a
          intentarlo y, si sigue igual, escríbenos desde Soporte con el código de abajo.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: 0,
              padding: "12px 22px",
              borderRadius: 999,
              fontWeight: 650,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Volver a intentarlo
          </button>
          <a
            href="/"
            style={{
              padding: "12px 22px",
              borderRadius: 999,
              fontWeight: 650,
              fontSize: 15,
              color: "#0f172a",
              border: "1px solid rgba(15,23,42,.16)",
              textDecoration: "none",
            }}
          >
            Ir al inicio
          </a>
        </div>
        {error.digest && (
          <p style={{ marginTop: 20, fontSize: 12, color: "#64748b" }}>
            Código para soporte: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
