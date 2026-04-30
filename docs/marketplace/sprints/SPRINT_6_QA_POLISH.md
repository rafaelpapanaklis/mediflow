# Sprint 6 — QA + Polish (tests + auditoría + verificación final)

> **Objetivo:** Cerrar el proyecto con tests E2E, auditoría de seguridad, performance y polish visual antes de producción.
>
> **Tiempo estimado:** 1–2 días
>
> **Pre-requisitos:** Sprint 5 ✅ DONE

---

## Contexto del sprint

El sistema funciona, pero antes de soltarlo a clínicas reales hay que verificar que aguante producción. Este sprint cubre tests, performance, seguridad y revisión visual.

---

## Tareas

### Tarea 6.1 — Tests E2E del flujo principal

Si MediFlow ya usa Playwright o Cypress, escribir un test que cubra:

```ts
// tests/e2e/marketplace.spec.ts

test('flujo completo: trial → compra → módulo activo', async ({ page }) => {
  // 1. Registrar clínica nueva (trial 14d activo)
  await registerNewClinic(page, 'test+marketplace@example.com');

  // 2. Verificar TrialBanner morado aparece
  await expect(page.locator('text=/14 días/')).toBeVisible();

  // 3. Ir al marketplace
  await page.goto('/marketplace');
  await expect(page.locator('text=Marketplace de módulos')).toBeVisible();

  // 4. Agregar 3 módulos al carrito
  await page.click('text=Ortodoncia >> button:has-text("Agregar")');
  await page.click('text=Periodoncia >> button:has-text("Agregar")');
  await page.click('text=Endodoncia >> button:has-text("Agregar")');

  // 5. Verificar que aparece "10% activo"
  await expect(page.locator('text=10% activo')).toBeVisible();

  // 6. Ir al checkout
  await page.click('text=/Confirmar y pagar/');

  // 7. Llenar tarjeta de prueba Stripe
  await fillStripeCard(page, '4242424242424242');

  // 8. Confirmar pago
  await page.click('text=/Confirmar y pagar/');

  // 9. Verificar pantalla de éxito
  await expect(page.locator('text=¡Pago confirmado!')).toBeVisible();

  // 10. Verificar que el módulo aparece como "Comprado"
  await page.goto('/marketplace');
  await expect(page.locator('text=Ortodoncia >> text=Ya comprado')).toBeVisible();
});
```

Tests adicionales:

- **Trial expirado sin compras** → ver `ExpiredOverlay`, click → ir a `/marketplace/trial-expired`, ver recomendaciones, comprar → desbloquear
- **Métodos de pago alternativos** → PayPal sandbox y SPEI con confirmación admin
- **Descuentos por volumen** → carritos de 3, 5, 10 módulos verifican porcentajes correctos
- **Acceso bloqueado** → intentar entrar a `/orthodontics` sin tener el módulo comprado y trial expirado → redirige a marketplace

### Tarea 6.2 — Tests de seguridad

Verificar manualmente y/o con tests:

- [ ] Un usuario de Clínica A **no puede** ver `clinic_modules` de Clínica B (probar con cuenta de prueba y curl con cookie)
- [ ] Un usuario sin sesión **no puede** llamar Server Actions del carrito (debe retornar Unauthorized)
- [ ] Los crons **rechazan requests sin** `CRON_SECRET`
- [ ] Webhooks de Stripe/PayPal **rechazan signatures inválidas**
- [ ] No se puede comprar un módulo ya comprado (intentar duplicar `ClinicModule`)
- [ ] No se puede pagar SPEI mensual (zod debe rechazar)
- [ ] El frontend no recibe `stripeSubscriptionId` u otros secrets en respuestas de API
- [ ] Los `Order.totalMxn` calculados en el backend no son alterables desde el frontend

### Tarea 6.3 — Tests fiscales

Casos edge del cálculo:

- [ ] 1 módulo mensual a $329 → final = $381 (subtotal 329 + IVA 52)
- [ ] 3 módulos × $329 mensual con 10% off → 987 - 99 = 888 + 142 IVA = $1,030
- [ ] 5 módulos × $329 anual con 15% off + bonificación
- [ ] 10 módulos × promedio $300 anual → bonificación + 25% off

Validar que los CFDI emitidos tengan los montos exactos que aparecen en el `OrderSummary`.

### Tarea 6.4 — Auditoría de RLS

Para cada tabla nueva, ejecutar en Supabase SQL Editor:

```sql
-- Cambiar a user de prueba
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '<user_id_de_clinica_A>';

-- Intentar leer datos de clínica B
SELECT * FROM clinic_modules WHERE clinic_id = '<clinic_B_id>';
-- Debería retornar 0 rows
```

Documentar los resultados en `PROGRESS.md`.

### Tarea 6.5 — Performance

Revisar con Vercel Analytics o `next dev` con profiling:

- [ ] La página `/marketplace` carga en < 2s
- [ ] El query de Modules + ClinicModules + TrialStatus + Cart no hace N+1
- [ ] Server Actions del carrito responden en < 500ms
- [ ] No hay queries duplicados en logs de Prisma

Si hay queries N+1, agregar `include` o cambiar la estrategia.

### Tarea 6.6 — Auditoría con bug-audit existente

MediFlow tiene un sistema interno de bug-audit con 29 scanners en `/admin/bug-audit`. Ejecutarlos sobre el código nuevo:

- [ ] Revisar que ningún scanner reporte issues nuevos
- [ ] Si un scanner aplica solo al marketplace, agregarlo a la lista

Pregúntale a Rafael cómo correr el bug-audit y qué scanners son los más relevantes.

### Tarea 6.7 — Polish visual

Revisar pantalla por pantalla en producción contra el JSX de referencia:

- [ ] **Marketplace:** spacing, colores, hover states correctos
- [ ] **Detalle:** stats cards alineadas, íconos correctos
- [ ] **Carrito:** OrderSummary sticky funciona en scroll, totales bien formateados
- [ ] **Checkout:** Stripe Elements estilizados consistentes con el resto
- [ ] **Trial Banner:** los 3 estados de urgencia se ven bien (forzar con clínicas de test)
- [ ] **Trial Expired:** hero negro, recomendaciones, CTA sticky funcionan
- [ ] **Mobile:** revisar en viewport ~380px que todo sea usable (Rafael trabaja desde su iPhone a veces)

### Tarea 6.8 — Mobile responsiveness

El JSX está optimizado para desktop. Verificar que en mobile:

- [ ] Sidebar colapsa o se vuelve drawer
- [ ] Grid de módulos pasa a 1 columna en < 768px
- [ ] FloatingCart no tape contenido en mobile
- [ ] Modals son scrolleables si el contenido excede viewport
- [ ] Inputs de tarjeta funcionan con teclado numérico de iOS

Si algo está roto, ajustar con clases `sm:`, `md:`, `lg:` de Tailwind.

### Tarea 6.9 — Documentación final

Crear `docs/marketplace.md` con:

- Descripción general del módulo
- Diagrama de flujo del checkout (puede ser ASCII art o Mermaid)
- Cómo agregar un módulo nuevo (paso a paso: actualizar seed, crear Stripe Price, crear página, etc.)
- Cómo cambiar precios o descuentos
- Cómo manejar reembolsos
- Cómo ver un Order específico desde admin
- Cómo confirmar SPEI manualmente
- Troubleshooting común (webhooks fallan, CFDI rechazado, etc.)

### Tarea 6.10 — Checklist de go-live

Antes de habilitar el marketplace en producción para usuarios reales:

- [ ] Cambiar Stripe de `sk_test_*` a `sk_live_*` en Vercel env
- [ ] Cambiar PayPal de sandbox a live
- [ ] Verificar que FacturAPI esté en modo producción
- [ ] Verificar CLABE bancaria de SPEI (datos reales)
- [ ] Configurar dominio de Postmark (DKIM, SPF)
- [ ] Aprobar templates de WhatsApp Business con Twilio
- [ ] Probar 1 compra real con tarjeta personal
- [ ] Revertir esa compra y verificar que el reembolso fluye bien
- [ ] Configurar alertas en Sentry para errores de Stripe/PayPal/CFDI
- [ ] Documentar en `docs/marketplace.md` los datos de producción

---

## Criterios de "DONE"

✅ Tests E2E del flujo principal pasando
✅ Auditoría de RLS sin issues
✅ Pruebas de seguridad manual sin issues
✅ Performance verificada (< 2s carga marketplace)
✅ bug-audit interno sin findings nuevos
✅ Mobile responsive verificado
✅ `docs/marketplace.md` completo
✅ Checklist de go-live completo (al menos en sandbox/test)
✅ `PROGRESS.md` actualizado con bitácora completa de los 6 sprints

---

## Notas finales

- 🎉 **Esto es la última iteración antes de producción.** Después de este sprint, Rafael decidirá cuándo soltar el marketplace a clínicas reales.

- 🧪 **Recomendación:** correr el sistema con 1–2 clínicas piloto reales (con descuento 100% para ellas) durante 2 semanas antes de cobrar a alguien. Detectar bugs sin riesgo financiero.

- 📊 **Métricas a trackear post-launch** (sugerencia para Rafael):
  - % de clínicas que compran al menos 1 módulo durante el trial
  - % que compran después de expirar el trial (con la pantalla bloqueante)
  - Promedio de módulos por clínica
  - Tasa de uso de cada método de pago
  - Churn (clínicas que cancelan en los primeros 60 días)

---

## Después de terminar

1. Actualiza `PROGRESS.md`:
   - Marca Sprint 6 como ✅ DONE
   - Agrega entrada final en bitácora con resumen del proyecto completo
   - Indica claramente que **el marketplace está listo para producción**

2. Genera un **resumen ejecutivo** para Rafael en `PROGRESS.md` con:
   - Lista de todos los archivos creados/modificados
   - Lista de variables de entorno necesarias
   - Instrucciones de deploy
   - Riesgos conocidos / known issues
   - Próximos pasos sugeridos

3. **DETÉNTE.** El proyecto está completo.

🎉 ¡Felicidades, llegamos al final!
