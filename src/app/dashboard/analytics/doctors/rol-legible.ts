// El rol como lo lee una persona: «Dueño/a», «Doctor/a»… y no `SUPER_ADMIN`.
// Un rol que no se conozca sale como está escrito en la base, nunca vacío.
const LLAVES: Record<string, string> = {
  SUPER_ADMIN: "analytics.doctors.roleOwner",
  ADMIN: "analytics.doctors.roleAdmin",
  DOCTOR: "analytics.doctors.roleDoctor",
  RECEPTIONIST: "analytics.doctors.roleReceptionist",
  READONLY: "analytics.doctors.roleReadonly",
};

export function rolLegible(role: string, t: (key: string) => string): string {
  const llave = LLAVES[role];
  return llave ? t(llave) : role;
}
