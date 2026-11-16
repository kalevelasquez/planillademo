import { test, expect } from '@playwright/test';
import { loginAs } from './fixtures/auth';

/**
 * Auditoría crítica, 7ª pasada — hallazgo cosmético: 6 de 9 catálogos de Configuración
 * tenían el header "Estado" y los textos de estado vacío hardcodeados sin pasar por `t()`,
 * rompiendo el locale en inglés. Spec de solo lectura (no crea datos, no necesita limpieza).
 */
test.describe('Configuración — catálogos con i18n completo', () => {
    test('Bancos muestra el header de columna "Estado" traducido', async ({ page }) => {
        await loginAs(page, 'admin');
        await page.goto('/planilla/configuracion/bancos');

        await expect(page.getByRole('columnheader', { name: 'Estado' })).toBeVisible();
    });
});
