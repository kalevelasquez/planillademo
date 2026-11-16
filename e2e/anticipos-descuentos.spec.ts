import { test, expect } from '@playwright/test';
import { loginAs } from './fixtures/auth';

/**
 * Reversión de un cambio de la 6ª pasada de auditoría: el selector de quincena del header
 * se había ocultado en Anticipos/Descuentos por "inerte". Ahora vuelve a mostrarse y filtra
 * los indicadores/estado por fila que se ven — "Procesar Cuotas"/"Suspender" siguen operando
 * siempre sobre la quincena activa real, sin importar cuál se esté viendo (ver PlanillaLayout.tsx).
 * Spec de solo lectura (no crea datos, no necesita limpieza).
 */
test.describe('Anticipos/Descuentos — el selector de quincena del header vuelve a mostrarse', () => {
    test('Anticipos muestra el selector de quincena en el título, igual que las demás pantallas', async ({ page }) => {
        await loginAs(page, 'preparador');
        await page.goto('/planilla/anticipos');

        // Excluye "Procesar cuotas de {quincena}" — también matchea /quincena/i por su label.
        const selector = page.getByRole('button', { name: /quincena/i }).filter({ hasNotText: 'Procesar' });
        await expect(selector).toBeVisible();
        await selector.click();
        await expect(page.getByText('Seleccionar Quincena')).toBeVisible();
    });

    test('Descuentos muestra el selector de quincena en el título, igual que las demás pantallas', async ({ page }) => {
        await loginAs(page, 'preparador');
        await page.goto('/planilla/descuentos');

        // Excluye "Procesar cuotas de {quincena}" — también matchea /quincena/i por su label.
        const selector = page.getByRole('button', { name: /quincena/i }).filter({ hasNotText: 'Procesar' });
        await expect(selector).toBeVisible();
        await selector.click();
        await expect(page.getByText('Seleccionar Quincena')).toBeVisible();
    });
});
