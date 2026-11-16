import { describe, it, expect } from 'vitest';
import { agruparPorEmpleadoYDia, detectarCorto, compensarCortosPorEmpleado, validarAcumulados, revalidarFila, aplicarAusencias, detectarEmpleadosDuplicados, detectarAusenciasInjustificadas, construirFilasDesdeConfirmadas, type EmpleadoMatch, type FilaValidacion, type AusenciaActiva, type PermisoRegistrado, type ContextoCalculoHoras, type TramoMarcacionConfirmada } from './marcacionesValidacionUtils';
import type { MarcacionCruda } from './excelUtils';

const EMPLEADOS: EmpleadoMatch[] = [
    { id: 'emp-1', codigo_empleado_manual: 'R001', nombre_completo: 'Juan Pérez', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null },
    { id: 'emp-2', codigo_empleado_manual: 'R002', nombre_completo: 'Ana Gómez', estado: 'inactivo', cargo: null, departamento: null, sueldo_mensual: null },
];

// IMPL-22 — sin overrides de jornada ni feriados: estos tests cubren matching/validación, no
// el cálculo de HED/HEN/Nocturnidad/Feriado en sí (ver horasExtrasUtils.test.ts para eso).
const CONTEXTO_VACIO: ContextoCalculoHoras = { overrides: [], feriados: new Set() };

const QUINCENA_INICIO = '2026-07-16';
const QUINCENA_FIN = '2026-07-31';

function marcacion(idUsuario: string, fecha: string, entrada: string, salida: string, nombre = ''): MarcacionCruda {
    return { idUsuario, nombreCompleto: nombre, fecha, horaEntrada: entrada, horaSalida: salida };
}

describe('agruparPorEmpleadoYDia (US-HEX-04, IMPL-23)', () => {
    it('matchea un empleado por codigo_empleado_manual y arma un tramo', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas).toHaveLength(1);
        expect(filas[0].empleadoId).toBe('emp-1');
        expect(filas[0].errores).toHaveLength(0);
        expect(filas[0].tramos).toEqual([{ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T17:00:00' }]);
    });

    it('matchea el código sin importar mayúsculas/minúsculas (bug reportado: "EMP-2020-001" no matcheaba)', () => {
        const empleados: EmpleadoMatch[] = [{ id: 'emp-3', codigo_empleado_manual: 'emp-2020-001', nombre_completo: 'Carla Ruiz', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null }];
        const filas = agruparPorEmpleadoYDia([marcacion('EMP-2020-001', '2026-07-20', '08:00', '17:00')], empleados, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoId).toBe('emp-3');
        expect(filas[0].errores).toHaveLength(0);
    });

    it('matchea el código aunque el guardado en el perfil tenga espacios de más', () => {
        const empleados: EmpleadoMatch[] = [{ id: 'emp-4', codigo_empleado_manual: ' R010 ', nombre_completo: 'Diego Soto', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null }];
        const filas = agruparPorEmpleadoYDia([marcacion('R010', '2026-07-20', '08:00', '17:00')], empleados, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoId).toBe('emp-4');
        expect(filas[0].errores).toHaveLength(0);
    });

    it('marca Error cuando el ID de usuario no matchea ningún empleado (CA1)', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R999', '2026-07-20', '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoId).toBeNull();
        expect(filas[0].errores.length).toBeGreaterThan(0);
    });

    it('defecto real (2026-09-23) — el error de "empleado no encontrado" incluye el nombre del archivo, no solo el ID', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R999', '2026-07-20', '08:00', '17:00', 'Roberto Carlos Aguilar')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].errores[0]).toContain('Roberto Carlos Aguilar');
    });

    it('defecto real (2026-09-23) — advierte si el nombre del archivo no se parece al nombre del empleado matcheado por ID (CA de validación cruzada)', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '08:00', '17:00', 'María Elena Castro')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoId).toBe('emp-1'); // matcheó por ID igual
        expect(filas[0].advertencias.some((a) => a.includes('no se parece al nombre registrado'))).toBe(true);
    });

    it('defecto real (2026-09-23) — NO advierte si el nombre del archivo coincide (con variantes de tilde/mayúsculas) con el del empleado matcheado', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '08:00', '17:00', 'juan perez')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].advertencias.some((a) => a.includes('no se parece al nombre registrado'))).toBe(false);
    });

    it('caso real (2026-09-23, Hernán Osorio) — si el ID no matchea a nadie pero el nombre coincide completo con un empleado, se asigna por nombre en vez de quedar "no encontrado"', () => {
        const empleados: EmpleadoMatch[] = [
            ...EMPLEADOS,
            { id: 'emp-5', codigo_empleado_manual: '17', nombre_completo: 'Hernán Edgardo Osorio Barahona', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null },
        ];
        const filas = agruparPorEmpleadoYDia([marcacion('2', '2026-07-20', '08:00', '17:00', 'HERNAN EDGARDO OSORIO BARAHONA')], empleados, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoId).toBe('emp-5');
        expect(filas[0].errores).toHaveLength(0);
        expect(filas[0].advertencias.some((a) => a.includes('se asignó por nombre'))).toBe(true);
    });

    it('el match por nombre exige el mismo umbral (80%) que la validación cruzada — un nombre parecido pero no suficiente no autoasigna', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R999', '2026-07-20', '08:00', '17:00', 'Pedro Gómez')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoId).toBeNull();
        expect(filas[0].errores.length).toBeGreaterThan(0);
    });

    it('un código ambiguo (compartido por 2 empleados) NO intenta match por nombre — se exige asignación manual igual', () => {
        const empleados: EmpleadoMatch[] = [
            { id: 'emp-6', codigo_empleado_manual: 'R700', nombre_completo: 'Hernán Edgardo Osorio Barahona', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null },
            { id: 'emp-7', codigo_empleado_manual: 'r700', nombre_completo: 'Otro Empleado Cualquiera', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null },
        ];
        const filas = agruparPorEmpleadoYDia([marcacion('R700', '2026-07-20', '08:00', '17:00', 'HERNAN EDGARDO OSORIO BARAHONA')], empleados, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoId).toBeNull();
        expect(filas[0].errores.some((e) => e.includes('más de un empleado'))).toBe(true);
    });

    it('gap real IMPL-28 (2026-09-24) — advierte y guarda empleadoUbicacionId cuando el empleado pertenece a otra ubicación que la pantalla actual', () => {
        const empleados: EmpleadoMatch[] = [
            { id: 'emp-8', codigo_empleado_manual: 'R800', nombre_completo: 'Empleado Otra Sede', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null, ubicacion_id: 'ubic-2' },
        ];
        const filas = agruparPorEmpleadoYDia([marcacion('R800', '2026-07-20', '08:00', '17:00')], empleados, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoUbicacionId).toBe('ubic-2');
        expect(filas[0].advertencias.some((a) => a.includes('pertenece a otra ubicación'))).toBe(true);
    });

    it('IMPL-28 — NO advierte si el empleado pertenece a la misma ubicación que la pantalla actual', () => {
        const empleados: EmpleadoMatch[] = [
            { id: 'emp-9', codigo_empleado_manual: 'R900', nombre_completo: 'Empleado Misma Sede', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null, ubicacion_id: 'ubic-1' },
        ];
        const filas = agruparPorEmpleadoYDia([marcacion('R900', '2026-07-20', '08:00', '17:00')], empleados, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoUbicacionId).toBe('ubic-1');
        expect(filas[0].advertencias.some((a) => a.includes('pertenece a otra ubicación'))).toBe(false);
    });

    it('IMPL-28 — empleadoUbicacionId queda null si el empleado no tiene ubicación asignada en su perfil, sin advertir', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].empleadoUbicacionId).toBeNull();
        expect(filas[0].advertencias.some((a) => a.includes('pertenece a otra ubicación'))).toBe(false);
    });

    it('agrupa 2 filas del mismo día en 2 tramos y advierte (CA4, almuerzo separado)', () => {
        const filas = agruparPorEmpleadoYDia(
            [marcacion('R001', '2026-07-20', '08:00', '12:00'), marcacion('R001', '2026-07-20', '13:00', '17:00')],
            EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1'
        );
        expect(filas).toHaveLength(1);
        expect(filas[0].tramos).toHaveLength(2);
        expect(filas[0].advertencias.some((a) => a.includes('marcaciones para este día'))).toBe(true);
    });

    it('detecta un tramo duplicado idéntico y lo descarta de los tramos efectivos', () => {
        const filas = agruparPorEmpleadoYDia(
            [marcacion('R001', '2026-07-20', '08:00', '17:00'), marcacion('R001', '2026-07-20', '08:00', '17:00')],
            EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1'
        );
        expect(filas[0].tramos).toHaveLength(1);
        expect(filas[0].advertencias.some((a) => a.includes('duplicado'))).toBe(true);
    });

    it('marca Advertencia cuando el empleado está inactivo (CA5)', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R002', '2026-07-20', '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].advertencias.some((a) => a.includes('Inactivo'))).toBe(true);
    });

    it('marca Error cuando la fecha cae fuera del rango de la quincena seleccionada', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-08-05', '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].errores.some((e) => e.includes('fuera del rango'))).toBe(true);
    });

    // Hallazgo UAT 2026-10-19 (confirmado por Gilda/Imporfrut): el reloj marcador está
    // configurado en 24 horas y usa 00:00 para dos cosas distintas — día sin marcación real, o
    // punto de corte/reanudación de un turno que cruza medianoche.
    it('día con entrada y salida 00:00 (sin marcación real, ej. ausencia/descanso) da 0 horas, sin tramo ni error', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '00:00', '00:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].tramos).toHaveLength(0);
        expect(filas[0].errores).toHaveLength(0);
        expect(filas[0].horasRegulares).toBe(0);
    });

    it('turno que cruza medianoche (par inequívoco al día siguiente) se cose en un solo tramo, atribuido al día que entró', () => {
        const filas = agruparPorEmpleadoYDia(
            [marcacion('R001', '2026-07-20', '20:59', '00:00'), marcacion('R001', '2026-07-21', '00:00', '09:16')],
            EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1'
        );
        expect(filas).toHaveLength(1); // la fila del día 21 se consume, no genera fila propia
        expect(filas[0].fecha).toBe('2026-07-20');
        expect(filas[0].tramos).toEqual([{ entrada: '2026-07-20T20:59:00', salida: '2026-07-21T09:16:00' }]);
        expect(filas[0].errores).toHaveLength(0);
        expect(filas[0].informativos.some((i) => i.includes('cruza medianoche'))).toBe(true);
    });

    it('salida en 00:00 SIN pareja clara al día siguiente (hueco, o el día siguiente no vino en el archivo) sigue dando error, explicando la causa real', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '20:59', '00:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1');
        expect(filas[0].errores.some((e) => e.includes('el reloj marcador usa 00:00'))).toBe(true);
    });

    it('no cose si hay AMBIGÜEDAD — 2 filas "abiertas" el mismo día (no se puede saber cuál sigue)', () => {
        const filas = agruparPorEmpleadoYDia(
            [
                marcacion('R001', '2026-07-20', '08:00', '12:00'),
                marcacion('R001', '2026-07-20', '20:59', '00:00'),
                marcacion('R001', '2026-07-20', '21:30', '00:00'),
                marcacion('R001', '2026-07-21', '00:00', '09:16'),
            ],
            EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1'
        );
        const filaDia20 = filas.find((f) => f.fecha === '2026-07-20')!;
        expect(filaDia20.errores.length).toBeGreaterThan(0); // los 2 tramos "abiertos" quedan sin coser
    });
});

describe('detectarCorto (US-HEX-09/IMPL-27 CA1)', () => {
    it('devuelve las horas faltantes cuando se trabajó menos que la jornada ordinaria', () => {
        expect(detectarCorto([{ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T14:00:00' }], 8)).toBe(2);
    });

    it('devuelve 0 cuando se cumplió o superó la jornada ordinaria', () => {
        expect(detectarCorto([{ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T17:00:00' }], 8)).toBe(0);
    });
});

describe('compensarCortosPorEmpleado (US-HEX-09/IMPL-27 — Perdón de Saldo Negativo)', () => {
    function filaConHoras(empleadoId: string | null, hed: number, hen: number, corto: number, descartada = false): FilaValidacion {
        return {
            idUsuarioArchivo: 'R001', nombreArchivo: '', fecha: '2026-07-20', tramos: [],
            empleadoId, empleadoNombre: empleadoId ? 'Juan Pérez' : null, empleadoEstado: empleadoId ? 'activo' : null,
            empleadoCargo: null, empleadoDepartamento: null, empleadoUbicacionId: null,
            horasRegulares: 8, hed, hen, nocturnidad: 0, feriado: 0, corto,
            errores: [], advertencias: [], informativos: [], descartada, editadoManualmente: false,
        };
    }

    it('CA1 — el corto se resta primero de HEN', () => {
        // Día 1: 3h HEN, sin corto. Día 2: sin extra, 1h de corto.
        const filas = [filaConHoras('emp-1', 0, 3, 0), filaConHoras('emp-1', 0, 0, 1)];
        const resultado = compensarCortosPorEmpleado(filas).get('emp-1');
        expect(resultado).toMatchObject({ hen: 2, hed: 0, cortoDescartado: 0 });
    });

    it('CA1 — si el corto supera el HEN disponible, el remanente se resta del HED', () => {
        // HEN total 1h, HED total 5h, corto total 3h -> HEN queda en 0, remanente 2h sale del HED.
        const filas = [filaConHoras('emp-1', 5, 1, 0), filaConHoras('emp-1', 0, 0, 3)];
        const resultado = compensarCortosPorEmpleado(filas).get('emp-1');
        expect(resultado).toMatchObject({ hen: 0, hed: 3, cortoDescartado: 0 });
    });

    it('CA2 — si el corto supera TODA la hora extra disponible, el remanente se descarta (nunca queda negativo)', () => {
        const filas = [filaConHoras('emp-1', 1, 1, 0), filaConHoras('emp-1', 0, 0, 10)];
        const resultado = compensarCortosPorEmpleado(filas).get('emp-1');
        expect(resultado).toMatchObject({ hen: 0, hed: 0, cortoDescartado: 8 });
    });

    it('la compensación es por PERÍODO completo (todos los días del empleado), no día por día', () => {
        // Día 1: 2h de corto, sin HEN ese día. Día 2: 2h HEN, sin corto ese día. Se compensan
        // entre sí igual, porque la regla opera sobre el total de la quincena.
        const filas = [filaConHoras('emp-1', 0, 0, 2), filaConHoras('emp-1', 0, 2, 0)];
        const resultado = compensarCortosPorEmpleado(filas).get('emp-1');
        expect(resultado).toMatchObject({ hen: 0, hed: 0, cortoDescartado: 0 });
    });

    it('nocturnidad y feriado no se tocan por la compensación', () => {
        const filas = [filaConHoras('emp-1', 0, 0, 5)];
        filas[0].nocturnidad = 4;
        filas[0].feriado = 2;
        const resultado = compensarCortosPorEmpleado(filas).get('emp-1');
        expect(resultado).toMatchObject({ nocturnidad: 4, feriado: 2 });
    });

    it('ignora filas descartadas o sin empleado asignado', () => {
        const filas = [filaConHoras('emp-1', 0, 5, 0), filaConHoras('emp-1', 0, 0, 3, true), filaConHoras(null, 0, 0, 3)];
        const resultado = compensarCortosPorEmpleado(filas).get('emp-1');
        // La fila descartada (3h de corto) no debe restar nada — el HEN queda intacto.
        expect(resultado).toMatchObject({ hen: 5 });
    });

    it('varios empleados se compensan de forma independiente', () => {
        const filas = [filaConHoras('emp-1', 0, 5, 2), filaConHoras('emp-2', 0, 1, 3)];
        const resultado = compensarCortosPorEmpleado(filas);
        expect(resultado.get('emp-1')).toMatchObject({ hen: 3 });
        expect(resultado.get('emp-2')).toMatchObject({ hen: 0, cortoDescartado: 2 });
    });
});

describe('validarAcumulados (US-HEX-04, IMPL-23 CA6)', () => {
    it('marca a un empleado sobre 120h combinando lo persistido con el lote actual (CA3)', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '08:00', '20:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1'); // 12h
        const existentes = [{ empleado_id: 'emp-1', entrada: '2026-07-17T00:00:00', salida: '2026-07-22T12:00:00' }]; // 108h
        const resultado = validarAcumulados(filas, existentes);
        expect(resultado.empleadosSobre120h).toContain('Juan Pérez');
    });

    it('no marca a nadie sobre 120h si el acumulado no lo supera', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '08:00', '16:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1'); // 8h
        const resultado = validarAcumulados(filas, []);
        expect(resultado.empleadosSobre120h).toHaveLength(0);
    });

    it('detecta domingo trabajado y si superó las 44h semanales Lunes-Sábado (CA6)', () => {
        // 2026-07-19 es domingo. Lunes-Sábado con 46h acumuladas -> supera el umbral.
        const filas = agruparPorEmpleadoYDia(
            [
                marcacion('R001', '2026-07-13', '06:00', '20:00'), // Lunes 13/07/2026, 14h
                marcacion('R001', '2026-07-14', '06:00', '18:00'), // Martes, 12h
                marcacion('R001', '2026-07-15', '06:00', '18:00'), // Miércoles, 12h
                marcacion('R001', '2026-07-16', '06:00', '14:00'), // Jueves, 8h
                marcacion('R001', '2026-07-19', '08:00', '12:00'), // Domingo, 4h
            ],
            EMPLEADOS, '2026-07-01', '2026-07-31', CONTEXTO_VACIO, 'ubic-1'
        );
        const resultado = validarAcumulados(filas, []);
        expect(resultado.empleadosDomingoTrabajado).toHaveLength(1);
        expect(resultado.empleadosDomingoTrabajado[0].horasLunesASabado).toBe(46);
        expect(resultado.empleadosDomingoTrabajado[0].superoUmbral44h).toBe(true);
    });

    it('domingo trabajado sin superar las 44h queda marcado como tal', () => {
        const filas = agruparPorEmpleadoYDia(
            [
                marcacion('R001', '2026-07-13', '08:00', '16:00'), // Lunes, 8h
                marcacion('R001', '2026-07-19', '08:00', '12:00'), // Domingo, 4h
            ],
            EMPLEADOS, '2026-07-01', '2026-07-31', CONTEXTO_VACIO, 'ubic-1'
        );
        const resultado = validarAcumulados(filas, []);
        expect(resultado.empleadosDomingoTrabajado[0].superoUmbral44h).toBe(false);
    });
});

describe('revalidarFila (US-HEX-05 CA1/CA2)', () => {
    function filaBase(): FilaValidacion {
        return agruparPorEmpleadoYDia([marcacion('R999', '2026-07-20', '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1')[0];
    }

    it('marca editadoManualmente=true tras revalidar', () => {
        const fila = revalidarFila(filaBase(), QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO);
        expect(fila.editadoManualmente).toBe(true);
    });

    it('una fila sin match deja de tener Error cuando se le asigna un empleado a mano', () => {
        const fila = { ...filaBase(), empleadoId: 'emp-1', empleadoNombre: 'Juan Pérez', empleadoEstado: 'activo' as const };
        const revalidada = revalidarFila(fila, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO);
        expect(revalidada.errores).toHaveLength(0);
    });

    it('detecta un tramo inválido (salida <= entrada) tras editar la hora a mano', () => {
        const fila = { ...filaBase(), empleadoId: 'emp-1', empleadoNombre: 'Juan Pérez', empleadoEstado: 'activo' as const };
        fila.tramos = [{ entrada: '2026-07-20T10:00:00', salida: '2026-07-20T09:00:00' }];
        const revalidada = revalidarFila(fila, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO);
        expect(revalidada.errores.some((e) => e.includes('posterior'))).toBe(true);
    });
});

describe('aplicarAusencias (US-HEX-04 CA7, revisión épica por épica)', () => {
    function fila(empleadoId: string, fecha: string): FilaValidacion {
        return agruparPorEmpleadoYDia([marcacion('R001', fecha, '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1')
            .map((f) => ({ ...f, empleadoId, empleadoNombre: 'Juan Pérez' }))[0];
    }

    it('advierte si el empleado tiene una incapacidad activa ese día', () => {
        const ausencias: AusenciaActiva[] = [{ empleado_id: 'emp-1', fecha_inicio: '2026-07-18', fecha_fin: '2026-07-22', tipo: 'incapacidad' }];
        const [resultado] = aplicarAusencias([fila('emp-1', '2026-07-20')], ausencias);
        expect(resultado.advertencias.some((a) => a.includes('incapacidad activa'))).toBe(true);
    });

    it('advierte si el empleado tiene vacaciones activas ese día', () => {
        const ausencias: AusenciaActiva[] = [{ empleado_id: 'emp-1', fecha_inicio: '2026-07-20', fecha_fin: '2026-07-20', tipo: 'vacacion' }];
        const [resultado] = aplicarAusencias([fila('emp-1', '2026-07-20')], ausencias);
        expect(resultado.advertencias.some((a) => a.includes('vacaciones activas'))).toBe(true);
    });

    it('no advierte si la fecha de la marcación cae fuera del rango de la ausencia', () => {
        const ausencias: AusenciaActiva[] = [{ empleado_id: 'emp-1', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-10', tipo: 'incapacidad' }];
        const [resultado] = aplicarAusencias([fila('emp-1', '2026-07-20')], ausencias);
        expect(resultado.advertencias).toHaveLength(0);
    });

    it('no advierte si la ausencia es de otro empleado', () => {
        const ausencias: AusenciaActiva[] = [{ empleado_id: 'emp-2', fecha_inicio: '2026-07-20', fecha_fin: '2026-07-20', tipo: 'incapacidad' }];
        const [resultado] = aplicarAusencias([fila('emp-1', '2026-07-20')], ausencias);
        expect(resultado.advertencias).toHaveLength(0);
    });
});

// IMPL-82 (US-HEX-08) — quincena acotada a domingo+lunes+martes (2026-07-19/20/21):
// jornada por defecto es 8h lunes-viernes, así que lunes/martes son días esperados y domingo
// nunca lo es (ver jornadaUtils.ts), suficiente para cubrir los 4 casos sin un rango largo.
describe('detectarAusenciasInjustificadas (US-HEX-08 CA1/CA2/CA3)', () => {
    const ROSTER: EmpleadoMatch[] = [
        { id: 'emp-1', codigo_empleado_manual: 'R001', nombre_completo: 'Juan Pérez', estado: 'activo', cargo: null, departamento: null, sueldo_mensual: null },
    ];
    const INICIO = '2026-07-19'; // domingo
    const FIN = '2026-07-21'; // martes

    it('reporta un día esperado sin marcación y sin ninguna justificación (CA1)', () => {
        const resultado = detectarAusenciasInjustificadas(ROSTER, [], [], [], INICIO, FIN, CONTEXTO_VACIO);
        const fechas = resultado.map((r) => r.fecha).sort();
        expect(fechas).toEqual(['2026-07-20', '2026-07-21']);
        expect(resultado.every((r) => r.empleadoId === 'emp-1' && r.empleadoNombre === 'Juan Pérez')).toBe(true);
    });

    it('nunca reporta domingo, aunque no haya marcación (CA1)', () => {
        const resultado = detectarAusenciasInjustificadas(ROSTER, [], [], [], INICIO, FIN, CONTEXTO_VACIO);
        expect(resultado.some((r) => r.fecha === '2026-07-19')).toBe(false);
    });

    it('no reporta un día cubierto por un feriado, aunque no haya marcación (CA2)', () => {
        const contexto: ContextoCalculoHoras = { overrides: [], feriados: new Set(['2026-07-21']) };
        const resultado = detectarAusenciasInjustificadas(ROSTER, [], [], [], INICIO, FIN, contexto);
        expect(resultado.some((r) => r.fecha === '2026-07-21')).toBe(false);
        expect(resultado.some((r) => r.fecha === '2026-07-20')).toBe(true);
    });

    it('no reporta un día cubierto por una incapacidad activa (CA2)', () => {
        const ausencias: AusenciaActiva[] = [{ empleado_id: 'emp-1', fecha_inicio: '2026-07-20', fecha_fin: '2026-07-20', tipo: 'incapacidad' }];
        const resultado = detectarAusenciasInjustificadas(ROSTER, [], ausencias, [], INICIO, FIN, CONTEXTO_VACIO);
        expect(resultado.map((r) => r.fecha)).toEqual(['2026-07-21']);
    });

    it('no reporta un día cubierto por un permiso registrado, con o sin goce (CA2)', () => {
        const permisos: PermisoRegistrado[] = [{ empleado_id: 'emp-1', fecha: '2026-07-20' }];
        const resultado = detectarAusenciasInjustificadas(ROSTER, [], [], permisos, INICIO, FIN, CONTEXTO_VACIO);
        expect(resultado.map((r) => r.fecha)).toEqual(['2026-07-21']);
    });

    it('no reporta un día donde el empleado SÍ tiene marcación en el lote (CA1, por contraste)', () => {
        const filas = agruparPorEmpleadoYDia([marcacion('R001', '2026-07-20', '08:00', '17:00')], ROSTER, INICIO, FIN, CONTEXTO_VACIO, 'ubic-1');
        const resultado = detectarAusenciasInjustificadas(ROSTER, filas, [], [], INICIO, FIN, CONTEXTO_VACIO);
        expect(resultado.map((r) => r.fecha)).toEqual(['2026-07-21']);
    });

    it('ignora empleados inactivos del roster, aunque no tengan marcación', () => {
        const rosterConInactivo: EmpleadoMatch[] = [
            ...ROSTER,
            { id: 'emp-2', codigo_empleado_manual: 'R002', nombre_completo: 'Ana Gómez', estado: 'inactivo', cargo: null, departamento: null, sueldo_mensual: null },
        ];
        const resultado = detectarAusenciasInjustificadas(rosterConInactivo, [], [], [], INICIO, FIN, CONTEXTO_VACIO);
        expect(resultado.every((r) => r.empleadoId === 'emp-1')).toBe(true);
    });
});

describe('detectarEmpleadosDuplicados (IMPL-24, revisión épica por épica)', () => {
    function filaConId(idArchivo: string, empleadoId: string, fecha: string): FilaValidacion {
        return agruparPorEmpleadoYDia([marcacion(idArchivo, fecha, '08:00', '17:00')], EMPLEADOS, QUINCENA_INICIO, QUINCENA_FIN, CONTEXTO_VACIO, 'ubic-1')
            .map((f) => ({ ...f, empleadoId, empleadoNombre: 'Juan Pérez' }))[0];
    }

    it('advierte a ambas filas si el mismo empleado queda repetido el mismo día tras una reasignación manual', () => {
        const filas = [filaConId('R001', 'emp-1', '2026-07-20'), filaConId('R999', 'emp-1', '2026-07-20')];
        const resultado = detectarEmpleadosDuplicados(filas);
        expect(resultado[0].advertencias.some((a) => a.includes('más de una vez'))).toBe(true);
        expect(resultado[1].advertencias.some((a) => a.includes('más de una vez'))).toBe(true);
    });

    it('no advierte si el mismo empleado tiene filas en días distintos', () => {
        const filas = [filaConId('R001', 'emp-1', '2026-07-20'), filaConId('R999', 'emp-1', '2026-07-21')];
        const resultado = detectarEmpleadosDuplicados(filas);
        expect(resultado.every((f) => f.advertencias.length === 0)).toBe(true);
    });

    it('ignora filas descartadas al contar duplicados', () => {
        const filas = [filaConId('R001', 'emp-1', '2026-07-20'), { ...filaConId('R999', 'emp-1', '2026-07-20'), descartada: true }];
        const resultado = detectarEmpleadosDuplicados(filas);
        expect(resultado[0].advertencias).toHaveLength(0);
    });
});

// Pedido real del jefe (2026-09-23, parte 2) — reabrir un módulo confirmado reconstruye filas
// EDITABLES a partir de lo ya persistido en vez de forzar re-subir el Excel completo.
describe('construirFilasDesdeConfirmadas (Reabrir sin re-subir el Excel)', () => {
    function tramoConfirmado(overrides: Partial<TramoMarcacionConfirmada> = {}): TramoMarcacionConfirmada {
        return {
            empleadoId: 'emp-1',
            entrada: '2026-07-20T08:00:00',
            salida: '2026-07-20T17:00:00',
            idUsuarioArchivo: 'R001',
            editadoManualmente: false,
            empleadoNombre: 'Juan Pérez',
            empleadoEstado: 'activo',
            empleadoCargo: null,
            empleadoDepartamento: null,
            ...overrides,
        };
    }

    it('reconstruye una fila editable por (empleado, fecha) a partir de un tramo confirmado', () => {
        const filas = construirFilasDesdeConfirmadas([tramoConfirmado()], CONTEXTO_VACIO);
        expect(filas).toHaveLength(1);
        expect(filas[0].empleadoId).toBe('emp-1');
        expect(filas[0].empleadoNombre).toBe('Juan Pérez');
        expect(filas[0].fecha).toBe('2026-07-20');
        expect(filas[0].descartada).toBe(false);
        expect(filas[0].errores).toHaveLength(0);
    });

    it('agrupa 2 tramos del mismo empleado y día (almuerzo separado) en una sola fila y advierte', () => {
        const filas = construirFilasDesdeConfirmadas([
            tramoConfirmado({ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T12:00:00' }),
            tramoConfirmado({ entrada: '2026-07-20T13:00:00', salida: '2026-07-20T17:00:00' }),
        ], CONTEXTO_VACIO);
        expect(filas).toHaveLength(1);
        expect(filas[0].tramos).toHaveLength(2);
        expect(filas[0].advertencias.some((a) => a.includes('marcaciones para este día'))).toBe(true);
    });

    it('separa en 2 filas si el mismo empleado tiene tramos en días distintos', () => {
        const filas = construirFilasDesdeConfirmadas([
            tramoConfirmado({ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T17:00:00' }),
            tramoConfirmado({ entrada: '2026-07-21T08:00:00', salida: '2026-07-21T17:00:00' }),
        ], CONTEXTO_VACIO);
        expect(filas).toHaveLength(2);
    });

    it('separa en 2 filas si 2 empleados distintos comparten el mismo día', () => {
        const filas = construirFilasDesdeConfirmadas([
            tramoConfirmado({ empleadoId: 'emp-1' }),
            tramoConfirmado({ empleadoId: 'emp-2', empleadoNombre: 'Ana Gómez' }),
        ], CONTEXTO_VACIO);
        expect(filas).toHaveLength(2);
    });

    it('advierte si el empleado está Inactivo', () => {
        const filas = construirFilasDesdeConfirmadas([tramoConfirmado({ empleadoEstado: 'inactivo' })], CONTEXTO_VACIO);
        expect(filas[0].advertencias.some((a) => a.includes('Inactivo'))).toBe(true);
    });

    it('editadoManualmente queda en true si CUALQUIERA de los tramos del día lo tenía', () => {
        const filas = construirFilasDesdeConfirmadas([
            tramoConfirmado({ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T12:00:00', editadoManualmente: false }),
            tramoConfirmado({ entrada: '2026-07-20T13:00:00', salida: '2026-07-20T17:00:00', editadoManualmente: true }),
        ], CONTEXTO_VACIO);
        expect(filas[0].editadoManualmente).toBe(true);
    });
});
