import { describe, it, expect } from 'vitest';
import { armarScheduleCuotas, type QuincenaScheduleLike, type EventoCuotaLike } from './anticipoCuotasUtils';

function q(id: string, inicio: string, fin: string, etiqueta: string): QuincenaScheduleLike {
    return { id, fecha_inicio: inicio, fecha_fin: fin, etiqueta_estandar: etiqueta };
}

function pago(quincenaId: string, monto: number): EventoCuotaLike {
    return { quincena_id: quincenaId, tipo: 'pago', monto, motivo_suspension: null };
}

function suspension(quincenaId: string, motivo: string): EventoCuotaLike {
    return { quincena_id: quincenaId, tipo: 'suspension', monto: null, motivo_suspension: motivo };
}

// Quincenas reales de un tenant con historial completo (feb-abr 2026).
const QUINCENAS_REALES = [
    q('q1', '2026-02-01', '2026-02-15', '1ra Quincena de Febrero 2026'),
    q('q2', '2026-02-16', '2026-02-28', '2da Quincena de Febrero 2026'),
    q('q3', '2026-03-01', '2026-03-15', '1ra Quincena de Marzo 2026'),
    q('q4', '2026-03-16', '2026-03-31', '2da Quincena de Marzo 2026'),
    q('q5', '2026-04-01', '2026-04-15', '1ra Quincena de Abril 2026'),
    q('q6', '2026-04-16', '2026-04-30', '2da Quincena de Abril 2026'),
];

describe('armarScheduleCuotas (US-ANT-03 CA1, defecto UAT)', () => {
    it('muestra todas las cuotas del schedule con quincenas reales, monto siempre visible', () => {
        const filas = armarScheduleCuotas('2026-02-01', 100, 6, QUINCENAS_REALES, [
            pago('q1', 100), pago('q2', 100), pago('q3', 100), pago('q4', 100),
        ], 'activo');

        expect(filas).toHaveLength(6);
        expect(filas.map((f) => f.estado)).toEqual(['pagada', 'pagada', 'pagada', 'pagada', 'pendiente', 'pendiente']);
        // Todas las filas tienen monto, incluso las pendientes (antes mostraba '—').
        expect(filas.every((f) => f.monto === 100)).toBe(true);
        expect(filas.every((f) => !f.esProyectada)).toBe(true);
    });

    it('proyecta las cuotas futuras faltantes cuando el tenant solo tiene la quincena actual (caso UAT)', () => {
        // Tenant con UNA sola quincena (la actual, 1ra Ago) y anticipo de 4 cuotas desde 2da Jul.
        const filas = armarScheduleCuotas('2026-07-10', 100, 4, [
            q('qAgo', '2026-08-01', '2026-08-15', '1ra Quincena de Agosto 2026'),
        ], [], 'activo');

        expect(filas).toHaveLength(4);
        expect(filas[0]).toMatchObject({ etiqueta: '1ra Quincena de Agosto 2026', estado: 'pendiente', esProyectada: false });
        // Cuotas futuras proyectadas con cadencia 1ra/2da.
        expect(filas[1]).toMatchObject({ etiqueta: '2da Quincena de Agosto 2026', estado: 'pendiente', esProyectada: true });
        expect(filas[2]).toMatchObject({ etiqueta: '1ra Quincena de Septiembre 2026', estado: 'pendiente', esProyectada: true });
        expect(filas[3]).toMatchObject({ etiqueta: '2da Quincena de Septiembre 2026', estado: 'pendiente', esProyectada: true });
        expect(filas.every((f) => f.monto === 100)).toBe(true);
    });

    it('proyecta todas las cuotas si ninguna quincena real es aplicable aún (vale futuro)', () => {
        // Vale el día 20 (dentro de la 2da Quincena de Septiembre, 16-30) → la primera cuota
        // proyectada es ESA misma quincena (IMPL-173 CA2), no la del mes siguiente.
        const filas = armarScheduleCuotas('2026-09-20', 150, 2, QUINCENAS_REALES, [], 'activo');

        expect(filas).toHaveLength(2);
        expect(filas.every((f) => f.esProyectada && f.estado === 'pendiente')).toBe(true);
        expect(filas[0].etiqueta).toBe('2da Quincena de Septiembre 2026');
        expect(filas[1].etiqueta).toBe('1ra Quincena de Octubre 2026');
    });

    it('usa el monto real del evento para la última cuota parcial (CA2)', () => {
        const filas = armarScheduleCuotas('2026-02-01', 333.33, 3, QUINCENAS_REALES.slice(0, 3), [
            pago('q1', 333.33), pago('q2', 333.33), pago('q3', 333.34),
        ], 'activo');

        expect(filas.map((f) => f.monto)).toEqual([333.33, 333.33, 333.34]);
        expect(filas.map((f) => f.estado)).toEqual(['pagada', 'pagada', 'pagada']);
    });

    it('marca las cuotas suspendidas con su motivo (IMPL-53) y conserva la posición del timeline', () => {
        const filas = armarScheduleCuotas('2026-02-01', 100, 4, QUINCENAS_REALES.slice(0, 5), [
            pago('q1', 100), suspension('q2', 'Incapacidad'), pago('q3', 100), pago('q4', 100),
        ], 'activo');

        expect(filas).toHaveLength(5); // 1 suspensión estira el timeline por encima de numero_cuotas
        expect(filas[1]).toMatchObject({ estado: 'suspendida', motivoSuspension: 'Incapacidad', monto: 100 });
        expect(filas[4]).toMatchObject({ etiqueta: '1ra Quincena de Abril 2026', estado: 'pendiente' });
    });

    it('no proyecta cuotas futuras en anticipos saldados', () => {
        const filas = armarScheduleCuotas('2026-02-01', 100, 6, QUINCENAS_REALES.slice(0, 4), [
            pago('q1', 100), pago('q2', 100), pago('q3', 100), pago('q4', 100),
        ], 'saldado');

        expect(filas).toHaveLength(4); // numero_cuotas (6) > filas reales, pero saldado → sin proyección
        expect(filas.every((f) => !f.esProyectada && f.estado === 'pagada')).toBe(true);
    });

    it('muestra la cuota pagada de un anticipo saldado aunque su quincena ya no esté en la lista de aplicables (defecto UAT: tabla vacía)', () => {
        // El evento real de pago existe, pero la quincena "q1" no viene en la lista de quincenas
        // que le llega al componente (p.ej. fue excluida por el filtro de aplicables, o borrada
        // después de procesarse el pago). Antes esto hacía que `posicionesConEvento` diera 0 y la
        // tabla completa quedara vacía; ahora la fila sale igual, usando el id como etiqueta de
        // respaldo si no se puede resolver el nombre de la quincena.
        const filas = armarScheduleCuotas('2026-02-01', 100, 1, [], [pago('q1', 100)], 'saldado');

        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({ estado: 'pagada', monto: 100, esProyectada: false });
    });

    it('un anticipo saldado sin ningún evento real muestra la tabla vacía (dato inconsistente, no se inventan filas)', () => {
        const filas = armarScheduleCuotas('2026-02-01', 100, 1, QUINCENAS_REALES, [], 'saldado');
        expect(filas).toHaveLength(0);
    });

    it('acota a numero_cuotas cuando el tenant tiene más quincenas reales que el schedule', () => {
        const filas = armarScheduleCuotas('2026-02-01', 100, 3, QUINCENAS_REALES, [
            pago('q1', 100), pago('q2', 100), pago('q3', 100),
        ], 'activo');

        expect(filas).toHaveLength(3);
        expect(filas.map((f) => f.etiqueta)).toEqual([
            '1ra Quincena de Febrero 2026',
            '2da Quincena de Febrero 2026',
            '1ra Quincena de Marzo 2026',
        ]);
    });

    it('resuelve el primer período aplicable según el día de la fecha del vale (IMPL-173 CA2 — siempre la quincena QUE CONTIENE el vale, nunca la siguiente)', () => {
        // Vale el día 1 → la 1ra del mes lo contiene.
        const d1 = armarScheduleCuotas('2026-02-01', 100, 1, QUINCENAS_REALES.slice(0, 1), [], 'activo');
        expect(d1[0].etiqueta).toBe('1ra Quincena de Febrero 2026');

        // Vale el día 10 → cae DENTRO de la 1ra Quincena (1-15), no en la 2da.
        const d10 = armarScheduleCuotas('2026-02-10', 100, 1, QUINCENAS_REALES.slice(0, 2), [], 'activo');
        expect(d10[0].etiqueta).toBe('1ra Quincena de Febrero 2026');

        // Vale el día 20 → cae DENTRO de la 2da Quincena (16-28) del MISMO mes, no en marzo.
        const d20 = armarScheduleCuotas('2026-02-20', 100, 1, QUINCENAS_REALES.slice(0, 2), [], 'activo');
        expect(d20[0].etiqueta).toBe('2da Quincena de Febrero 2026');
    });

    it('IMPL-173 CA2 (defecto UAT real) — vale registrado a mitad de una quincena real ya creada cobra esa MISMA quincena, no la siguiente', () => {
        // Caso real del ticket: Rodrigo Romero, fecha_vale 17/07/2026, dentro de la 2da Quincena
        // de Julio (16-31). Antes el filtro `fecha_inicio >= fechaVale` excluía esa quincena (su
        // fecha_inicio, 16/07, es MENOR que el vale, 17/07) y la primera cuota se corría a la 1ra
        // de Agosto.
        const quincenasJulioAgosto = [
            q('julio2', '2026-07-16', '2026-07-31', '2da Quincena de Julio 2026'),
            q('agosto1', '2026-08-01', '2026-08-15', '1ra Quincena de Agosto 2026'),
        ];
        const filas = armarScheduleCuotas('2026-07-17', 50, 1, quincenasJulioAgosto, [], 'activo');

        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({ key: 'julio2', etiqueta: '2da Quincena de Julio 2026', esProyectada: false });
    });
});
