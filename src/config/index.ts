/**
 * Centralización de variables de configuración y entorno (US-NFR-03 CA2)
 */
export const CONFIG = {
    // 1. Conexión con Supabase
    SUPABASE_URL: (import.meta.env.VITE_SUPABASE_URL as string) || '',
    SUPABASE_ANON_KEY: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '',

    // 2. Comunicaciones Externas
    WHATSAPP_BASE_URL: 'https://wa.me/',

    // 3. Formatos y Prefijos de Negocio
    ORDER_PREFIX: 'PED-',
    DRAFT_PREFIX: 'DRAFT-',
    CURRENCY_SYMBOL: '$',

    // 4. Reglas de Negocio / Límites
    MAX_DISCOUNT_PERCENTAGE: 100,

    // 5. Entorno
    IS_DEV: import.meta.env.DEV,
    IS_PROD: import.meta.env.PROD,

    // 6. Feature Flags (Opcional para futuro crecimiento)
    FEATURES: {
        ENABLE_ANIMATIONS: true,
        STRICT_INVENTORY_CHECK: true,
    }
} as const;

export type AppConfig = typeof CONFIG;
