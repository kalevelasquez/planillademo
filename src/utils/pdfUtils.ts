import React from 'react';
import type { OrderPDFProps } from '../ui/components/orders/OrderPDFTemplate';

/**
 * generateOrderPDFBlob
 * Renderiza el pedido como PDF de forma totalmente dinámica para evitar errores de bundling en Vercel.
 */
export async function generateOrderPDFBlob(props: OrderPDFProps): Promise<Blob> {
    // Importación dinámica pesada del motor
    const { pdf } = await import('@react-pdf/renderer');
    // Importación dinámica de la plantilla para asegurar que va en el mismo chunk asíncrono
    const { OrderPDFTemplate } = await import('../ui/components/orders/OrderPDFTemplate');

    // React.createElement + cast a any para evitar conflictos de tipos con ElementType de @react-pdf
    const element = React.createElement(OrderPDFTemplate, props) as React.ReactElement<any>;
    const blob = await pdf(element).toBlob();
    return blob;
}

/**
 * openOrderPDF
 * Genera el PDF y lo abre en una nueva pestaña o fuerza descarga.
 */
export async function openOrderPDF(props: OrderPDFProps): Promise<void> {
    const blob = await generateOrderPDFBlob(props);
    const url = URL.createObjectURL(blob);

    if (window.innerWidth < 1024) {
        // En móviles/tablets forzamos descarga directa para mejor compatibilidad
        const safeName = props.customer.business_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const link = document.createElement('a');
        link.href = url;
        link.download = `${props.orderNumber}_${safeName}.pdf`;
        link.click();
    } else {
        const newTab = window.open(url, '_blank');
        if (!newTab) {
            const safeName = props.customer.business_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const link = document.createElement('a');
            link.href = url;
            link.download = `${props.orderNumber}_${safeName}.pdf`;
            link.click();
        }
    }

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * downloadOrderPDF
 * Genera el PDF y fuerza descarga directa con nombre descriptivo.
 */
export async function downloadOrderPDF(props: OrderPDFProps): Promise<void> {
    const blob = await generateOrderPDFBlob(props);
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    const safeName = props.customer.business_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `${props.orderNumber}_${safeName}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
