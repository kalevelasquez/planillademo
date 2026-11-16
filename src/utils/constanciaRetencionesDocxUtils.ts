import type { ConstanciaRetencionesDatos } from './constanciaRetencionesUtils';
import { importWithRetry } from './chunkImportRetry';

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Generación de la Constancia de Retenciones en Word (US-EXP-13 CA6, IMPL-169) — complementa el
 * PDF ya existente. Mismo contenido, mismo patrón de import dinámico de `docx` que
 * `constanciaSalarioDocxUtils.ts` (no infla el bundle inicial con una librería que solo se usa al
 * generar este reporte puntual). El import va con `importWithRetry` — si el chunk de `docx` está
 * stale (deploy nuevo) se recarga la página una sola vez en vez de tirar un error sin manejar.
 */
export async function generateConstanciaRetencionesDocxBlob(datos: ConstanciaRetencionesDatos): Promise<Blob> {
    const {
        Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        HeadingLevel, AlignmentType, WidthType, BorderStyle,
    } = await importWithRetry(() => import('docx'), "la librería 'docx'");

    const logoModule = await importWithRetry(() => import('../assets/images/logo-imporfrut.png'), 'el logo del reporte');
    const logoBuffer = await fetch(logoModule.default).then((r) => r.arrayBuffer());

    const bordeNinguno = {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    };

    const filaConcepto = (concepto: string, monto: number) => new TableRow({
        children: [
            new TableCell({
                width: { size: 75, type: WidthType.PERCENTAGE },
                borders: bordeNinguno,
                children: [new Paragraph({ children: [new TextRun({ text: concepto, size: 20 })] })],
            }),
            new TableCell({
                width: { size: 25, type: WidthType.PERCENTAGE },
                borders: bordeNinguno,
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmt(monto), size: 20 })] })],
            }),
        ],
    });

    const tablaCodigo = (titulo: string, filas: Array<[string, number]>) => [
        new Paragraph({ children: [new TextRun({ text: titulo, bold: true })], spacing: { before: 300, after: 100 } }),
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: filas.map(([concepto, monto]) => filaConcepto(concepto, monto)),
        }),
    ];

    const fechaHoyTexto = new Date().toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });

    const doc = new Document({
        sections: [{
            children: [
                // Mismo criterio de proporción real del logo que `constanciaSalarioDocxUtils.ts`
                // (docx exige width Y height explícitos, a diferencia de @react-pdf/renderer).
                new Paragraph({ children: [new ImageRun({ data: logoBuffer, transformation: { width: 90, height: 88 }, type: 'png' })] }),
                new Paragraph({ text: '', spacing: { after: 100 } }),
                ...(datos.razonSocialEmpresa ? [new Paragraph({ text: datos.razonSocialEmpresa })] : []),
                ...(datos.nitEmpresa ? [new Paragraph({ text: datos.nitEmpresa, spacing: { after: 200 } })] : []),

                new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'CONSTANCIA DE RENTA', bold: true })], spacing: { after: 200 } }),

                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { after: 200 },
                    children: [new TextRun({
                        text: `Por medio de la presente hacemos constar que el Señor(a)(ita) ${datos.nombreCompleto} con DUI: ${datos.dui} se le hicieron las siguientes retenciones `
                            + `correspondientes al ejercicio fiscal ${datos.anioFiscal} (del 01 de enero al 31 de diciembre de ${datos.anioFiscal}):`,
                    })],
                }),

                ...tablaCodigo('Código de ingreso: 11', [
                    ['Ingresos', datos.ingresosCodigo11],
                    ['Retención', datos.retencionCodigo11],
                ]),
                ...tablaCodigo('Código de ingreso: 60', [
                    ['Honorarios y otros ingresos', datos.ingresosCodigo60],
                    ['Retención', datos.retencionCodigo60],
                ]),
                ...tablaCodigo('Descuentos', [
                    ['ISSS', datos.isss],
                    ['AFP', datos.afp],
                ]),

                new Paragraph({
                    spacing: { before: 300, after: 400 },
                    children: [new TextRun({ text: `En virtud de lo anterior, se extiende la presente constancia para los usos que estime convenientes, el ${fechaHoyTexto}.` })],
                }),

                new Paragraph({ children: [new TextRun({ text: 'Gilda Montiel', bold: true })], spacing: { before: 600 } }),
                new Paragraph({ children: [new TextRun({ text: 'Recursos Humanos' })] }),
            ],
        }],
    });

    return Packer.toBlob(doc);
}

export async function openConstanciaRetencionesDocx(datos: ConstanciaRetencionesDatos, nombreArchivo: string): Promise<void> {
    const blob = await generateConstanciaRetencionesDocxBlob(datos);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
