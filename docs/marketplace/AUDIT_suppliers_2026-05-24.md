# Auditoría — Marketplace de Proveedores B2B

**Fecha:** 2026-05-24 · **Rama:** `audit/suppliers-marketplace` · **Base:** `origin/main @ 29be400`
**Alcance:** 10 tablas `supplier_*`, panel proveedor, compras de clínica, chat, admin, auth, contrato/SQL/RLS.
**Método:** 6 auditorías paralelas (productos, pedidos, compras, chat, auth/admin, contrato/schema) leyendo el código real, consolidadas y verificadas contra el código antes de actuar.

## Veredicto

El módulo está **sólido en lo que más importa**: aislamiento multi-tenant, autorización por capa y la máquina de estados de pedidos. **No hay botones muertos ni crashes.** El hallazgo grave es de **infraestructura, no de código**: la migración del marketplace **no habilitó RLS** en las 10 tablas `supplier_*` (sí lo hizo la migración foundation). Eso, más un endpoint de checkout que no revalidaba el estado del proveedor, son los dos arreglos reales. Varios "P0" reportados por los subagentes eran **falsos positivos** (detallados abajo con su razón).

| Severidad | Reales | Acción |
|-----------|--------|--------|
| **P0** | 1 | RLS faltante → SQL listo, **requiere aplicar en Supabase** |
| **P1** | 2 | 1 arreglado en código (checkout), 1 → SQL (bucket) |
| **P2** | ~10 | Backlog documentado (no bloqueante) |
| **Falsos positivos** | 5 | Revisados, sin acción (con justificación) |

---

## 🔴 P0

### BUG — RLS ausente en las 10 tablas `supplier_*`
`prisma/migrations/20260522120000_supplier_marketplace/migration.sql` — la migración crea las tablas pero **nunca corre `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ni crea policies deny-all**, a diferencia de `20260430140000_marketplace_foundation` (líneas 179–236) y de `sql/rls-deny-all-policies.sql`. Las tablas (pedidos, carritos, mensajes de chat, emails de proveedores) quedan accesibles vía la API REST de Supabase con la `anon`/`authenticated` key que se expone al browser.
**Por qué no rompe la app:** MediFlow accede a estas tablas vía Prisma + service role (bypassa RLS). Habilitar deny-all es transparente para la app.
**Fix:** `sql/supplier-marketplace-rls-and-bucket-hardening.sql` §1 — **PENDIENTE, requiere Rafael** (aplicar en SQL Editor de Supabase).

---

## 🟠 P1

### BUG — Checkout no revalidaba que el proveedor siga APPROVED  ✅ ARREGLADO
`src/app/api/compras/orders/route.ts` (POST) — una clínica que agregaba productos al carrito y luego el proveedor era **suspendido/rechazado** podía igual hacer checkout, generando un pedido a un proveedor que ya no puede atenderlo (su panel exige APPROVED).
**Fix aplicado:** dentro de la transacción se verifica `supplier.status === "APPROVED"`; si no, responde `409` y no crea el pedido.

### MEJORA — Bucket `supplier-products` con escritura abierta a `authenticated`  → SQL
`migration.sql:257–267` — las policies de INSERT/UPDATE/DELETE otorgan acceso al rol `authenticated` validando solo `bucket_id`, no la carpeta dueña. Cualquier usuario autenticado podría escribir/borrar **cualquier** objeto del bucket vía la API de Storage.
**Por qué es seguro endurecerlo:** la app **nunca** usa estas policies — todas las subidas/borrados van por service role (`getAdminSupabase()` en `images/route.ts:82,144` y `[productId]/route.ts:164`). Verificado: no hay subidas client-side a este bucket.
**Fix:** `sql/supplier-marketplace-rls-and-bucket-hardening.sql` §2 (DROP de las 3 policies de escritura, conserva lectura pública) — **PENDIENTE, requiere Rafael**.

---

## 🟡 P2 — Backlog (no bloqueante, no arreglado)

### BUG
| Archivo | Qué | Fix propuesto |
|---------|-----|---------------|
| `chat-workspace.tsx:341` | Optimista al enviar ponía a 0 **ambos** contadores de no-leídos; el servidor solo pone a 0 el del emisor e incrementa el del receptor. Invisible (no se renderiza el lado contrario) y se auto-corrige al siguiente poll. | ✅ **ARREGLADO de paso** — ahora solo pone a 0 el lado propio. |
| `pedidos/[orderId]` + `orders/[id]` | `paymentStatus` alterna UNPAID↔PAID sin guard; se puede marcar pagado/no-pagado un pedido CANCELLED. | Bloquear cambio de pago en pedidos CANCELLED. |

### SIN-CONECTAR
| Archivo | Qué | Fix propuesto |
|---------|-----|---------------|
| `supplier-detail-client.tsx` (addToCart) | Tras "Agregar al carrito" solo hay toast; no hay indicador de cantidad en carrito ni feedback de navegación. | Badge de carrito en el header de compras o redirect opcional. |
| `compras/[orderId]/page.tsx:154` | "Contactar al proveedor" no valida si el proveedor fue suspendido/borrado (links viejos). | Fallback 404 en la ruta de chat. |

### MEJORA
| Archivo | Qué | Fix propuesto |
|---------|-----|---------------|
| `api/proveedores/products/route.ts` | `category`/`unit` no se validan server-side contra `SUPPLIER_CATEGORY_OPTIONS`/lista de unidades (solo el form los limita). | Validar contra el whitelist en POST/PATCH. |
| `compras-client.tsx:135` | Subtotal pre-checkout usa `product.price` vivo; si el precio cambió, difiere de lo mostrado al agregar. El pedido **sí** congela precios correctamente al checkout. | Guardar `unitPrice` en `SupplierCartItem` o refrescar precios al cargar el carrito. |
| `suppliers-client.tsx` / `compras-client.tsx` | Listas estáticas al montar; no refrescan si cambian mientras el usuario navega. | Polling suave o revalidación. |
| `api/supplier-chat/route.ts`, `[threadId]/messages/route.ts` | Sin paginación; mensajes topados a 100 (DESC + reverse). | `limit/offset` o keyset; lazy-load de badges. |
| `api/proveedores/auth/register/route.ts` | Rate-limit in-memory se reinicia en cold start (serverless); mensaje de email revela existencia de cuenta. | Rate-limit con KV/Redis (infra); mensaje genérico (decisión UX). |
| `api/admin/suppliers/[id]/route.ts` | No valida la matriz FROM→TO de transiciones (acepta p.ej. PENDING→SUSPENDED). | Opcional: validar transiciones como el mapa `ACTIONS` del cliente. Admin-only, integridad de datos ya se conserva. |
| `pedidos/page.tsx` | Server component sin skeleton; en red lenta se ve en blanco. | Suspense con skeleton. |
| `lib/supplier-auth.ts` | `getSupplierContext` asume 1 usuario = 1 proveedor (ordena por `createdAt asc`). | Documentar el supuesto o forzar unicidad. |

---

## ✅ Verificado sólido (sin hallazgos)

- **Multi-tenant:** `clinicId`/`supplierId` siempre desde sesión (`getAuthContext`/`getSupplierContext`), nunca del body. Helper `ownItem()` valida dueño del cart item; `loadOwnedThread` autoriza el hilo; cada op de producto valida pertenencia. Una clínica/proveedor **no** puede leer/editar datos de otro adivinando IDs (responde 404).
- **Admin login:** 2FA TOTP (RFC 6238) verificado **server-side**, comparación de password en tiempo constante, cookie `httpOnly`+`secure`.
- **Pedidos (proveedor):** máquina `ORDER_STATUS_FLOW` + `canTransition`; DELIVERED/CANCELLED son terminales; cancelar usa `useConfirm()` (no `window.confirm`).
- **Checkout:** precios y nombres congelados server-side; carrito vaciado en transacción.
- **Imágenes:** máx 8, tipos permitidos + magic number, 10 MB, vía service role, path con `supplierId/productId`.
- **Schema ↔ migración:** **sin drift** (a diferencia de ortho). Las 10 tablas, columnas, índices y FK (incl. `onDelete`) coinciden.
- **Contrato (`types.ts`):** todas las rutas documentadas existen.

---

## ⚪ Falsos positivos de la auditoría (revisados, sin acción)

Los subagentes sobre-calificaron varios hallazgos. Verificados contra el código:

1. **"P0: GET `/api/proveedores/profile` sin gate de status"** — Es el perfil **propio** del proveedor; un PENDING necesita leerlo (flujo `/pendiente`). El PATCH **sí** exige APPROVED+OWNER/MANAGER. Poner gate al GET rompería el flujo pendiente. **No es bug.**
2. **"P0: register sin CSRF"** — Endpoint público no autenticado: CSRF no aporta (no hay sesión de víctima que abusar). Los controles correctos —rate-limit y aprobación admin— ya existen. **No es P0.**
3. **"P1: register acepta stock/price negativos"** — **Mal atribuido**: `register/route.ts` no tiene campos stock/price (esas líneas validan email/password). La validación de productos (`price>=0`, `stock>=0`) **sí** existe en `products/route.ts`.
4. **"P0: admin no limpia `rejectedReason` ni sella `approvedAt`"** — **Falso**: `admin/suppliers/[id]/route.ts:37–38` hace ambas cosas al aprobar.
5. **"P1: `startThread` no protegido para el lado proveedor"** — Solo se invoca en el lado clínica con `initialSupplierId` (mount effect); no es alcanzable desde el panel del proveedor. **Defensivo, no bug.**

---

## Acciones para Rafael (post-merge)

1. **Aplicar `sql/supplier-marketplace-rls-and-bucket-hardening.sql`** en el SQL Editor de Supabase (cierra el P0 de RLS y el P1 del bucket). Idempotente; incluye queries de verificación al final.
2. Tras aplicar, validar con la anon key que las tablas `supplier_*` devuelven 0 filas / niegan escritura.
