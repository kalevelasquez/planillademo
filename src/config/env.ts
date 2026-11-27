/**
 * Variables de entorno de la tienda publica (Vite: se inyectan en build).
 *
 *  - VITE_STORE_TENANT_ID: tenant cuyo catalogo muestra la tienda (se setea en Vercel, B4.6).
 *  - VITE_STORE_CAPTCHA_ENABLED: solo el literal "true" lo enciende (v1: apagado, CaptchaSlot no-op).
 */
export const STORE_TENANT_ID: string = (import.meta.env.VITE_STORE_TENANT_ID ?? '').trim();

export const STORE_CAPTCHA_ENABLED: boolean = import.meta.env.VITE_STORE_CAPTCHA_ENABLED === 'true';
