import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileDown, FileSpreadsheet } from 'lucide-react';

import { Button } from '../../../components/Button';

const MESES: { value: number; labelKey: string }[] = [
    { value: 1, labelKey: 'reportes.mes_1' }, { value: 2, labelKey: 'reportes.mes_2' }, { value: 3, labelKey: 'reportes.mes_3' },
    { value: 4, labelKey: 'reportes.mes_4' }, { value: 5, labelKey: 'reportes.mes_5' }, { value: 6, labelKey: 'reportes.mes_6' },
    { value: 7, labelKey: 'reportes.mes_7' }, { value: 8, labelKey: 'reportes.mes_8' }, { value: 9, labelKey: 'reportes.mes_9' },
    { value: 10, labelKey: 'reportes.mes_10' }, { value: 11, labelKey: 'reportes.mes_11' }, { value: 12, labelKey: 'reportes.mes_12' },
];

interface ReporteFiltroMesModalProps {
    icon: React.ElementType;
    titulo: string;
    descripcion: string;
    filtroMes: number | 'todos';
    setFiltroMes: (mes: number | 'todos') => void;
    totalFilas: number;
    isLoading: boolean;
    /** true si la carga de datos falló — se muestra en vez del contador y bloquea la generación,
     * para no confundir un error real de backend con "0 registros" genuino. */
    error?: boolean;
    onGenerarPDF: () => Promise<void>;
    onGenerarExcel: () => Promise<void>;
    onClose: () => void;
}

/**
 * Modal compartido para los reportes de consulta con filtro de mes (Vacaciones IMPL-159,
 * Permisos IMPL-166) — ambos comparten exactamente el mismo control (select de mes + botones
 * Generar PDF/Excel), la única diferencia es qué datos arman el PDF/Excel, que decide el caller.
 */
export const ReporteFiltroMesModal: React.FC<ReporteFiltroMesModalProps> = ({
    icon: Icon, titulo, descripcion, filtroMes, setFiltroMes, totalFilas, isLoading, error = false, onGenerarPDF, onGenerarExcel, onClose,
}) => {
    const { t } = useTranslation();
    const [isGenerandoPDF, setIsGenerandoPDF] = useState(false);
    const [isGenerandoExcel, setIsGenerandoExcel] = useState(false);

    const handleGenerarPDF = async () => {
        setIsGenerandoPDF(true);
        try { await onGenerarPDF(); } finally { setIsGenerandoPDF(false); }
    };
    const handleGenerarExcel = async () => {
        setIsGenerandoExcel(true);
        try { await onGenerarExcel(); } finally { setIsGenerandoExcel(false); }
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[480px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="sm:hidden flex justify-center pt-sm pb-0 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>

                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <Icon size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{titulo}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <p className="text-caption text-text-secondary">{descripcion}</p>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('reportes.filtro_mes')}</label>
                            <select
                                value={filtroMes}
                                onChange={(e) => setFiltroMes(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
                                className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                            >
                                <option value="todos">{t('reportes.filtro_mes_todos')}</option>
                                {MESES.map((m) => <option key={m.value} value={m.value}>{t(m.labelKey as any)}</option>)}
                            </select>
                        </div>

                        {error ? (
                            <p className="text-caption text-error">{t('reportes.error_cargar')}</p>
                        ) : (
                            <p className="text-caption text-text-secondary">
                                {isLoading ? t('common.loading') : t('reportes.contador_filas', { count: totalFilas })}
                            </p>
                        )}
                    </div>

                    <div className="flex gap-sm px-lg py-md border-t border-border shrink-0">
                        <Button variant="secondary" onClick={handleGenerarExcel} isLoading={isGenerandoExcel} disabled={isLoading || error || totalFilas === 0} className="flex-1">
                            <FileSpreadsheet size={16} /> {t('reportes.generar_excel')}
                        </Button>
                        <Button onClick={handleGenerarPDF} isLoading={isGenerandoPDF} disabled={isLoading || error} className="flex-1">
                            <FileDown size={16} /> {t('reportes.generar_pdf')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
