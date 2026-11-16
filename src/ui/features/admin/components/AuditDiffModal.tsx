import React, { useEffect, useRef, useState } from 'react';
import { X, History, ArrowRight } from 'lucide-react';
import { Button } from '../../../components/Button';
import type { AuditEntry } from '../../../../services/auditService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { descuentoCategoriasService } from '../../../../services/descuentoCategoriasService';
import { otrosIngresosConceptosService } from '../../../../services/otrosIngresosConceptosService';
import { bonificacionTiposService } from '../../../../services/bonificacionTiposService';
import { tablasIncentivosService } from '../../../../services/tablasIncentivosService';
import { ubicacionesService } from '../../../../services/ubicacionesService';
import { quincenasService } from '../../../../services/quincenasService';
import { Logger } from '../../../../utils/logger';
import { getAuditLabel, AUDIT_COLORS } from '../hooks/auditTranslate';

interface AuditDiffModalProps {
    isOpen: boolean;
    onClose: () => void;
    entry: AuditEntry | null;
}

/**
 * IMPL-136 (Observación General UAT) — generaliza el defecto puntual original (US-BON-04 CA1:
 * `empleado_id` crudo en la auditoría de Bonificaciones) a toda columna FK conocida, sin
 * importar el `resource_type` del registro. Cada catálogo es chico y se carga una sola vez
 * (nunca cambia de tamaño de forma relevante durante una sesión de revisión de auditoría); si
 * el id ya no existe en el catálogo (registro eliminado), queda el id crudo como fallback.
 * `quincena_id` se incluye a propósito aunque sea inmutable una vez creado el registro — su
 * etiqueta ("2026-08 Q2") es mucho más útil que el UUID incluso en un diff de solo-creación.
 */
const FK_LOOKUPS: { key: string; load: () => Promise<Map<string, string>> }[] = [
    { key: 'empleado_id', load: () => planillaEmpleadosService.getEmpleados(1, '', undefined, 5000).then((res) => new Map(res.data.map((e) => [e.id, e.nombre_completo]))) },
    { key: 'categoria_id', load: () => descuentoCategoriasService.getTodos().then((rows) => new Map(rows.map((r) => [r.id, r.nombre]))) },
    { key: 'concepto_id', load: () => otrosIngresosConceptosService.getTodos().then((rows) => new Map(rows.map((r) => [r.id, r.nombre]))) },
    { key: 'tipo_id', load: () => bonificacionTiposService.getTodos().then((rows) => new Map(rows.map((r) => [r.id, r.nombre]))) },
    { key: 'tabla_incentivo_id', load: () => tablasIncentivosService.getTodas().then((rows) => new Map(rows.map((r) => [r.id, r.nombre]))) },
    { key: 'ubicacion_id', load: () => ubicacionesService.getUbicaciones().then((rows) => new Map(rows.map((r) => [r.id, r.nombre]))) },
    { key: 'quincena_id', load: () => quincenasService.getQuincenas().then((rows) => new Map(rows.map((r) => [r.id, r.etiqueta_estandar]))) },
];

export const AuditDiffModal: React.FC<AuditDiffModalProps> = ({ isOpen, onClose, entry }) => {
    const [fkMaps, setFkMaps] = useState<Record<string, Map<string, string>>>({});
    const cargadosRef = useRef(false);

    useEffect(() => {
        if (!isOpen || !entry || cargadosRef.current) return;
        cargadosRef.current = true;
        Promise.all(
            FK_LOOKUPS.map(({ key, load }) =>
                load()
                    .then((map) => [key, map] as const)
                    .catch((err: unknown) => {
                        Logger.error('Error al cargar catálogo para detalle de auditoría', { key }, err);
                        return [key, new Map<string, string>()] as const;
                    })
            )
        ).then((entries) => setFkMaps(Object.fromEntries(entries)));
    }, [isOpen, entry]);

    if (!isOpen || !entry) return null;

    const oldValues = entry.old_values || {};
    const newValues = entry.new_values || {};

    const getAllKeys = () => {
        const keys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
        // Filtrar campos técnicos que no aportan valor visual
        const ignoredKeys = ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at'];
        return Array.from(keys).filter(k => !ignoredKeys.includes(k)).sort();
    };

    const keys = getAllKeys();

    const formatValue = (val: any, key: string) => {
        if (val === null || val === undefined) return <span className="text-text-secondary italic">vacío</span>;

        // Formateo de Booleanos con Semántica
        if (typeof val === 'boolean') {
            if (key === 'is_active') return val ? <span className="text-green-600 font-bold">Activo</span> : <span className="text-red-600 font-bold">Inactivo</span>;
            return val ? 'Sí' : 'No';
        }

        // Formateo de Moneda (Monto, Precio, etc.)
        if (typeof val === 'number' && (key.includes('price') || key.includes('amount') || key.includes('discount') || key.includes('total'))) {
            return new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' }).format(val);
        }

        // Resolución de columnas FK conocidas a su nombre/etiqueta legible (IMPL-136).
        if (typeof val === 'string') {
            const nombre = fkMaps[key]?.get(val);
            if (nombre) return <span>{nombre}</span>;
        }

        if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T/)) {
            return new Date(val).toLocaleString('es-SV');
        }

        if (typeof val === 'object') return <pre className="text-[10px] bg-surface p-1 rounded overflow-x-auto">{JSON.stringify(val, null, 2)}</pre>;

        return String(val);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-heading/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-modals w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-lg py-md border-b border-border flex justify-between items-center bg-surface">
                    <div className="flex items-center gap-md">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                            <History size={24} />
                        </div>
                        <div>
                            <h3 className="text-h3 text-heading">Detalle de Cambios</h3>
                            <p className="text-caption text-text-secondary">
                                {getAuditLabel(entry.resource_type)} • ID: {entry.resource_id?.substring(0, 8)}...
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors">
                        <X size={24} className="text-text-secondary" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-md md:p-lg">
                    <div className="grid grid-cols-1 gap-lg">
                        {/* Meta info */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-md bg-surface/50 p-md rounded-lg border border-border">
                            <div>
                                <p className="text-[10px] font-bold uppercase text-text-secondary mb-1 tracking-wider">Usuario</p>
                                <p className="text-body font-medium text-heading">{entry.user_email || 'Sistema'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase text-text-secondary mb-1 tracking-wider">Acción</p>
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${AUDIT_COLORS[entry.action] || AUDIT_COLORS.DEFAULT}`}>
                                    {getAuditLabel(entry.action)}
                                </span>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase text-text-secondary mb-1 tracking-wider">Fecha y Hora</p>
                                <p className="text-body font-medium text-heading">
                                    {new Date(entry.created_at).toLocaleString('es-SV')}
                                </p>
                            </div>
                        </div>

                        {/* Diff Table */}
                        <div className="border border-border rounded-lg overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-surface text-[10px] font-bold uppercase tracking-wider text-text-secondary border-b border-border">
                                        <th className="px-md py-sm">Campo</th>
                                        <th className="px-md py-sm">Valor Anterior</th>
                                        <th className="px-md py-sm w-8"></th>
                                        <th className="px-md py-sm">Valor Nuevo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                    {keys.map(key => {
                                        const oldVal = oldValues[key];
                                        const newVal = newValues[key];
                                        const isChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);

                                        return (
                                            <tr key={key} className={`transition-colors ${isChanged ? 'bg-primary/5' : 'hover:bg-surface/30'}`}>
                                                <td className="px-md py-sm">
                                                    <span className={`text-sm font-medium ${isChanged ? 'text-primary font-bold' : 'text-text-secondary'}`}>
                                                        {getAuditLabel(key)}
                                                    </span>
                                                </td>
                                                <td className={`px-md py-sm text-sm ${isChanged ? 'bg-red-50/50 text-red-700' : 'text-text-secondary'}`}>
                                                    {formatValue(oldVal, key)}
                                                </td>
                                                <td className="px-sm py-sm text-center">
                                                    {isChanged && <ArrowRight size={14} className="text-primary mx-auto" />}
                                                </td>
                                                <td className={`px-md py-sm text-sm ${isChanged ? 'bg-green-50/50 text-green-700 font-medium' : 'text-text-secondary'}`}>
                                                    {formatValue(newVal, key)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {keys.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-md py-xl text-center text-text-secondary italic">
                                                No hay campos comparables para este registro.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-lg py-md border-t border-border flex justify-end bg-surface/30">
                    <Button onClick={onClose} variant="secondary">Cerrar</Button>
                </div>
            </div>
        </div>
    );
};
