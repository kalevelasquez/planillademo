import path from 'path';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Credenciales de test y base URL — nunca en el repo, ver e2e/e2e.env.example.
dotenv.config({ path: path.resolve(import.meta.dirname, '.env.e2e.local') });

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';

/**
 * E2E contra el Supabase de `develop` (mismo que usa `npm run dev` vía .env.development,
 * que Vite carga automáticamente en modo development) — no un backend descartable. Por
 * eso cada spec es responsable de limpiar los datos que crea (ver e2e/fixtures/).
 */
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL,
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
