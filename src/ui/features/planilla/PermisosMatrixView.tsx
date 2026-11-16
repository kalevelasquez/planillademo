import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, AlertCircle } from 'lucide-react';

import { PERMISOS_MATRIX, type PermisoValor } from '../../../config/planillaPermisosMatrix';

function PermisoIcono({ valor }: { valor: PermisoValor }) {
    if (valor === 'si') return <Check size={16} className="text-emerald-600 mx-auto" />;
    if (valor === 'no') return <X size={16} className="text-text-secondary/40 mx-auto" />;
    return <AlertCircle size={16} className="text-amber-600 mx-auto" />;
}

/**
 * Matriz de Permisos por Rol (US-CIE-02 / IMPL-105). Documentación de solo lectura —
 * consolida el comportamiento REAL ya construido por las RLS policies y los RPCs de
 * IMPL-103/104, no reemplaza la lógica de permisos en sí (que vive en Postgres).
 */
export const PermisosMatrixView: React.FC = () => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <div className="bg-white rounded-lg shadow-cards border border-border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-surface text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                                <th className="text-left py-sm px-md">{t('permisosMatrix.col_accion')}</th>
                                <th className="text-center py-sm px-md">{t('permisosMatrix.col_admin')}</th>
                                <th className="text-center py-sm px-md">{t('permisosMatrix.col_preparador')}</th>
                                <th className="text-center py-sm px-md">{t('permisosMatrix.col_aprobador')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {PERMISOS_MATRIX.map((row) => (
                                <tr key={row.accionKey} className="border-t border-border/40">
                                    <td className="py-sm px-md">
                                        <p className="font-medium text-heading">{t(`permisosMatrix.accion_${row.accionKey}`)}</p>
                                        {row.notaKey && <p className="text-[11px] text-text-secondary mt-0.5">{t(`permisosMatrix.${row.notaKey}`)}</p>}
                                    </td>
                                    <td className="py-sm px-md"><PermisoIcono valor={row.admin} /></td>
                                    <td className="py-sm px-md"><PermisoIcono valor={row.preparador} /></td>
                                    <td className="py-sm px-md"><PermisoIcono valor={row.aprobador} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <p className="text-caption text-text-secondary">{t('permisosMatrix.leyenda')}</p>
        </div>
    );
};
