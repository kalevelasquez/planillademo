import { test, expect } from '@playwright/test';
import { loginAs } from './fixtures/auth';

/**
 * IMPL-2 — Panel de Indicadores y Listado de Empleados. Spec de solo lectura (sin
 * creación de datos), no necesita limpieza al final.
 */
test.describe('Empleados — Listado e Indicadores (IMPL-2)', () => {
    test('el Preparador puede ver el listado de empleados con sus indicadores', async ({ page }) => {
        await loginAs(page, 'preparador');
        await page.goto('/planilla/empleados');

        await expect(page.getByRole('heading', { name: 'Gestión de Empleados' })).toBeVisible();
        await expect(page.getByText('Total', { exact: true })).toBeVisible();
        await expect(page.getByText('Activos', { exact: true })).toBeVisible();
    });
});

/**
 * Auditoría crítica, 7ª pasada — hallazgo menor: el filtro de búsqueda se perdía al volver
 * del detalle de un empleado (estado local, nunca releído del store al remontar la lista).
 * Spec de solo lectura (no crea datos, no necesita limpieza).
 */
test.describe('Empleados — el filtro de búsqueda sobrevive a navegar al detalle y volver', () => {
    test('el texto buscado sigue en el input después de abrir un empleado y volver', async ({ page }) => {
        await loginAs(page, 'preparador');
        await page.goto('/planilla/empleados');

        const searchBox = page.getByPlaceholder('Buscar por nombre, cargo, departamento o código...');
        await searchBox.fill('a');
        await page.waitForTimeout(500); // debounce de 300ms + margen para que la tabla se re-renderice

        const primeraFila = page.getByRole('row').nth(1);
        await expect(primeraFila).toBeVisible();
        await primeraFila.click();

        await expect(page).toHaveURL(/\/planilla\/empleados\/[^/]+$/);

        await page.getByRole('link', { name: 'Empleados' }).click();
        await expect(page).toHaveURL(/\/planilla\/empleados$/);

        await expect(page.getByPlaceholder('Buscar por nombre, cargo, departamento o código...')).toHaveValue('a');
    });
});
