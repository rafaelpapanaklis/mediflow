// Equipo — los textos que ws1-t2 (revisión final, 28-sep-2026) cambió o estrenó.
//
// Viven aquí y no en los diccionarios a propósito, igual que en
// campo-acceso-ortodoncia.tsx: los diccionarios los toca a la vez la pantalla del
// importador y un commit de esos archivos arrastraría sus líneas. Lo que no
// cambió sigue saliendo de `settings.team.*`.
//
// Regla de redacción: "miembro" / "recepción", nunca "doctor" cuando el texto
// vale para cualquier rol (la pantalla da de alta también a recepción y admins).

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  // Alta
  agregarMiembro: "Agregar miembro",
  altaIntro: "Se crea su cuenta al instante y verás una contraseña temporal para entregársela. No se envía ninguna invitación por correo.",
  emailHintAlta: "Es el correo con el que inicia sesión. La contraseña temporal aparece al crear la cuenta.",
  crearCuenta: "Crear cuenta",
  altaListo: (nombre: string) => `Cuenta de ${nombre} creada`,
  tempCreadaTitulo: "Cuenta creada — contraseña temporal",
  tempCreadaDesc: (nombre: string) =>
    `Entrégasela a ${nombre} por un canal seguro. Solo se muestra una vez. Podrá cambiarla en Configuración → Seguridad.`,
  // Restablecer contraseña
  restablecerBtn: "Restablecer contraseña",
  restablecerHint: "Restablecer genera una contraseña temporal nueva. La actual deja de funcionar al instante.",
  restablecerConfirmTitulo: (nombre: string) => `¿Restablecer la contraseña de ${nombre}?`,
  restablecerConfirmDesc:
    "Se genera una contraseña temporal nueva. La actual deja de funcionar al instante. Tendrás que entregársela por un canal seguro: solo se muestra una vez.",
  restablecerError: "No se pudo restablecer la contraseña",
  restablecerNoSuper: "No se puede restablecer la contraseña de un SUPER_ADMIN",
  restablecerListo: (nombre: string) => `Contraseña restablecida para ${nombre}`,
  tempResetTitulo: (nombre: string) => `Contraseña restablecida — ${nombre}`,
  tempResetDesc:
    "Entrégala por un canal seguro. La anterior ya no funciona. Solo se muestra una vez: si la pierdes, hay que restablecerla de nuevo.",
  tempListo: "Listo, ya la copié",
  copiar: "Copiar",
  copiado: "Copiado",
  // Activar / desactivar / eliminar
  desactivarBtn: "Desactivar",
  reactivarBtn: "Reactivar",
  eliminarBtn: "Eliminar",
  desactivarConfirmTitulo: (nombre: string) => `¿Desactivar a ${nombre}?`,
  desactivarConfirmDesc:
    "Dejará de poder iniciar sesión y de aparecer al agendar. Sus citas y expedientes se conservan y puedes reactivar la cuenta cuando quieras.",
  miembroDesactivado: "Miembro desactivado",
  miembroReactivado: "Miembro reactivado",
  miembroEliminado: "Miembro eliminado",
  desactivadoConRegistros: "Desactivado en lugar de eliminado: tiene citas o registros",
  // Edición
  sinCambios: "No hay cambios que guardar",
};

const en: typeof es = {
  agregarMiembro: "Add member",
  altaIntro: "Their account is created instantly and you'll get a temporary password to hand over. No invitation email is sent.",
  emailHintAlta: "This is the email they sign in with. The temporary password appears when the account is created.",
  crearCuenta: "Create account",
  altaListo: (nombre) => `Account created for ${nombre}`,
  tempCreadaTitulo: "Account created — temporary password",
  tempCreadaDesc: (nombre) =>
    `Give it to ${nombre} through a secure channel. It is shown only once. They can change it in Settings → Security.`,
  restablecerBtn: "Reset password",
  restablecerHint: "Resetting generates a new temporary password. The current one stops working instantly.",
  restablecerConfirmTitulo: (nombre) => `Reset the password for ${nombre}?`,
  restablecerConfirmDesc:
    "A new temporary password is generated. The current one stops working instantly. You must hand it over through a secure channel: it is shown only once.",
  restablecerError: "Could not reset the password",
  restablecerNoSuper: "Cannot reset the password of a SUPER_ADMIN",
  restablecerListo: (nombre) => `Password reset for ${nombre}`,
  tempResetTitulo: (nombre) => `Password reset — ${nombre}`,
  tempResetDesc:
    "Hand it over through a secure channel. The previous one no longer works. It is shown only once: if you lose it, reset it again.",
  tempListo: "Done, I copied it",
  copiar: "Copy",
  copiado: "Copied",
  desactivarBtn: "Deactivate",
  reactivarBtn: "Reactivate",
  eliminarBtn: "Delete",
  desactivarConfirmTitulo: (nombre) => `Deactivate ${nombre}?`,
  desactivarConfirmDesc:
    "They will no longer be able to sign in or appear when scheduling. Their appointments and records are kept, and you can reactivate them any time.",
  miembroDesactivado: "Member deactivated",
  miembroReactivado: "Member reactivated",
  miembroEliminado: "Member deleted",
  desactivadoConRegistros: "Deactivated instead of deleted: they have appointments or records",
  sinCambios: "There are no changes to save",
};

export const TEXTOS_EQUIPO = { es, en } as const;
export type TextosEquipo = typeof es;

export function useTextosEquipo(): TextosEquipo {
  return useLocale().startsWith("en") ? en : es;
}
