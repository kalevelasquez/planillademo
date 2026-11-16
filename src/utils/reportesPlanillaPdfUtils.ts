import React from 'react';
import type { TablaReportePDFProps } from '../ui/components/reportes/TablaReportePDFTemplate';
import type { ReferenciaLaboralPDFProps } from '../ui/components/reportes/ReferenciaLaboralPDFTemplate';
import type { ConstanciaSalarioDatos } from './constanciaSalarioUtils';
import type { ReciboSueldoDatos } from './reciboSueldoUtils';
import type { ConstanciaRetencionesDatos } from './constanciaRetencionesUtils';
import type { LiquidacionLaboralPDFProps } from '../ui/components/reportes/LiquidacionLaboralPDFTemplate';
import type { FiniquitoPDFProps } from '../ui/components/reportes/FiniquitoPDFTemplate';

/**
 * Generación/descarga de los reportes de consulta de Planilla (US-EXP-06/07/10 — Vacaciones,
 * Referencia Laboral, Permisos). Mismo patrón exacto que pdfUtils.ts (import dinámico del motor
 * y de la plantilla, Blob, `URL.createObjectURL`, `<a download>`, revoke a los 60s, fallback de
 * descarga forzada en móvil) — un solo archivo con 2 pares de wrappers en vez de duplicar el
 * patrón 3 veces, porque ambas plantillas son livianas y comparten el mismo ciclo de vida.
 */

// `@react-pdf/renderer` parte palabras automáticamente con un guión cuando el texto justificado
// (`textAlign: 'justify'`) queda muy ajustado — llegó a partir apellidos reales en Referencia
// Laboral (ej. "ALVARES-"). El callback identidad (una sola "sílaba" = la palabra completa)
// desactiva ese hyphenation por completo; se registra una sola vez por sesión.
let hyphenationDeshabilitado = false;
async function deshabilitarHyphenation(): Promise<void> {
    if (hyphenationDeshabilitado) return;
    const { Font } = await import('@react-pdf/renderer');
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationDeshabilitado = true;
}

async function blobADescarga(blob: Blob, nombreArchivo: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    if (window.innerWidth < 1024) {
        const link = document.createElement('a');
        link.href = url;
        link.download = nombreArchivo;
        link.click();
    } else {
        const newTab = window.open(url, '_blank');
        if (!newTab) {
            const link = document.createElement('a');
            link.href = url;
            link.download = nombreArchivo;
            link.click();
        }
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Reportes tabulares (Vacaciones, Permisos) ──────────────────────────────

export async function generateTablaReportePDFBlob(props: TablaReportePDFProps): Promise<Blob> {
    await deshabilitarHyphenation();
    const { pdf } = await import('@react-pdf/renderer');
    const { TablaReportePDFTemplate } = await import('../ui/components/reportes/TablaReportePDFTemplate');
    const element = React.createElement(TablaReportePDFTemplate, props) as React.ReactElement<any>;
    return pdf(element).toBlob();
}

export async function openTablaReportePDF(props: TablaReportePDFProps, nombreArchivo: string): Promise<void> {
    const blob = await generateTablaReportePDFBlob(props);
    await blobADescarga(blob, nombreArchivo);
}

// ── Referencia Laboral ──────────────────────────────────────────────────────

export async function generateReferenciaLaboralPDFBlob(props: ReferenciaLaboralPDFProps): Promise<Blob> {
    await deshabilitarHyphenation();
    const { pdf } = await import('@react-pdf/renderer');
    const { ReferenciaLaboralPDFTemplate } = await import('../ui/components/reportes/ReferenciaLaboralPDFTemplate');
    const element = React.createElement(ReferenciaLaboralPDFTemplate, props) as React.ReactElement<any>;
    return pdf(element).toBlob();
}

export async function openReferenciaLaboralPDF(props: ReferenciaLaboralPDFProps, nombreArchivo: string): Promise<void> {
    const blob = await generateReferenciaLaboralPDFBlob(props);
    await blobADescarga(blob, nombreArchivo);
}

// ── Constancia de Salario ───────────────────────────────────────────────────

export async function generateConstanciaSalarioPDFBlob(datos: ConstanciaSalarioDatos): Promise<Blob> {
    await deshabilitarHyphenation();
    const { pdf } = await import('@react-pdf/renderer');
    const { ConstanciaSalarioPDFTemplate } = await import('../ui/components/reportes/ConstanciaSalarioPDFTemplate');
    const element = React.createElement(ConstanciaSalarioPDFTemplate, { datos }) as React.ReactElement<any>;
    return pdf(element).toBlob();
}

export async function openConstanciaSalarioPDF(datos: ConstanciaSalarioDatos, nombreArchivo: string): Promise<void> {
    const blob = await generateConstanciaSalarioPDFBlob(datos);
    await blobADescarga(blob, nombreArchivo);
}

// ── Recibo de Sueldo ─────────────────────────────────────────────────────────

export async function generateReciboSueldoPDFBlob(recibos: ReciboSueldoDatos[]): Promise<Blob> {
    await deshabilitarHyphenation();
    const { pdf } = await import('@react-pdf/renderer');
    const { ReciboSueldoPDFTemplate } = await import('../ui/components/reportes/ReciboSueldoPDFTemplate');
    const element = React.createElement(ReciboSueldoPDFTemplate, { recibos }) as React.ReactElement<any>;
    return pdf(element).toBlob();
}

export async function openReciboSueldoPDF(recibos: ReciboSueldoDatos[], nombreArchivo: string): Promise<void> {
    const blob = await generateReciboSueldoPDFBlob(recibos);
    await blobADescarga(blob, nombreArchivo);
}

// ── Constancia de Retenciones / Impuesto sobre la Renta ────────────────────

export async function generateConstanciaRetencionesPDFBlob(datos: ConstanciaRetencionesDatos): Promise<Blob> {
    await deshabilitarHyphenation();
    const { pdf } = await import('@react-pdf/renderer');
    const { ConstanciaRetencionesPDFTemplate } = await import('../ui/components/reportes/ConstanciaRetencionesPDFTemplate');
    const element = React.createElement(ConstanciaRetencionesPDFTemplate, { datos }) as React.ReactElement<any>;
    return pdf(element).toBlob();
}

export async function openConstanciaRetencionesPDF(datos: ConstanciaRetencionesDatos, nombreArchivo: string): Promise<void> {
    const blob = await generateConstanciaRetencionesPDFBlob(datos);
    await blobADescarga(blob, nombreArchivo);
}

// ── Liquidación Laboral ─────────────────────────────────────────────────────

export async function generateLiquidacionLaboralPDFBlob(props: LiquidacionLaboralPDFProps): Promise<Blob> {
    await deshabilitarHyphenation();
    const { pdf } = await import('@react-pdf/renderer');
    const { LiquidacionLaboralPDFTemplate } = await import('../ui/components/reportes/LiquidacionLaboralPDFTemplate');
    const element = React.createElement(LiquidacionLaboralPDFTemplate, props) as React.ReactElement<any>;
    return pdf(element).toBlob();
}

export async function openLiquidacionLaboralPDF(props: LiquidacionLaboralPDFProps, nombreArchivo: string): Promise<void> {
    const blob = await generateLiquidacionLaboralPDFBlob(props);
    await blobADescarga(blob, nombreArchivo);
}

// ── Finiquito ────────────────────────────────────────────────────────────────

export async function generateFiniquitoPDFBlob(props: FiniquitoPDFProps): Promise<Blob> {
    await deshabilitarHyphenation();
    const { pdf } = await import('@react-pdf/renderer');
    const { FiniquitoPDFTemplate } = await import('../ui/components/reportes/FiniquitoPDFTemplate');
    const element = React.createElement(FiniquitoPDFTemplate, props) as React.ReactElement<any>;
    return pdf(element).toBlob();
}

export async function openFiniquitoPDF(props: FiniquitoPDFProps, nombreArchivo: string): Promise<void> {
    const blob = await generateFiniquitoPDFBlob(props);
    await blobADescarga(blob, nombreArchivo);
}
