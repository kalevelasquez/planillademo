import { test, expect } from '@playwright/test';

/**
 * Tienda publica (F1): landing, catalogo y frontera con el shell admin. Todo anon: no necesita
 * credenciales ni crea datos.
 *
 * El catalogo depende de `VITE_STORE_TENANT_ID` y de `tenants.store_enabled` del entorno bajo
 * prueba. Para no acoplar el spec a ese dato, el catalogo se acepta en cualquiera de sus tres
 * estados validos (productos, vacio, "no disponible"); lo que NUNCA debe pasar es una pantalla en
 * blanco o un error de pagina.
 */
test.describe('Tienda publica (anon)', () => {
    test('la landing en "/" se ve sin redirigir a login y ofrece el CTA al catalogo', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (e) => pageErrors.push(e));

        await page.goto('/');

        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Cómo pedir' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Contacto comercial' })).toBeVisible();
        expect(pageErrors).toEqual([]);

        await page.getByRole('link', { name: 'Ver catálogo' }).first().click();
        await expect(page).toHaveURL(/\/tienda$/);
    });

    test('la landing no ofrece registro ni pedido todavia (F2)', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Próximamente').first()).toBeVisible();
        await expect(page.getByRole('link', { name: /crear cuenta|registr/i })).toHaveCount(0);
    });

    test('el catalogo carga en uno de sus estados validos y nunca muestra cantidades', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (e) => pageErrors.push(e));

        await page.goto('/tienda');

        await expect(page.getByRole('heading', { level: 1, name: /Catálogo/ })).toBeVisible();
        const settled = page
            .getByRole('list', { name: 'Catálogo' })
            .or(page.getByText('No hay productos disponibles por el momento.'))
            .or(page.getByRole('heading', { name: 'Catálogo no disponible' }));
        await expect(settled).toBeVisible();

        // Solo se ofrece Disponible/Agotado: ningun texto del estilo "37 unidades / stock".
        await expect(page.getByText(/unidades|stock|existencias/i)).toHaveCount(0);
        expect(pageErrors).toEqual([]);
    });

    test('el acceso de empleados del footer lleva a /login', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('link', { name: 'Acceso empleados' }).click();
        await expect(page).toHaveURL(/\/login$/);
    });
});

test.describe('Frontera con el shell admin (anon)', () => {
    test('anon en /inicio es redirigido a /login', async ({ page }) => {
        await page.goto('/inicio');
        await expect(page).toHaveURL(/\/login/);
    });

    test('anon en otra ruta admin (/inventario) tambien va a /login', async ({ page }) => {
        await page.goto('/inventario');
        await expect(page).toHaveURL(/\/login/);
    });
});
