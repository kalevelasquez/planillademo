/**
 * brand.ts
 * ─────────────────────────────────────────────────────────────────
 * Fuente única de verdad para la identidad de marca Teknergy.
 * Aparece en: PDF, mensajes de WhatsApp, y cualquier canal de comunicación.
 *
 * Para cambiar datos de contacto o textos legales, edita ÚNICAMENTE este archivo.
 */

export const BRAND = {
    /** Nombre corto de la empresa (encabezado PDF, mensajes WA) */
    NAME: 'TEKNERGY',

    /** Razón social o descripción larga (tagline PDF) */
    TAGLINE: 'El poder de la tecnología',

    /** País de operación */
    COUNTRY: 'El Salvador',

    /** Email de soporte al cliente */
    SUPPORT_EMAIL: 'alexis.velasquez@teknergy.com',

    /**
     * Teléfono de Bodega en formato DB (503XXXXXXXX — sin '+', sin guiones).
     * Usado en el botón "Enviar a Bodega" desde OrderSummaryView.
     * ⚠️ Configurar con el número real antes de pasar a producción.
     */
    PHONE_BODEGA: '50377772397',

    /** Texto legal de pie de página del PDF */
    LEGAL_DISCLAIMER:
        'Este documento es una proforma válida por 24 horas.\n' +
        'Los precios están expresados en dólares americanos (USD) e incluyen IVA donde aplica.\n' +
        'Sujeto a disponibilidad de inventario.',

    /** Emoji identificador para encabezados de mensajes WhatsApp */
    WA_HEADER_EMOJI: '🍎',
} as const;
