import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient, verifyState, buscarOCrearCalendarioDeClinica, crearClienteCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { limpiarGoogleCaido } from "@/lib/google-calendar-estado";
import { createClient } from "@/lib/supabase/server";
import { decidirConexionDeClinica, urlDeSaltoAlHostDeLaApp, type MotivoErrorGcal } from "@/lib/google-calendar-callback";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const BASE = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones`;
  const fallo = (motivo: MotivoErrorGcal) => NextResponse.redirect(`${BASE}&gcal=error&motivo=${motivo}`);

  // Google devuelve al host de GOOGLE_REDIRECT_URI; si no es el de la app, ahí
  // no está la cookie de sesión: reenviamos la respuesta al host de la app.
  const salto = urlDeSaltoAlHostDeLaApp({
    hostPeticion: (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim() || null,
    query:        searchParams,
    appUrl:       process.env.NEXT_PUBLIC_APP_URL,
    redirectUri:  process.env.GOOGLE_REDIRECT_URI,
    haySesionAqui: req.cookies.getAll().some((c) => /^sb-.+-auth-token/.test(c.name)),
  });
  if (salto) return NextResponse.redirect(salto);

  if (error) {
    console.error("Google OAuth: Google devolvió error:", error);
    return fallo("denegado");
  }
  if (!code || !state) return fallo("incompleto");

  try {
    // Verify state signature (HMAC) AND que pertenezca a la sesión actual
    const userId = verifyState(state);
    if (!userId) {
      console.error("Google OAuth: invalid state signature");
      return fallo("state");
    }
    const supabase = createClient();
    const { data: { user: sessionUser } } = await supabase.auth.getUser();
    if (!sessionUser) {
      console.error("Google OAuth: no active session for state");
      return fallo("sesion");
    }
    // Una persona tiene una fila de users por clínica (mismo supabaseId): se
    // busca LA fila del state entre las suyas, no la primera que salga.
    const sessionDbUser = await prisma.user.findFirst({
      where: { id: userId, supabaseId: sessionUser.id, isActive: true },
      select: { id: true },
    });
    if (!sessionDbUser) {
      console.error("Google OAuth: state userId does not match session");
      return fallo("otra_cuenta");
    }

    const oauth2Client = getOAuthClient();
    let tokens;
    try {
      ({ tokens } = await oauth2Client.getToken(code));
    } catch (err: any) {
      // `error` de Google (invalid_grant, redirect_uri_mismatch, invalid_client…), sin secretos.
      console.error("Google OAuth: getToken falló:", err?.response?.data?.error ?? err?.message);
      return fallo("token");
    }

    const accessToken  = tokens.access_token  ?? null;
    const refreshToken = tokens.refresh_token ?? null;
    if (!accessToken && !refreshToken) throw new Error("No tokens");
    // Sin refresh token no hay conexión que valga: guardarla con NULL pisaría la buena.
    // (Con access_type=offline + prompt=consent Google siempre lo manda.)
    if (!refreshToken) {
      console.error("Google OAuth: Google no devolvió refresh_token");
      return fallo("token");
    }

    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const parts   = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        email = payload.email ?? null;
      } catch(e) { /* ignore parse error */ }
    }

    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, role: true, clinicId: true, clinic: { select: { name: true, timezone: true, googleRefreshToken: true, googleCalendarEmail: true } } },
    });
    if (!user) throw new Error("User not found");

    const esAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
    // Una clínica = una cuenta de Google. Otra cuenta encima pisaría los tokens y
    // el calendario y dejaría los eventos ya creados fuera de alcance: primero se desconecta.
    // Se decide ANTES de guardar nada (ni siquiera lo del usuario).
    if (esAdmin && decidirConexionDeClinica({
      clinicaYaConectada: !!user.clinic.googleRefreshToken,
      correoDeLaClinica: user.clinic.googleCalendarEmail,
      correoNuevo: email,
    }) === "cuenta_distinta") {
      console.error("Google OAuth: la clínica ya está conectada con otra cuenta de Google");
      return fallo("cuenta_distinta");
    }

    // Update user-level Google Calendar fields
    await prisma.$executeRawUnsafe(
      `UPDATE users SET "googleCalendarToken"=$1,"googleRefreshToken"=$2,"googleCalendarEmail"=$3,"googleCalendarEnabled"=true,"updatedAt"=NOW() WHERE id=$4`,
      accessToken, refreshToken, email, userId
    );

    // If admin/super_admin, also set clinic-level AND create the clinic calendar
    let sinCalendario = false;
    if (esAdmin) {
      // Create or find the clinic's dedicated Google Calendar (marcado con el id de ESTA clínica)
      let clinicCalendarId: string | null = null;
      try {
        const cal = crearClienteCalendar({ accessToken, refreshToken });
        clinicCalendarId = (await buscarOCrearCalendarioDeClinica(cal, {
          clinicId: user.clinicId, clinicName: user.clinic.name, timezone: user.clinic.timezone,
        })).id;
      } catch (err: any) {
        // La conexión se guarda igual (los tokens valen); el aviso dice que falta el calendario.
        // La sincronización lo reintenta con cada cita y, si no hay forma, marca la conexión como caída.
        console.error("Error creating clinic calendar:", err?.response?.data?.error?.message ?? err?.message);
        sinCalendario = true;
      }

      await prisma.$executeRawUnsafe(
        `UPDATE clinics SET "googleCalendarToken"=$1,"googleRefreshToken"=$2,"googleCalendarEmail"=$3,"googleCalendarEnabled"=true,"googleClinicCalendarId"=$4,"updatedAt"=NOW() WHERE id=$5`,
        accessToken, refreshToken, email, clinicCalendarId, user.clinicId
      );
      // Reconectó con permiso nuevo: ya no está «caída» (nunca lanza).
      await limpiarGoogleCaido(user.clinicId);
    }

    if (sinCalendario) return fallo("calendario");
    return NextResponse.redirect(`${BASE}&gcal=success`);
  } catch (err: any) {
    console.error("Google OAuth callback error:", err?.message);
    return fallo("guardar");
  }
}
