import { describe, it, expect, vi } from 'vitest';
import {
    validateEmpleadoImportHeaders,
    mapExcelRowToEmpleadoCruda,
    celdaAFechaISO,
    validarFilasImportacionEmpleados,
    resolverValorCatalogo,
    type EmpleadoImportCruda,
    type ContextoValidacionImportacionEmpleados,
} from './empleadosExcelUtils';
import { EMPLEADO_IMPORT_HEADERS } from '../config/constants';

const ENCABEZADOS_COMPLETOS = Object.values(EMPLEADO_IMPORT_HEADERS);

function filaCruda(overrides: Partial<EmpleadoImportCruda> = {}): EmpleadoImportCruda {
    return {
        codigoEmpleadoManual: 'EMP-001',
        nombreCompleto: 'Juan Pérez',
        dui: '12345678-9',
        pasaporte: '',
        nit: '',
        nup: '',
        fechaNacimientoRaw: '15/03/1990',
        sexo: '',
        telefono: '',
        correo: '',
        direccion: '',
        contactoEmergenciaNombre: '',
        contactoEmergenciaTelefono: '',
        cargo: '',
        departamento: '',
        centroCostos: '',
        ubicacionNombre: 'Planta Central',
        fechaIngresoRaw: '01/09/2026',
        sueldoMensualRaw: 500,
        tipoAfiliacion: '',
        numeroAfiliacionAfp: '',
        numeroAfiliadoIsss: '',
        banco: '',
        numeroCuenta: '',
        tipoContrato: '',
        ...overrides,
    };
}

function contextoBase(overrides: Partial<ContextoValidacionImportacionEmpleados> = {}): ContextoValidacionImportacionEmpleados {
    return {
        ubicacionesActivas: [{ id: 'ubi-1', nombre: 'Planta Central' }],
        duisExistentes: new Set(),
        codigosExistentesNormalizados: new Set(),
        ...overrides,
    };
}

describe('validateEmpleadoImportHeaders', () => {
    it('pasa cuando están las 7 columnas obligatorias', () => {
        const { isValid, missingHeaders } = validateEmpleadoImportHeaders(ENCABEZADOS_COMPLETOS);
        expect(isValid).toBe(true);
        expect(missingHeaders).toEqual([]);
    });

    it('detecta encabezados obligatorios faltantes', () => {
        const sinUbicacion = ENCABEZADOS_COMPLETOS.filter((h) => h !== EMPLEADO_IMPORT_HEADERS.UBICACION);
        const { isValid, missingHeaders } = validateEmpleadoImportHeaders(sinUbicacion);
        expect(isValid).toBe(false);
        expect(missingHeaders).toEqual([EMPLEADO_IMPORT_HEADERS.UBICACION]);
    });

    it('es insensible a mayúsculas/tildes al matchear encabezados', () => {
        const variante = ENCABEZADOS_COMPLETOS.map((h) => h.toUpperCase());
        expect(validateEmpleadoImportHeaders(variante).isValid).toBe(true);
    });
});

describe('mapExcelRowToEmpleadoCruda', () => {
    it('mapea una fila completa por nombre de encabezado', () => {
        const row: Record<string, unknown> = {
            [EMPLEADO_IMPORT_HEADERS.CODIGO_EMPLEADO]: 'EMP-001',
            [EMPLEADO_IMPORT_HEADERS.NOMBRE_COMPLETO]: 'Juan Pérez',
            [EMPLEADO_IMPORT_HEADERS.DUI]: '12345678-9',
            [EMPLEADO_IMPORT_HEADERS.UBICACION]: 'Planta Central',
            [EMPLEADO_IMPORT_HEADERS.SUELDO_MENSUAL]: 500,
        };
        const cruda = mapExcelRowToEmpleadoCruda(row);
        expect(cruda.codigoEmpleadoManual).toBe('EMP-001');
        expect(cruda.nombreCompleto).toBe('Juan Pérez');
        expect(cruda.dui).toBe('12345678-9');
        expect(cruda.ubicacionNombre).toBe('Planta Central');
        expect(cruda.sueldoMensualRaw).toBe(500);
    });

    it('resuelve el encabezado real de la fila sin importar mayúsculas/tildes', () => {
        const row: Record<string, unknown> = { 'nombre completo': 'Ana Gómez' };
        expect(mapExcelRowToEmpleadoCruda(row).nombreCompleto).toBe('Ana Gómez');
    });

    it('devuelve string vacío para columnas de texto ausentes', () => {
        expect(mapExcelRowToEmpleadoCruda({}).nombreCompleto).toBe('');
    });
});

describe('celdaAFechaISO', () => {
    it('acepta formato DD/MM/AAAA (estándar de la app desde IMPL-137)', () => {
        expect(celdaAFechaISO('15/03/1990')).toBe('1990-03-15');
    });

    it('acepta formato ISO AAAA-MM-DD', () => {
        expect(celdaAFechaISO('1990-03-15')).toBe('1990-03-15');
    });

    it('extrae una celda de fecha nativa de Excel usando getters UTC (mismo gotcha que excelUtils.celdaAFecha)', () => {
        const fechaNativa = new Date(Date.UTC(2026, 6, 20));
        expect(celdaAFechaISO(fechaNativa)).toBe('2026-07-20');
    });

    it('rechaza una fecha que no existe en el calendario aunque matchee la regex', () => {
        expect(celdaAFechaISO('31/02/2026')).toBeNull();
    });

    it('devuelve null para texto que no matchea ningún formato', () => {
        expect(celdaAFechaISO('20 de julio')).toBeNull();
    });

    it('devuelve null para valor vacío', () => {
        expect(celdaAFechaISO('')).toBeNull();
        expect(celdaAFechaISO(undefined)).toBeNull();
    });
});

describe('validarFilasImportacionEmpleados', () => {
    it('happy path: fila completa y válida produce "listo" con ubicacion_id resuelto y sin errores', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda()], contextoBase());
        expect(fila.errores).toEqual([]);
        expect(fila.listo).not.toBeNull();
        expect(fila.listo?.ubicacion_id).toBe('ubi-1');
        expect(fila.listo?.fecha_nacimiento).toBe('1990-03-15');
        expect(fila.listo?.fecha_ingreso).toBe('2026-09-01');
        expect(fila.listo?.sueldo_mensual).toBe(500);
    });

    it('marca como obligatorios: código, nombre, DUI/Pasaporte, fecha de nacimiento, ubicación, fecha de ingreso y sueldo (mismo criterio que el alta individual)', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({
            codigoEmpleadoManual: '', nombreCompleto: '', dui: '', fechaNacimientoRaw: '',
            ubicacionNombre: '', fechaIngresoRaw: '', sueldoMensualRaw: '',
        })], contextoBase());
        expect(fila.listo).toBeNull();
        expect(fila.errores).toEqual(expect.arrayContaining([
            'Código Empleado es obligatorio.',
            'Nombre Completo es obligatorio.',
            'DUI o Pasaporte es obligatorio.',
            'Fecha de Nacimiento es obligatoria.',
            'Ubicación es obligatoria.',
            'Fecha de Ingreso es obligatoria.',
            'Sueldo Mensual es obligatorio.',
        ]));
    });

    it('2026-10-15 — acepta una fila sin DUI si trae Pasaporte (empleado extranjero)', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ dui: '', pasaporte: 'P1234567' })], contextoBase());
        expect(fila.errores).toEqual([]);
        expect(fila.listo?.dui).toBeNull();
        expect(fila.listo?.pasaporte).toBe('P1234567');
    });

    it('2026-10-15 — rechaza una fila sin DUI ni Pasaporte', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ dui: '', pasaporte: '' })], contextoBase());
        expect(fila.errores).toContain('DUI o Pasaporte es obligatorio.');
    });

    it('2026-10-15 — rechaza Pasaporte duplicado dentro del archivo', () => {
        const filas = validarFilasImportacionEmpleados([
            filaCruda({ codigoEmpleadoManual: 'EMP-001', dui: '', pasaporte: 'P1234567' }),
            filaCruda({ codigoEmpleadoManual: 'EMP-002', dui: '', pasaporte: 'P1234567' }),
        ], contextoBase());
        expect(filas[0].errores).toContain('Pasaporte duplicado dentro del archivo.');
        expect(filas[1].errores).toContain('Pasaporte duplicado dentro del archivo.');
    });

    it('rechaza un DUI con formato inválido', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ dui: '123-45' })], contextoBase());
        expect(fila.errores).toContain('DUI con formato inválido (debe ser NNNNNNNN-N).');
    });

    it('detecta DUI duplicado DENTRO del mismo archivo (decisión explícita del usuario, gap que el alta individual no valida)', () => {
        const filas = validarFilasImportacionEmpleados([
            filaCruda({ codigoEmpleadoManual: 'EMP-001' }),
            filaCruda({ codigoEmpleadoManual: 'EMP-002' }),
        ], contextoBase());
        expect(filas[0].errores).toContain('DUI duplicado dentro del archivo.');
        expect(filas[1].errores).toContain('DUI duplicado dentro del archivo.');
    });

    it('detecta DUI ya existente en la base', () => {
        const [fila] = validarFilasImportacionEmpleados(
            [filaCruda()],
            contextoBase({ duisExistentes: new Set(['12345678-9']) })
        );
        expect(fila.errores).toContain('Ya existe un empleado registrado con ese DUI.');
    });

    it('detecta Código Empleado duplicado dentro del archivo, insensible a mayúsculas', () => {
        const filas = validarFilasImportacionEmpleados([
            filaCruda({ codigoEmpleadoManual: 'emp-001', dui: '11111111-1' }),
            filaCruda({ codigoEmpleadoManual: 'EMP-001', dui: '22222222-2' }),
        ], contextoBase());
        expect(filas[0].errores).toContain('Código Empleado duplicado dentro del archivo.');
        expect(filas[1].errores).toContain('Código Empleado duplicado dentro del archivo.');
    });

    it('detecta Código Empleado ya existente en la base', () => {
        const [fila] = validarFilasImportacionEmpleados(
            [filaCruda()],
            contextoBase({ codigosExistentesNormalizados: new Set(['emp-001']) })
        );
        expect(fila.errores).toContain('Ya existe un empleado registrado con ese Código Empleado.');
    });

    it('rechaza fecha de nacimiento o de ingreso futura', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ fechaIngresoRaw: '01/01/2099' })], contextoBase());
        expect(fila.errores).toContain('Fecha de Ingreso no puede ser futura.');
    });

    it('rechaza una Ubicación que no existe en el catálogo activo (única FK real, sin alta rápida)', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ ubicacionNombre: 'Bodega Fantasma' })], contextoBase());
        expect(fila.errores).toContain('Ubicación "Bodega Fantasma" no existe. Verificá el nombre exacto.');
    });

    it('resuelve la Ubicación insensible a mayúsculas/tildes', () => {
        const [fila] = validarFilasImportacionEmpleados(
            [filaCruda({ ubicacionNombre: 'planta central' })],
            contextoBase()
        );
        expect(fila.listo?.ubicacion_id).toBe('ubi-1');
    });

    it('rechaza Sueldo Mensual no numérico', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ sueldoMensualRaw: 'mil quinientos' })], contextoBase());
        expect(fila.errores).toContain('Sueldo Mensual debe ser numérico.');
    });

    it('acepta Sexo M/F y rechaza cualquier otro valor', () => {
        const [ok] = validarFilasImportacionEmpleados([filaCruda({ sexo: 'f' })], contextoBase());
        expect(ok.listo?.sexo).toBe('F');
        const [malo] = validarFilasImportacionEmpleados([filaCruda({ sexo: 'X' })], contextoBase());
        expect(malo.errores).toContain('Sexo debe ser M o F.');
    });

    it('resuelve Tipo de Afiliación por etiqueta legible al valor interno del enum', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ tipoAfiliacion: 'AFP Confía' })], contextoBase());
        expect(fila.listo?.tipo_afiliacion).toBe('afp_confia');
    });

    it('rechaza un Tipo de Afiliación que no matchea ninguna etiqueta válida', () => {
        const [fila] = validarFilasImportacionEmpleados([filaCruda({ tipoAfiliacion: 'Otro Fondo' })], contextoBase());
        expect(fila.errores).toContain('Tipo de Afiliación inválido (use AFP Crecer, AFP Confía, UPISS, Jubilado o IPSFA).');
    });

    it('numera cada fila como si viniera del Excel (fila 1 = encabezados, primera fila de datos = 2)', () => {
        const filas = validarFilasImportacionEmpleados([filaCruda(), filaCruda({ dui: '87654321-0', codigoEmpleadoManual: 'EMP-002' })], contextoBase());
        expect(filas[0].numeroFilaExcel).toBe(2);
        expect(filas[1].numeroFilaExcel).toBe(3);
    });
});

describe('resolverValorCatalogo', () => {
    it('reutiliza el valor existente (insensible a mayúsculas/tildes) sin llamar a crear', async () => {
        const crear = vi.fn();
        const resultado = await resolverValorCatalogo('produccion', [{ nombre: 'Producción' }], crear);
        expect(resultado).toEqual({ valorCanonico: 'Producción', error: null });
        expect(crear).not.toHaveBeenCalled();
    });

    it('crea el valor cuando no existe en el catálogo', async () => {
        const crear = vi.fn().mockResolvedValue({ nombre: 'Bodega Nueva' });
        const resultado = await resolverValorCatalogo('Bodega Nueva', [], crear);
        expect(resultado).toEqual({ valorCanonico: 'Bodega Nueva', error: null });
        expect(crear).toHaveBeenCalledWith('Bodega Nueva');
    });

    it('propaga el error cuando crear() falla (ej. RLS rechaza el rol de quien importa)', async () => {
        const crear = vi.fn().mockRejectedValue(new Error('permiso denegado'));
        const resultado = await resolverValorCatalogo('Bodega Nueva', [], crear);
        expect(resultado).toEqual({ valorCanonico: null, error: 'permiso denegado' });
    });
});
