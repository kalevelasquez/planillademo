import { test, expect } from '@playwright/test';
import { loginAs } from './fixtures/auth';

/**
 * Auditoría crítica, 7ª pasada — hallazgo cosmético: "Exportar PDF" imprimía todo el chrome
 * de la app (sidebar, navbar, filtros) porque no existía ningún CSS de impresión. Se agregó
 * `print:hidden` al sidebar/navbar (MainLayout/Navbar) y a los controles de la propia vista.
 * Spec de solo lectura (no crea datos, no necesita limpieza).
 */
test.describe('Cálculo de Planilla — CSS de impresión oculta el chrome de la app', () => {
    test('el sidebar y el navbar quedan ocultos en vista previa de impresión', async ({ page }) => {
        await loginAs(page, 'preparador');
        await page.goto('/planilla/calculo');

        const titulo = page.getByRole('heading', { name: 'Cálculo de Planilla' });
        await expect(titulo).toBeVisible();

        await page.emulateMedia({ media: 'print' });

        await expect(titulo).toBeVisible(); // el título del layout compartido no está en print:hidden

        const sidebarDesktop = page.locator('aside');
        if (await sidebarDesktop.count() > 0) {
            await expect(sidebarDesktop.first()).toBeHidden();
        }

        const navbar = page.locator('nav').filter({ has: page.getByRole('button', { name: /user menu/i }) });
        if (await navbar.count() > 0) {
            await expect(navbar.first()).toBeHidden();
        }

        await page.emulateMedia({ media: 'screen' });
    });
});
