// Constantes del flujo 2FA. EDGE-SAFE: solo strings/números, SIN node:crypto,
// otplib, bcrypt ni prisma. El middleware corre en Edge runtime y NO debe
// arrastrar dependencias de Node — por eso importa nombres de cookie desde
// aquí (mismo motivo por el que el admin evita otplib en su verify de Edge).

// Cookie de "2FA superado" en esta ventana. Valor firmado (HMAC) — ver
// two-factor-core. La verifica el LAYOUT del dashboard (Node), no el middleware.
export const TWO_FA_COOKIE = "df_2fa";

// Flag de "login hecho, 2FA aún pendiente". Lo siembra el cierre de login
// (post-login / callback OAuth) y lo lee el middleware como fast-path. Solo
// presencia (sin crypto en Edge); el gate autoritativo vive en el layout.
export const TWO_FA_PENDING_COOKIE = "df_2fa_pending";

// Rutas del flujo dentro de /dashboard. Quedan EXENTAS del gate (si no, loop)
// y se renderizan con layout mínimo (sin sidebar/topbar) para no exponer el
// panel antes de pasar el 2FA.
export const TWO_FA_ROUTE_PREFIX = "/dashboard/2fa";
export const TWO_FA_CHALLENGE_PATH = "/dashboard/2fa";
export const TWO_FA_SETUP_PATH = "/dashboard/2fa/setup";
// ws1-t8 · M2: aviso a los dueños durante la gracia («Activa la verificación
// en dos pasos», con «Recordármelo después»). Bajo el prefijo a propósito:
// layout mínimo y exento del gate, como el reto y el enrolamiento.
export const TWO_FA_AVISO_PATH = "/dashboard/2fa/activar";

// ws1-t8: «Ver como clínica» desde /admin. Prueba firmada (HMAC con un secreto
// DERIVADO, distinto del de df_2fa) de que esta sesión la abrió un admin de
// plataforma con su propio TOTP. Solo la emite /api/admin/impersonate.
export const TWO_FA_ADMIN_COOKIE = "df_2fa_admin";

// ws1-t8 · M2: «Recordármelo después» durante la gracia. No es seguridad (en
// gracia no se bloquea nada), solo evita mostrar el aviso en cada entrada.
export const TWO_FA_POSPUESTO_COOKIE = "df_2fa_luego";
export const TWO_FA_POSPUESTO_MAX_AGE_SECONDS = 60 * 60 * 24;

// ws1-t8 · M2: simulación de la obligación ("gracia" | "vencida") en UN
// navegador. Solo se lee fuera de producción y solo puede endurecer.
export const TWO_FA_SIMULACION_COOKIE = "df_2fa_simular";

// Vigencia de la prueba df_2fa: 12 h. Al expirar, el layout vuelve a exigir
// TOTP aunque la sesión de Supabase siga viva (rolling 30 días). Mismo orden
// de magnitud que la cookie `live` (12 h) y el admin_token (8 h).
export const TWO_FA_OK_MAX_AGE_SECONDS = 60 * 60 * 12;
export const TWO_FA_PENDING_MAX_AGE_SECONDS = 60 * 60 * 12;

// Cantidad de códigos de recuperación generados al activar 2FA.
export const RECOVERY_CODE_COUNT = 10;
