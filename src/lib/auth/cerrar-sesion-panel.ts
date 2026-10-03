// «Cerrar sesión» del panel (lo comparten el pie del menú y el menú de dos niveles).
//
// POST al endpoint server: borra cookies httpOnly que el cliente no puede tocar
// (activeClinicId, df_2fa, df_2fa_pending) y hace signOut server-side. Sin esto,
// df_2fa podría sobrevivir al logout y saltarse el reto en el siguiente login
// dentro de su ventana de 12 h. Luego el signOut del navegador, por si acaso.
//
// ws1-t11: dentro de «Ver como clínica» el servidor NO deja el navegador sin
// sesión: vuelve a la que tenía antes de entrar (la del propio admin en su
// clínica) y manda a /admin. Ahí el signOut del navegador —que es "global"—
// revocaría ESA sesión recién devuelta, así que se salta.

/** ¿La respuesta del logout terminó en /admin (salida de «Ver como clínica»)? */
export function volvioDeVerComo(r: { redirected: boolean; url: string } | null): boolean {
  if (!r || !r.redirected || !r.url) return false;
  try {
    return new URL(r.url).pathname.startsWith("/admin");
  } catch {
    return false;
  }
}

export async function cerrarSesionPanel(origen = "panel"): Promise<void> {
  let destino = "/login";
  try {
    let r: Response | null = null;
    try { r = await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    if (volvioDeVerComo(r)) {
      destino = r!.url;
      return;
    }
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signOut();
  } catch (err) {
    console.error(`[${origen}] logout failed`, err);
  } finally {
    window.location.href = destino;
  }
}
