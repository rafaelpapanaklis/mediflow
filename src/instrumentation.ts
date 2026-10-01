// Next lo ejecuta una vez al arrancar cada servidor (next start, next dev y
// cada función de Vercel), antes de atender peticiones. En Next 14 necesita
// `experimental.instrumentationHook` en next.config.mjs.
//
// La rama de Node va con import dinámico: el mismo archivo se compila también
// para el runtime edge (rutas OG), donde sharp no existe.
//
// Nada de aquí puede tumbar el arranque: Next 14 vuelve a lanzar cualquier error
// de register() que no sea MODULE_NOT_FOUND, y esa función respondería 500 a
// todo (webhooks incluidos). Si sharp no cargara, se sigue sin el bloqueo y
// queda en el log (ws1-t12, auditoría de integraciones del 1-oct-2026).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { bloquearCargadoresDeSharp } = await import("@/lib/uploads/sharp-bloqueos");
      bloquearCargadoresDeSharp();
    } catch (e) {
      console.error("[instrumentation] no se pudieron bloquear los cargadores de sharp:", e);
    }
  }
}
