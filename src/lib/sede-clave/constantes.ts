// ws1-t4 · «Clave de la sede» — constantes que también lee el cliente (el
// selector de sedes, la pantalla de la clave, la tarjeta de Seguridad). Solo
// strings y números: sin node:crypto ni prisma, para que entren en un
// componente "use client".

/** Largo mínimo de la clave (lo pidió Rafael). */
export const CLAVE_MIN = 6;
/** bcrypt solo mira los primeros 72 bytes: más largo engañaría a quien la pone. */
export const CLAVE_MAX = 72;
/** La pantalla «Esta sede tiene clave». */
export const RUTA_SEDE_CON_CLAVE = "/dashboard/sede-con-clave";
/** Código del 423 de /api/switch-clinic y de los 4xx de /api/sede-clave. */
export const CODIGO_SEDE_CON_CLAVE = "sede_con_clave";
/** Status con el que /api/switch-clinic dice «esa sede pide clave». */
export const STATUS_SEDE_CON_CLAVE = 423;
