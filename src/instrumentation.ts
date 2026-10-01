// Next lo ejecuta una vez al arrancar cada servidor (next start, next dev y
// cada función de Vercel), antes de atender peticiones. En Next 14 necesita
// `experimental.instrumentationHook` en next.config.mjs.
//
// La rama de Node va con import dinámico: el mismo archivo se compila también
// para el runtime edge (rutas OG), donde sharp no existe.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bloquearCargadoresDeSharp } = await import("@/lib/uploads/sharp-bloqueos");
    bloquearCargadoresDeSharp();
  }
}
