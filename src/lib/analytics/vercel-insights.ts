// C-129 (ws1-t8): `<Analytics />` y `<SpeedInsights />` piden
// `/_vercel/insights/script.js` y `/_vercel/speed-insights/script.js`, que solo
// existen cuando la app la sirve Vercel. Fuera de ahí (el panel de pruebas del
// servidor, `next start` local) daban dos 404 en la consola de cada pantalla.
// Vercel pone `VERCEL=1` y `VERCEL_URL` (la dirección del despliegue) en el
// build y en la ejecución. `VERCEL=1` solo no basta: un `.env` bajado con
// `vercel env pull` (el del panel de pruebas) lo trae, pero con `VERCEL_URL=""`.

export function cargarInsightsDeVercel(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL === "1" && Boolean(env.VERCEL_URL);
}
