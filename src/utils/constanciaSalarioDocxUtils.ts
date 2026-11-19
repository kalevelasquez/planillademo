import { construirFilasIngresosConstanciaSalario, construirFilasDeduccionesConstanciaSalario, type ConstanciaSalarioDatos } from './constanciaSalarioUtils';
import { importWithRetry } from './chunkImportRetry';

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Generación de la Constancia de Salario en Word (US-EXP-04 CA4/CA5, IMPL-157) — complementa el
 * PDF ya existente (`reportesPlanillaPdfUtils.ts`), para el caso donde el empleado pide un ajuste
 * manual puntual (ej. calificar a un préstamo con una cuota más baja, según lo explicado por
 * Gilda Montiel) sin alterar el cálculo base que guarda el sistema. Mismo contenido que el PDF,
 * en un documento editable. Import dinámico de `docx` (mismo patrón que `@react-pdf/renderer` en
 * `reportesPlanillaPdfUtils.ts`) para no inflar el bundle inicial con una librería que solo se usa
 * al generar este reporte puntual. Va con `importWithRetry` — si el chunk está stale (deploy
 * nuevo) se recarga la página una sola vez en vez de tirar un error sin manejar.
 */
export async function generateConstanciaSalarioDocxBlob(datos: ConstanciaSalarioDatos): Promise<Blob> {
    const {
        Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        HeadingLevel, AlignmentType, WidthType, BorderStyle,
    } = await importWithRetry(() => import('docx'), "la librería 'docx'");

    const logoModule = await importWithRetry(() => import('../assets/images/logo-teknergy.png'), 'el logo del reporte');
    const logoBuffer = await fetch(logoModule.default).then((r) => r.arrayBuffer());

    const bordeNinguno = {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    };

    const filaConcepto = (concepto: string, monto: number, negrita = false) => new TableRow({
        children: [
            new TableCell({
                width: { size: 75, type: WidthType.PERCENTAGE },
                borders: bordeNinguno,
                children: [new Paragraph({ children: [new TextRun({ text: concepto, bold: negrita, size: 20 })] })],
            }),
            new TableCell({
                width: { size: 25, type: WidthType.PERCENTAGE },
                borders: bordeNinguno,
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmt(monto), bold: negrita, size: 20 })] })],
            }),
        ],
    });

    const filasIngresos = construirFilasIngresosConstanciaSalario(datos);
    const filasDeducciones = construirFilasDeduccionesConstanciaSalario(datos);
    const fechaIngresoTexto = new Date(`${datos.fechaIngreso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
    const fechaHoyTexto = new Date().toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });

    const doc = new Document({
        sections: [{
            children: [
                // Logo real 1410×1383px (casi cuadrado) — mantener la proporción real, no el
                // rectángulo ancho que usa el header del PDF (@react-pdf/renderer sí respeta el
                // aspect-ratio automáticamente con solo `width`; `docx` exige width Y height
                // explícitos, así que hay que calcularlos a mano o el logo sale aplastado).
                new Paragraph({ children: [new ImageRun({ data: logoBuffer, transformation: { width: 160, height: 40 }, type: 'png' })] }),
                new Paragraph({ text: '', spacing: { after: 200 } }),
                new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'CONSTANCIA DE SALARIO', bold: true })] }),
                new Paragraph({ children: [new TextRun({ text: 'A QUIEN INTERESE:', bold: true })], spacing: { after: 200 } }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { after: 200 },
                    children: [new TextRun({
                        text: `Por medio de la presente se hace constar que ${datos.nombreCompleto.toUpperCase()} presta sus servicios para `
                            + `Importadora de Frutas, S.A. de C.V., donde ocupa el cargo de ${datos.cargo.toUpperCase()} desde el ${fechaIngresoTexto} a la fecha.`,
                    })],
                }),
                new Paragraph({ text: 'Actualmente devenga un ingreso mensual integrado, conforme al siguiente detalle:', spacing: { after: 200 } }),

                new Paragraph({ children: [new TextRun({ text: 'Ingresos', bold: true })], spacing: { before: 100, after: 100 } }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        ...filasIngresos.map((f) => filaConcepto(f.concepto, f.monto)),
                        filaConcepto('Total de ingresos', datos.totalIngresos, true),
                    ],
                }),

                new Paragraph({ text: 'Sobre los ingresos se realizan las deducciones correspondientes, según el siguiente detalle:', spacing: { before: 300, after: 100 } }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        ...filasDeducciones.map((f) => filaConcepto(f.concepto, f.monto)),
                        filaConcepto('Total de deducciones', datos.totalDeducciones, true),
                    ],
                }),

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

export async function openConstanciaSalarioDocx(datos: ConstanciaSalarioDatos, nombreArchivo: string): Promise<void> {
    const blob = await generateConstanciaSalarioDocxBlob(datos);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
