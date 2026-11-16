/**
 * whatsappUtils.ts
 * ─────────────────────────────────────────────────────────────────
 * Construcción de mensajes y deep-links de WhatsApp para pedidos.
 *
 * Safe-Text Rules:
 *   ST-02 — El URL del PDF va solo en su línea, sin texto pegado al hipervínculo.
 *   ST-03 — Sin comillas dobles en el mensaje.
 *
 * Formato v2 (2026-03-03): Mensaje minimalista de notificación de entrega.
 * El detalle del pedido viaja en el PDF; el mensaje es solo el aviso.
 */

import type { OrderDTO, OrderItemDetail } from '../services/orderService';
import { BRAND } from '../config/brand';
import { CONFIG } from '../config';

// ── Función principal ─────────────────────────────────────────────

/**
 * buildWhatsAppMessage
 * Construye el aviso minimalista de entrega de pedido.
 * El `pdfUrl` debe ir limpio — sin trailing spaces ni caracteres extraños —
 * para que el hipervínculo en el dispositivo del cliente sea clicable.
 *
 * @param order   OrderDTO con datos del pedido
 * @param _items  Recibido por compatibilidad con el flujo JIT (no se usa en el mensaje)
 * @param pdfUrl  URL pública del PDF en Supabase Storage
 * @returns       Texto del mensaje URI-encoded listo para concatenar en wa.me
 */
export function buildWhatsAppMessage(
    order: OrderDTO,
    _items: OrderItemDetail[],
    pdfUrl?: string
): string {
    // ST-02: el URL se coloca solo en su propia línea, sin texto pegado al lado.
    // trim() asegura que no haya espacios/saltos al inicio o final del link (Safe-Text check).
    const safeUrl = pdfUrl?.trim() ?? '';

    const lines: string[] = [
        `${BRAND.WA_HEADER_EMOJI} ${BRAND.NAME} — Pedido ${order.order_number}`,
        '',
        'Estimado cliente, adjuntamos el detalle de su pedido en el siguiente enlace oficial:',
        '',
        `📄 ${safeUrl}`,
        '',
        'Gracias por su preferencia.',
    ];

    // ST-03: eliminar cualquier comilla doble residual
    const rawText = lines.join('\n').replace(/"/g, "'");

    // encodeURIComponent convierte los \n en %0A, lo que WhatsApp interpreta
    // correctamente como saltos de línea en el dispositivo del cliente.
    return encodeURIComponent(rawText);
}

/**
 * buildBodegaMessage
 * Construye el detalle técnico para el equipo de despacho.
 */
export function buildBodegaMessage(
    order: OrderDTO,
    items: OrderItemDetail[]
): string {
    const lines: string[] = [
        `*📦 NUEVO PEDIDO: ${order.order_number}*`,
        `*Cliente:* ${order.customers?.business_name ?? 'N/A'}`,
        `──────────────────`,
    ];

    items.forEach(i => {
        const noteLine = i.notes ? ` _(${i.notes})_` : '';
        lines.push(`${i.quantity}x ${i.products?.name ?? 'Prod'}${noteLine} — $${Number(i.total_price).toFixed(2)}`);
    });

    lines.push(`──────────────────`);
    if (Number(order.discount_amount) > 0) {
        lines.push(`Descuento: -$${Number(order.discount_amount).toFixed(2)}`);
    }
    lines.push(`*TOTAL: $${Number(order.total_amount).toFixed(2)}*`);

    if (order.notes) {
        lines.push('');
        lines.push(`*Notas:* ${order.notes}`);
    }

    return encodeURIComponent(lines.join('\n'));
}

/**
 * openWhatsApp
 * Construye la URL de deep-link y abre WhatsApp.
 */
export function openWhatsApp(
    phone: string | null | undefined,
    order?: OrderDTO,
    items: OrderItemDetail[] = [],
    pdfUrl?: string,
    target: 'client' | 'bodega' = 'client'
): void {
    if (!phone) {
        throw new Error(target === 'client' ? 'El cliente no tiene un número configurado.' : 'El despachador no tiene un número configurado.');
    }

    // Limpieza profunda: descartar todo lo que no sea dígito (\D)
    // Esto quita guiones, espacios, paréntesis y el signo '+'
    let digits = phone.replace(/\D/g, '');

    // Inyección inteligente de prefijo El Salvador (503)
    // Si tiene 8 dígitos, es local -> anteponemos 503
    if (digits.length === 8) {
        digits = `503${digits}`;
    }

    const message = order 
        ? (target === 'client' ? buildWhatsAppMessage(order, items, pdfUrl) : buildBodegaMessage(order, items))
        : encodeURIComponent('Hola, un gusto saludarte.');

    const waUrl = `${CONFIG.WHATSAPP_BASE_URL}${digits}?text=${message}`;
    
    // Usamos location.assign para garantizar que el deep-link se abra incluso si
    // la llamada ocurre tras un await asíncrono (que suele bloquear window.open)
    window.location.assign(waUrl);
}
