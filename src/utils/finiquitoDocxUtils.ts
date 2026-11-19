import type { FiniquitoDatos, MontoOPendiente } from './finiquitoUtils';
import { importWithRetry } from './chunkImportRetry';

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
};
const textoValor = (valor: number | MontoOPendiente): string =>
    typeof valor === 'number' ? fmt(valor) : valor.estado === 'confirmado' ? fmt(valor.monto) : 'PENDIENTE DE DEFINIR';

/**
 * Finiquito en Word (US-EXP-09 CA6, IMPL-162) — "para poder firmarse físicamente" (a diferencia
 * de Liquidación Laboral, que solo pidió PDF). Mismo patrón de import dinámico de `docx` que
 * `constanciaRetencionesDocxUtils.ts`.
 */
export async function generateFiniquitoDocxBlob(datos: FiniquitoDatos, razonSocialEmpresa?: string, nitEmpresa?: string): Promise<Blob> {
    const {
        Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        ImageRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
    } = await importWithRetry(() => import('docx'), "la librería 'docx'");

    const logoModule = await importWithRetry(() => import('../assets/images/logo-teknergy.png'), 'el logo del reporte');
    const logoBuffer = await fetch(logoModule.default).then((r) => r.arrayBuffer());

    const bordeNinguno = {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    };

    const filaConcepto = (concepto: string, valor: number | MontoOPendiente) => new TableRow({
        children: [
            new TableCell({
                width: { size: 75, type: WidthType.PERCENTAGE },
                borders: bordeNinguno,
                children: [new Paragraph({ children: [new TextRun({ text: concepto, size: 20 })] })],
            }),
            new TableCell({
                width: { size: 25, type: WidthType.PERCENTAGE },
                borders: bordeNinguno,
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: textoValor(valor), size: 20 })] })],
            }),
        ],
    });

    const tablaSeccion = (titulo: string, filas: Array<[string, number | MontoOPendiente]>) => [
        new Paragraph({ children: [new TextRun({ text: titulo, bold: true })], spacing: { before: 300, after: 100 } }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: filas.map(([c, v]) => filaConcepto(c, v)) }),
    ];

    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({ children: [new ImageRun({ data: logoBuffer, transformation: { width: 160, height: 40 }, type: 'png' })] }),
                new Paragraph({ text: '', spacing: { after: 100 } }),
                ...(razonSocialEmpresa ? [new Paragraph({ text: razonSocialEmpresa })] : []),
                ...(nitEmpresa ? [new Paragraph({ text: nitEmpresa, spacing: { after: 200 } })] : []),

                new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'FINIQUITO', bold: true })], spacing: { after: 200 } }),

                new Paragraph({ children: [new TextRun({ text: `Nombre: ${datos.nombreEmpleado}` })] }),
                new Paragraph({ children: [new TextRun({ text: `DUI: ${datos.dui}` })] }),
                new Paragraph({ children: [new TextRun({ text: `Fecha de inicio: ${fmtFecha(datos.fechaInicio)}` })] }),
                new Paragraph({ children: [new TextRun({ text: `Fecha de fin: ${fmtFecha(datos.fechaFin)}` })], spacing: { after: 200 } }),

                ...tablaSeccion('Ingresos', [
                    ['Indemnización (Art. 58 CT)', datos.indemnizacion],
                    ['Vacaciones Completas', datos.vacacionesCompletas],
                    ['Vacación Proporcional', datos.vacacionProporcional],
                    ['Aguinaldo Completo', datos.aguinaldoCompleto],
                    ['Aguinaldo Proporcional', datos.aguinaldoProporcional],
                    ['Sueldo pendiente (último período)', datos.sueldoPendiente],
                    ['Horas Extras pendientes', datos.horasExtrasPendientes],
                    ['Viáticos pendientes', datos.viaticosPendientes],
                    ['Bonificación', datos.bonificacion],
                    ['Ingresos Totales (parcial)', datos.ingresosTotales],
                ]),

                ...tablaSeccion('Detalle de Descuentos', [
                    ['ISSS', datos.detalleDescuentos.isss],
                    ['AFP', datos.detalleDescuentos.afp],
                    ['Renta', datos.detalleDescuentos.renta],
                    ['Calzado', datos.detalleDescuentos.calzado],
                    ['Anticipo de Vacaciones y Aguinaldo', datos.detalleDescuentos.anticipoVacacionesAguinaldo],
                    ['Otros Descuentos', datos.detalleDescuentos.otrosDescuentos],
                    ['Total Descuentos', datos.totalDescuentos],
                ]),

                new Paragraph({
                    spacing: { before: 300, after: 100 },
                    children: [new TextRun({ text: `Total a Pagar (parcial): ${fmt(datos.totalAPagarParcial)}`, bold: true, size: 24 })],
                }),
                new Paragraph({
                    spacing: { after: 300 },
                    children: [new TextRun({ text: `Cantidad en letras: ${datos.montoEnLetras} DÓLARES DE LOS ESTADOS UNIDOS DE AMÉRICA`, bold: true })],
                }),

                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { after: 400 },
                    children: [new TextRun({
                        text: `Recibí de ${razonSocialEmpresa || 'la empresa'} la cantidad antes indicada, en concepto de `
                            + 'finiquito por la terminación de mi relación laboral, declarando que nada más se me adeuda '
                            + 'por ningún concepto derivado de dicha relación de trabajo, por lo que renuncio a cualquier '
                            + 'reclamo futuro relacionado con la misma.',
                    })],
                }),

                new Paragraph({ children: [new TextRun({ text: `Fecha de firma: ${fmtFecha(datos.fechaFirma)}` })], spacing: { after: 600 } }),
                new Paragraph({ children: [new TextRun({ text: datos.nombreEmpleado, bold: true })] }),
                new Paragraph({ children: [new TextRun({ text: 'Firma del Empleado' })] }),
            ],
        }],
    });

    return Packer.toBlob(doc);
}

export async function openFiniquitoDocx(datos: FiniquitoDatos, nombreArchivo: string, razonSocialEmpresa?: string, nitEmpresa?: string): Promise<void> {
    const blob = await generateFiniquitoDocxBlob(datos, razonSocialEmpresa, nitEmpresa);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
