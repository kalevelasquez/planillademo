import { test, expect } from '@playwright/test';
import { loginAs } from './fixtures/auth';

/**
 * Smoke de login por rol — no crea datos, solo confirma que cada cuenta de test entra
 * y llega a un dashboard acorde a su rol (US-QNA-00).
 */
test.describe('Login por rol', () => {
    test('el Admin puede loguearse y llega al dashboard', async ({ page }) => {
        await loginAs(page, 'admin');
        await expect(page).toHaveURL(/\/$/);
    });

    test('el Aprobador puede loguearse y llega a la Revisión de Quincena', async ({ page }) => {
        await loginAs(page, 'aprobador');
        await page.goto('/planilla');
        await expect(page.getByRole('heading', { name: 'Revisión de Quincena' })).toBeVisible();
    });
});
