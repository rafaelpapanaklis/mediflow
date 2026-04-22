/**
 * Logger que extrae solo campos seguros del error.
 * Evita dump del objeto completo (req.body, headers, stack de SQL con PII).
 */
export function logError(context: string, err: unknown) {
  if (err instanceof Error) {
    console.error(context, err.message);
    return;
  }
  if (err && typeof err === "object" && "code" in err) {
    console.error(context, `code=${(err as any).code}`);
    return;
  }
  console.error(context, "unknown error");
}
