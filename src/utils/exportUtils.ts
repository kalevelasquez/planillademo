/**
 * Utilidades para exportación de datos a formatos Excel y CSV.
 * Centraliza la lógica de ImporFrut para reportes profesionales.
 */

/**
 * Genera y descarga un archivo Excel profesional.
 * @param data Array de objetos o matriz de datos.
 * @param fileName Nombre del archivo (sin extensión).
 * @param sheetName Nombre de la pestaña.
 * @param options Configuración opcional (ej: anchos de columna).
 */
export async function exportToExcel(
    data: any[],
    fileName: string,
    sheetName: string = 'Datos',
    options?: {
        colWidths?: number[],
        title?: string,
        author?: string
    }
) {
    try {
        const XLSX = await import('xlsx');

        // 1. Preparar la estructura de matriz con encabezado profesional
        const now = new Date();
        const timestamp = now.toLocaleString('es-SV', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Título y metadatos (Filas 1-4)
        const headerSection = [
            ['IMPORFRUT - SISTEMA DE GESTIÓN OPERATIVA'],
            [`REPORTE: ${options?.title || fileName.replace(/_/g, ' ').toUpperCase()}`],
            [`Generado: ${timestamp}`, `Usuario: ${options?.author || 'Sistema'}`],
            [] // Espaciador
        ];

        let dataMatrix: any[][];
        if (data.length > 0 && !Array.isArray(data[0])) {
            const headers = Object.keys(data[0]);
            const rows = data.map(obj => headers.map(h => obj[h]));
            dataMatrix = [headers, ...rows];
        } else {
            dataMatrix = data;
        }

        const fullMatrix = [...headerSection, ...dataMatrix];
        const worksheet = XLSX.utils.aoa_to_sheet(fullMatrix);

        // 2. Configuraciones Avanzadas (Professional Quality)

        // A. Mezclar celdas para el título principal
        const maxCol = dataMatrix[0]?.length ? dataMatrix[0].length - 1 : 5;
        worksheet['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } }, // Titulo Empresa
            { s: { r: 1, c: 0 }, e: { r: 1, c: maxCol } }  // Titulo Reporte
        ];

        // B. Auto-fit mejorado de columnas
        if (options?.colWidths) {
            worksheet['!cols'] = options.colWidths.map(w => ({ wch: w }));
        } else if (fullMatrix.length > 0) {
            const colWidths = fullMatrix[4]?.map((_, colIndex) => {
                const maxWidth = Math.max(
                    ...fullMatrix.map(row => {
                        const cellValue = row[colIndex];
                        return cellValue ? String(cellValue).length : 0;
                    })
                );
                return { wch: Math.min(Math.max(maxWidth + 4, 12), 40) };
            }) || [];
            worksheet['!cols'] = colWidths;
        }

        // C. Congelar paneles (Fila de encabezado siempre visible)
        // El encabezado real está en la fila 5 (index 4)
        worksheet['!freeze'] = {
            xSplit: 0,
            ySplit: 5, // Congela hasta la fila 5
            topLeftCell: 'A6',
            activePane: 'bottomLeft',
            state: 'frozen'
        };

        // D. Auto-filtros (En la fila de encabezado de datos)
        const lastColLetter = XLSX.utils.encode_col(maxCol);
        worksheet['!autofilter'] = { ref: `A5:${lastColLetter}5` };

        // 3. Formateo de tipos de datos (Moneda/Números)
        // Recorremos la hoja para detectar números y aplicar formato si parecen dinero
        const range = XLSX.utils.decode_range(worksheet['!ref']!);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = worksheet[cellRef];
                if (!cell || cell.t !== 'n') continue;

                // Si la columna tiene "Total", "Precio" o "Subtotal" en el encabezado, aplicar formato $
                const headerValue = String(fullMatrix[4]?.[C] || '').toLowerCase();
                if (headerValue.includes('total') || headerValue.includes('precio') || headerValue.includes('subtotal') || headerValue.includes('ingresos') || headerValue.includes('venta')) {
                    cell.z = '"$"#,##0.00';
                }
            }
        }

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

        // 4. Descarga
        XLSX.writeFile(workbook, `${fileName}.xlsx`);
        return true;
    } catch (error) {
        console.error('[Export] Error al exportar a Excel:', error);
        throw error;
    }
}

/**
 * Genera y descarga un archivo CSV.
 */
export async function exportToCSV(data: any[], fileName: string) {
    try {
        const XLSX = await import('xlsx');

        const worksheet = XLSX.utils.json_to_sheet(data);
        const csvOutput = XLSX.utils.sheet_to_csv(worksheet);

        const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${fileName}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        return true;
    } catch (error) {
        console.error('[Export] Error al exportar a CSV:', error);
        throw error;
    }
}

/**
 * Formatea pedidos para exportación profesional.
 */
export const formatOrdersForExcel = (orders: any[]) => {
    return orders.map(order => ({
        'Número de Pedido': order.order_number,
        'Fecha': new Date(order.created_at).toLocaleDateString('es-SV'),
        'Hora': new Date(order.created_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }),
        'Cliente': order.customers?.business_name || 'Desconocido',
        'Vendedor': order.creator?.full_name || order.user_profiles?.full_name || 'N/A',
        'Estado': order.status,
        'Subtotal': order.subtotal,
        'Descuento': order.discount_amount,
        'Total': order.total_amount,
        'Notas': order.notes || ''
    }));
};

/**
 * Exporta específicamente la cuarentena con sus motivos de rechazo.
 */
export async function exportQuarantineToExcel(items: any[]) {
    const headers = [
        'PRODUCTO', 'MARCA', 'CALIBRE', 'CALIDAD', 'CATEGORIA',
        'EMBARQUE', 'PRECIO', 'INVENTARIO', 'INGRESO', 'Motivo de Rechazo'
    ];

    const rows = items.map(q => [
        q.name || '',
        q.brand || '',
        q.caliber || '',
        q.quality || '',
        q.category_name || '',
        q.shipment_number || '',
        q.price ?? '',
        q.available_quantity ?? '',
        q.entry_date ? new Date(q.entry_date).toLocaleDateString('es-ES') : '',
        (q.validation_errors || []).join(' | ')
    ]);

    const data = [headers, ...rows];
    const fecha = new Date().toISOString().split('T')[0];

    return exportToExcel(data, `Cuarentena_Lotes_${fecha}`, 'Cuarentena');
}
