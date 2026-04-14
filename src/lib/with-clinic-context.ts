import { clinicContextStorage, type ClinicContext } from "@/lib/clinic-context";
import type { AuthContext } from "@/lib/auth-context";

/**
 * Ejecuta un callback dentro del contexto de una clínica específica.
 * Todas las queries de Prisma dentro del callback automáticamente
 * setearán la variable de sesión app.current_clinic_id para que
 * las policies de RLS filtren por esa clínica.
 *
 * Uso típico en una API route:
 *
 *   const ctx = await getAuthContext();
 *   if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   return withClinicContext(ctx, async () => {
 *     const patients = await prisma.patient.findMany();
 *     return NextResponse.json(patients);
 *   });
 */
export function withClinicContext<T>(
  auth: AuthContext,
  callback: () => Promise<T>
): Promise<T> {
  const context: ClinicContext = {
    clinicId: auth.clinicId,
    userId:   auth.userId,
    role:     auth.role,
  };
  return clinicContextStorage.run(context, callback);
}

/**
 * Variante de bajo nivel para casos donde no tienes AuthContext.
 * Útil en webhooks o crons cuando ya validaste a qué clínica pertenece el request.
 */
export function withClinicId<T>(
  clinicId: string,
  callback: () => Promise<T>
): Promise<T> {
  return clinicContextStorage.run({ clinicId }, callback);
}
