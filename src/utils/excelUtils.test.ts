import { describe, it, expect } from 'vitest';
import { validateExcelHeaders, mapExcelRowToProduct, validateMarcacionHeaders, mapExcelRowToMarcacion } from './excelUtils';
import { EXCEL_HEADERS, MARCACION_HEADERS } from '../config/constants';

describe('excelUtils - Excel Parsing (CA1)', () => {
    describe('validateExcelHeaders', () => {
        it('should return valid if all mandatory headers are present', () => {
            const headers = [
                EXCEL_HEADERS.PRODUCTO,
                EXCEL_HEADERS.CALIBRE,
                EXCEL_HEADERS.MARCA,
                EXCEL_HEADERS.CALIDAD,
                EXCEL_HEADERS.EMBARQUE,
                EXCEL_HEADERS.INGRESO,
                EXCEL_HEADERS.INVENTARIO,
                EXCEL_HEADERS.PRECIO,
                EXCEL_HEADERS.CATEGORIA
            ];
            const { isValid, missingHeaders } = validateExcelHeaders(headers);
            expect(isValid).toBe(true);
            expect(missingHeaders).toHaveLength(0);
        });

        it('should detect missing headers', () => {
            const headers = [EXCEL_HEADERS.PRODUCTO, EXCEL_HEADERS.CALIBRE];
            const { isValid, missingHeaders } = validateExcelHeaders(headers);
            expect(isValid).toBe(false);
            expect(missingHeaders).toContain(EXCEL_HEADERS.MARCA);
            expect(missingHeaders).toContain(EXCEL_HEADERS.CALIDAD);
        });
    });

    describe('mapExcelRowToProduct', () => {
        it('should map a raw row to a clean product object', () => {
            const row = {
                [EXCEL_HEADERS.PRODUCTO]: 'Manzana',
                [EXCEL_HEADERS.CALIBRE]: '100',
                [EXCEL_HEADERS.MARCA]: 'Imporfrut',
                [EXCEL_HEADERS.CALIDAD]: 'CAT1',
                [EXCEL_HEADERS.EMBARQUE]: 'SHIP-01',
                [EXCEL_HEADERS.INGRESO]: '2026-03-20',
                [EXCEL_HEADERS.INVENTARIO]: 500,
                [EXCEL_HEADERS.PRECIO]: 25.5
            };

            const result = mapExcelRowToProduct(row);
            expect(result.name).toBe('Manzana');
            expect(result.available_quantity).toBe(500);
            expect(result.price).toBe(25.5);
            expect(result.shipment_number).toBe('SHIP-01');
        });

        it('should handle missing numeric values by defaulting to 0', () => {
            const row = {
                [EXCEL_HEADERS.PRODUCTO]: 'Uva',
                // Missing price and inventory
            };
            const result = mapExcelRowToProduct(row);
            expect(result.price).toBe(0);
            expect(result.available_quantity).toBe(0);
        });
    });
});

describe('excelUtils - Marcaciones del Reloj (US-HEX-02 CA2)', () => {
    describe('validateMarcacionHeaders', () => {
        it('should return valid if all 5 mandatory headers are present', () => {
            const headers = [
                MARCACION_HEADERS.ID_USUARIO,
                MARCACION_HEADERS.NOMBRE_COMPLETO,
                MARCACION_HEADERS.FECHA,
                MARCACION_HEADERS.HORA_ENTRADA,
                MARCACION_HEADERS.HORA_SALIDA,
            ];
            const { isValid, missingHeaders } = validateMarcacionHeaders(headers);
            expect(isValid).toBe(true);
            expect(missingHeaders).toHaveLength(0);
        });

        it('should detect missing headers', () => {
            const headers = [MARCACION_HEADERS.ID_USUARIO, MARCACION_HEADERS.FECHA];
            const { isValid, missingHeaders } = validateMarcacionHeaders(headers);
            expect(isValid).toBe(false);
            expect(missingHeaders).toContain(MARCACION_HEADERS.NOMBRE_COMPLETO);
            expect(missingHeaders).toContain(MARCACION_HEADERS.HORA_ENTRADA);
            expect(missingHeaders).toContain(MARCACION_HEADERS.HORA_SALIDA);
        });

        it('should ignore extra pre-calculated columns (HEN/HED/etc) without affecting validity', () => {
            const headers = [
                MARCACION_HEADERS.ID_USUARIO,
                MARCACION_HEADERS.NOMBRE_COMPLETO,
                MARCACION_HEADERS.FECHA,
                MARCACION_HEADERS.HORA_ENTRADA,
                MARCACION_HEADERS.HORA_SALIDA,
                'HEN', 'HED', 'NOCTURNIDAD',
            ];
            const { isValid } = validateMarcacionHeaders(headers);
            expect(isValid).toBe(true);
        });

        it('should accept the real headers Imporfrut brought (Nombre/Entrada/Salir), distintos a los canónicos, y sus columnas extra (Pausa/Resumen/T.E./OT/Grupo/etc.)', () => {
            const headers = [
                'No.', 'ID de usuario', 'Nombre', 'empno', 'ID de tarjeta', 'Grupo', 'Departamento', 'Sección',
                'Fecha', 'Día de semana', 'Tipo de día', 'Horario', 'Entrada', 'Pausa', 'Resumen', 'Salir',
                'OT', 'Listo', 'Trabajo', 'T.E.', 'Dif. TE', 'Corto',
            ];
            const { isValid, missingHeaders } = validateMarcacionHeaders(headers);
            expect(isValid).toBe(true);
            expect(missingHeaders).toHaveLength(0);
        });

        it('should match headers case/accent-insensitively (ID de usuario / Fecha en minúsculas)', () => {
            const headers = ['id de usuario', 'nombre completo', 'fecha', 'hora de entrada', 'hora de salida'];
            const { isValid } = validateMarcacionHeaders(headers);
            expect(isValid).toBe(true);
        });
    });

    describe('mapExcelRowToMarcacion', () => {
        it('should map a raw row with text fecha/hora as-is', () => {
            const row = {
                [MARCACION_HEADERS.ID_USUARIO]: 'EMP-001',
                [MARCACION_HEADERS.NOMBRE_COMPLETO]: ' Juan Pérez ',
                [MARCACION_HEADERS.FECHA]: '2026-07-20',
                [MARCACION_HEADERS.HORA_ENTRADA]: '08:00',
                [MARCACION_HEADERS.HORA_SALIDA]: '17:00',
                HEN: 1.5, // columna pre-calculada, debe ignorarse
            };
            const result = mapExcelRowToMarcacion(row);
            expect(result).toEqual({
                idUsuario: 'EMP-001',
                nombreCompleto: 'Juan Pérez',
                fecha: '2026-07-20',
                horaEntrada: '08:00',
                horaSalida: '17:00',
            });
        });

        it('should default missing fields to empty strings', () => {
            const result = mapExcelRowToMarcacion({});
            expect(result.idUsuario).toBe('');
            expect(result.nombreCompleto).toBe('');
        });

        it('should normalize a native Excel date cell (cellDates:true) using UTC getters', () => {
            const row = {
                [MARCACION_HEADERS.ID_USUARIO]: 'EMP-001',
                [MARCACION_HEADERS.NOMBRE_COMPLETO]: 'Juan Pérez',
                [MARCACION_HEADERS.FECHA]: new Date(Date.UTC(2026, 6, 20)),
                [MARCACION_HEADERS.HORA_ENTRADA]: '08:00',
                [MARCACION_HEADERS.HORA_SALIDA]: '17:00',
            };
            const result = mapExcelRowToMarcacion(row);
            expect(result.fecha).toBe('2026-07-20');
        });

        it('should map a row using the real Imporfrut headers (Nombre/Entrada/Salir) instead of the canonical ones, ignoring Pausa/Resumen/T.E./OT', () => {
            const row = {
                'No.': 1,
                'ID de usuario': '2',
                Nombre: 'JOSE VICTOR MEJIA C',
                empno: 0,
                Fecha: '2026-07-24',
                'Día de semana': 'Viernes',
                'Tipo de día': 'DÍA LABORAL',
                Horario: 3,
                Entrada: '09:34',
                Pausa: '',
                Resumen: '',
                Salir: '16:30',
                'T.E.': 6.56,
            };
            const result = mapExcelRowToMarcacion(row);
            expect(result).toEqual({
                idUsuario: '2',
                nombreCompleto: 'JOSE VICTOR MEJIA C',
                fecha: '2026-07-24',
                horaEntrada: '09:34',
                horaSalida: '16:30',
            });
        });

        it('should normalize native Excel time cells (cellDates:true) using UTC getters', () => {
            const row = {
                [MARCACION_HEADERS.ID_USUARIO]: 'EMP-001',
                [MARCACION_HEADERS.NOMBRE_COMPLETO]: 'Juan Pérez',
                [MARCACION_HEADERS.FECHA]: '2026-07-20',
                [MARCACION_HEADERS.HORA_ENTRADA]: new Date(Date.UTC(1899, 11, 30, 8, 0)),
                [MARCACION_HEADERS.HORA_SALIDA]: new Date(Date.UTC(1899, 11, 30, 17, 30)),
            };
            const result = mapExcelRowToMarcacion(row);
            expect(result.horaEntrada).toBe('08:00');
            expect(result.horaSalida).toBe('17:30');
        });
    });
});
