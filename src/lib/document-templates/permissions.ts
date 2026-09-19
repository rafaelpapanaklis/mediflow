// Quién ESCRIBE plantillas: doctor o (super)admin, como pidió Rafael.
//
// No se inventó un permiso: `medicalRecord.edit` ya es exactamente ese corte
// (DOCTOR, ADMIN y SUPER_ADMIN lo tienen por defecto; recepción y solo-lectura
// no) y además respeta el override por usuario del modal de Permisos. Una
// plantilla es texto clínico que acaba en el expediente: quien puede escribir
// el expediente puede escribir sus plantillas.
//
// LEER plantillas queda abierto a cualquier sesión de la clínica, igual que el
// catálogo de procedimientos: recepción prepara consentimientos y tiene que
// poder elegir una. El texto de una plantilla no lleva datos de pacientes.

import type { PermissionKey } from "@/lib/auth/permissions";

export const TEMPLATES_WRITE_PERMISSION: PermissionKey = "medicalRecord.edit";
