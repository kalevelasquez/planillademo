import { describe, it, expect } from 'vitest';
import {
    resolverInstitucionPrevisionalPlanillaUnica,
    limpiarDui,
    formatearPeriodoPlanillaUnica,
    calcularDiasCalendarioMes,
    resolverMesCompletoPlanillaUnica,
    armarFilasEmpleadoPlanillaUnica,
    CORRELATIVO_CENTRO_TRABAJO,
    TIPO_DOCUMENTO_DUI,
    HORAS_JORNADA_ESTANDAR,
} from './planillaUnicaUtils';

describe('resolverInstitucionPrevisionalPlanillaUnica (IMPL-99, confirmado por Imporfrut 2026-09-21)', () => {
    it('afp_crecer mapea directo a MAX, sin código de observación', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica('afp_crecer', null)).toEqual({
            institucionPrevisional: 'MAX',
            codigoObservacion2: null,
        });
    });

    it('afp_confia mapea directo a COF, sin código de observación', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica('afp_confia', null)).toEqual({
            institucionPrevisional: 'COF',
            codigoObservacion2: null,
        });
    });

    it('upiss mapea a ISS, sin código de observación (evidencia: Margarita Urbina, fila 31 de 1.12 Planilla SSF.xlsx)', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica('upiss', null)).toEqual({
            institucionPrevisional: 'ISS',
            codigoObservacion2: null,
        });
    });

    it('jubilado con AFP de origen Confía mantiene COF + código 04 (evidencia: Raúl López, fila 47)', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica('jubilado', 'afp_confia')).toEqual({
            institucionPrevisional: 'COF',
            codigoObservacion2: '04',
        });
    });

    it('jubilado con AFP de origen Crecer mantiene MAX + código 04 (evidencia: segundo caso con código 04 en el archivo real)', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica('jubilado', 'afp_crecer')).toEqual({
            institucionPrevisional: 'MAX',
            codigoObservacion2: '04',
        });
    });

    it('jubilado sin AFP de origen reconstruible deja la institución vacía (no hay que inventar un valor)', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica('jubilado', null)).toEqual({
            institucionPrevisional: '',
            codigoObservacion2: '04',
        });
    });

    it('ipsfa mapea a institución vacía + código 13 (confirmado por Imporfrut como regla general, caso Oscar Orlando Reyes fila 64)', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica('ipsfa', null)).toEqual({
            institucionPrevisional: '',
            codigoObservacion2: '13',
        });
    });

    it('null o vacío no tiene institución ni código', () => {
        expect(resolverInstitucionPrevisionalPlanillaUnica(null, null)).toEqual({
            institucionPrevisional: '',
            codigoObservacion2: null,
        });
    });
});

describe('limpiarDui — quita el guión del DUI (CA1 col.5)', () => {
    it('quita el guión de un DUI real', () => {
        expect(limpiarDui('02697943-9')).toBe('026979439');
    });

    it('null da string vacío', () => {
        expect(limpiarDui(null)).toBe('');
    });
});

describe('formatearPeriodoPlanillaUnica (CA1 col.3 — MM+AAAA)', () => {
    it('junio 2026 → "062026"', () => {
        expect(formatearPeriodoPlanillaUnica(5, 2026)).toBe('062026');
    });

    it('diciembre 2025 → "122025"', () => {
        expect(formatearPeriodoPlanillaUnica(11, 2025)).toBe('122025');
    });
});

describe('calcularDiasCalendarioMes (CA1 col.17 — días calendario, no laborados)', () => {
    it('junio 2026 tiene 30 días', () => {
        expect(calcularDiasCalendarioMes(5, 2026)).toBe(30);
    });

    it('febrero 2026 (no bisiesto) tiene 28 días', () => {
        expect(calcularDiasCalendarioMes(1, 2026)).toBe(28);
    });

    it('febrero 2028 (bisiesto) tiene 29 días', () => {
        expect(calcularDiasCalendarioMes(1, 2028)).toBe(29);
    });
});

describe('valores fijos confirmados (CA3b y sin variación evidenciada)', () => {
    it('correlativo, tipo de documento y horas de jornada son las constantes esperadas', () => {
        expect(CORRELATIVO_CENTRO_TRABAJO).toBe('001');
        expect(TIPO_DOCUMENTO_DUI).toBe('01');
        expect(HORAS_JORNADA_ESTANDAR).toBe('08');
    });
});

describe('resolverMesCompletoPlanillaUnica (CA1/CA4 — habilitación por mes completo)', () => {
    const q1 = { id: 'q1', tipo: 'normal' as const, fecha_inicio: '2026-06-01', fecha_fin: '2026-06-15', estado: 'aprobada_cerrada' as const };
    const q2 = { id: 'q2', tipo: 'normal' as const, fecha_inicio: '2026-06-16', fecha_fin: '2026-06-30', estado: 'aprobada_cerrada' as const };

    it('habilitado cuando ambas quincenas del mes están cerradas', () => {
        const resultado = resolverMesCompletoPlanillaUnica(q2, [q1, q2]);
        expect(resultado.habilitado).toBe(true);
        expect(resultado.primeraQuincenaId).toBe('q1');
        expect(resultado.segundaQuincenaId).toBe('q2');
        expect(resultado.mes0).toBe(5);
        expect(resultado.anio).toBe(2026);
    });

    it('no habilitado si la quincena actual es la 1ra del mes', () => {
        const resultado = resolverMesCompletoPlanillaUnica(q1, [q1, q2]);
        expect(resultado.habilitado).toBe(false);
        expect(resultado.motivo).toMatch(/2da quincena/i);
    });

    it('no habilitado si falta la 1ra quincena del mes', () => {
        const resultado = resolverMesCompletoPlanillaUnica(q2, [q2]);
        expect(resultado.habilitado).toBe(false);
        expect(resultado.motivo).toMatch(/falta la 1ra/i);
    });

    it('no habilitado si la 1ra quincena existe pero no está cerrada', () => {
        const resultado = resolverMesCompletoPlanillaUnica(q2, [{ ...q1, estado: 'en_proceso' as const }, q2]);
        expect(resultado.habilitado).toBe(false);
        expect(resultado.motivo).toMatch(/aprobadas y cerradas/i);
    });

    it('no habilitado si la propia 2da quincena no está cerrada', () => {
        const resultado = resolverMesCompletoPlanillaUnica({ ...q2, estado: 'en_proceso' as const }, [q1, { ...q2, estado: 'en_proceso' as const }]);
        expect(resultado.habilitado).toBe(false);
    });

    it('no habilitado para quincenas de tipo Aguinaldo/Quincena 25', () => {
        const resultado = resolverMesCompletoPlanillaUnica({ ...q2, tipo: 'aguinaldo' }, [q1, q2]);
        expect(resultado.habilitado).toBe(false);
        expect(resultado.motivo).toMatch(/normales/i);
    });
});

describe('armarFilasEmpleadoPlanillaUnica (CA1 — 21 columnas, fila repetida por código múltiple)', () => {
    const empleadoBase = {
        id: 'emp1',
        nombreCompleto: 'Juan Pérez López',
        dui: '02697943-9',
        fechaIngreso: '2020-01-01',
        tipoAfiliacion: 'afp_crecer' as const,
        numeroAfiliadoIsss: '123456',
        afpOrigenJubilado: null,
    };
    const empresa = { nitDuiEmpleador: '061012345678', numeroPatronalIsss: '9998' };
    const periodo = { mes0: 5, anio: 2026, fechaInicioMes: '2026-06-01', fechaFinMes: '2026-06-30' };
    const sinEventos = { totalIngresosGravablesPorQuincena: [238, 238], vacacionesDelMes: { montoTotal: 0, diasGozados: 0 }, tieneIncapacidadEsteMes: false };

    it('arma 1 sola fila cuando no hay ningún código de observación aplicable, columna 20 fija en 01', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, sinEventos);
        expect(filas).toHaveLength(1);
        expect(filas[0].codigoObservacion1).toBe('01');
        expect(filas[0].codigoObservacion2).toBe('');
    });

    it('Salario = suma de total_ingresos_gravables de ambas quincenas del mes', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, sinEventos);
        expect(filas[0].salario).toBe(476);
    });

    it('columnas 9-13 (nombres/apellidos separados) siempre vacías — nunca se inventa un split', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, sinEventos);
        expect(filas[0].primerNombre).toBe('');
        expect(filas[0].segundoNombre).toBe('');
        expect(filas[0].primerApellido).toBe('');
        expect(filas[0].segundoApellido).toBe('');
        expect(filas[0].apellidoCasada).toBe('');
    });

    it('columna 15 (Pago adicional) siempre vacía — sin definición confirmada', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, sinEventos);
        expect(filas[0].pagoAdicional).toBe('');
    });

    it('DUI limpio, tipo documento y correlativo fijo en cada fila', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, sinEventos);
        expect(filas[0].numeroDocumentoAfiliado).toBe('026979439');
        expect(filas[0].tipoDocumentoAfiliado).toBe('01');
        expect(filas[0].correlativoCentroTrabajo).toBe('001');
        expect(filas[0].periodo).toBe('062026');
        expect(filas[0].dias).toBe(30);
        expect(filas[0].horas).toBe('08');
    });

    it('nuevo ingreso este mes agrega código 08', () => {
        const filas = armarFilasEmpleadoPlanillaUnica({ ...empleadoBase, fechaIngreso: '2026-06-10' }, empresa, periodo, sinEventos);
        expect(filas).toHaveLength(1);
        expect(filas[0].codigoObservacion2).toBe('08');
    });

    it('incapacidad este mes agrega código 06', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, { ...sinEventos, tieneIncapacidadEsteMes: true });
        expect(filas).toHaveLength(1);
        expect(filas[0].codigoObservacion2).toBe('06');
    });

    it('vacación pagada este mes agrega código 09, con monto y días', () => {
        const datosMes = { ...sinEventos, vacacionesDelMes: { montoTotal: 121.28, diasGozados: 5 } };
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, datosMes);
        expect(filas).toHaveLength(1);
        expect(filas[0].codigoObservacion2).toBe('09');
        expect(filas[0].montoVacacion).toBe(121.28);
        expect(filas[0].diasVacacion).toBe(5);
    });

    it('jubilado agrega código 04 (vía resolverInstitucionPrevisionalPlanillaUnica) antes que los códigos de evento', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(
            { ...empleadoBase, tipoAfiliacion: 'jubilado', afpOrigenJubilado: 'afp_confia', fechaIngreso: '2026-06-10' },
            empresa, periodo, sinEventos,
        );
        expect(filas).toHaveLength(2);
        expect(filas[0].codigoObservacion2).toBe('04');
        expect(filas[0].institucionPrevisional).toBe('COF');
        expect(filas[1].codigoObservacion2).toBe('08');
    });

    it('más de 2 códigos aplicables repite la fila una vez por código, todos los demás campos idénticos', () => {
        const datosMes = { totalIngresosGravablesPorQuincena: [238, 238], vacacionesDelMes: { montoTotal: 50, diasGozados: 2 }, tieneIncapacidadEsteMes: true };
        const filas = armarFilasEmpleadoPlanillaUnica({ ...empleadoBase, fechaIngreso: '2026-06-10' }, empresa, periodo, datosMes);
        expect(filas).toHaveLength(3);
        expect(filas.map((f) => f.codigoObservacion2)).toEqual(['08', '06', '09']);
        expect(new Set(filas.map((f) => f.salario)).size).toBe(1);
        expect(new Set(filas.map((f) => f.numeroDocumentoAfiliado)).size).toBe(1);
    });

    it('empleado con un solo cálculo en el mes (dado de alta a mitad de mes) suma solo ese', () => {
        const filas = armarFilasEmpleadoPlanillaUnica(empleadoBase, empresa, periodo, { ...sinEventos, totalIngresosGravablesPorQuincena: [238] });
        expect(filas[0].salario).toBe(238);
    });
});
