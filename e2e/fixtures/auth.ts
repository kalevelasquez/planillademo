import { type Page, expect } from '@playwright/test';

export type E2ERole = 'admin' | 'preparador' | 'aprobador';

interface Credentials {
    email: string;
    password: string;
}

function credentialsFor(role: E2ERole): Credentials {
    const prefix = `E2E_${role.toUpperCase()}`;
    const email = process.env[`${prefix}_EMAIL`];
    const password = process.env[`${prefix}_PASSWORD`];
    if (!email || !password) {
        throw new Error(
            `Faltan credenciales de test para el rol "${role}" — definí ${prefix}_EMAIL y ${prefix}_PASSWORD en .env.e2e.local (ver e2e/e2e.env.example). Esas cuentas deben existir de antemano en el Supabase de develop.`
        );
    }
    return { email, password };
}

export async function loginAs(page: Page, role: E2ERole): Promise<void> {
    const { email, password } = credentialsFor(role);
    await page.goto('/login');
    await page.getByLabel('Correo Electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
    await expect(page).not.toHaveURL(/\/login$/);
}
