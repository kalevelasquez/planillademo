import React from 'react';
import { AlertCircle, Edit3 } from 'lucide-react';
import { Button } from '../../../../ui/components/Button';
import { useTranslation } from 'react-i18next';

interface QuarantineCardsProps {
    quarantineItems: any[];
    quarantineEdits: Record<string, any>;
    quarantineFieldErrors: Record<string, Record<string, string>>;
    isQuarantineLoading: boolean;
    onEditClick: (id: string) => void;
}

export const QuarantineCards: React.FC<QuarantineCardsProps> = ({
    quarantineItems,
    quarantineEdits,
    quarantineFieldErrors,
    isQuarantineLoading,
    onEditClick
}) => {
    const { t } = useTranslation();
    return (
        <div className="block lg:hidden w-full p-md min-w-0">
            {isQuarantineLoading && quarantineItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center animate-pulse p-xl">
                    <div className="w-8 h-8 border-4 border-warning/30 border-t-warning rounded-full animate-spin mb-sm"></div>
                    <p className="text-caption text-text-secondary">{t('products.quarantine_loading')}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    {quarantineItems.map(q => {
                        const originalErrs = q.validation_errors || [];
                        const localErrs = quarantineFieldErrors[q.id] || {};
                        return (
                            <div key={q.id} className="bg-white rounded-xl shadow-sm border border-warning/40 p-md flex flex-col gap-sm">
                                <div className="flex justify-between items-start mb-1">
                                    <div>
                                        <div className="text-[10px] font-mono font-bold text-text-secondary mb-1">{t('products.quarantine_label_row_excel')}{q.excel_row_number}</div>
                                        <h4 className="font-display font-semibold text-heading">{quarantineEdits[q.id]?.name || q.raw_data?.PRODUCTO || t('products.quarantine_no_name')}</h4>
                                        <div className="text-caption text-text-secondary mt-0.5">{t('products.label_brand')}: {quarantineEdits[q.id]?.brand || q.raw_data?.MARCA || t('common.not_available')}</div>
                                    </div>
                                </div>

                                <div className="bg-error/5 border border-error/10 rounded-md p-sm mt-xs">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <AlertCircle size={14} className="text-error-dark" />
                                        <span className="text-xs font-bold text-error-dark">{t('products.quarantine_col_errors')}:</span>
                                    </div>
                                    <ul className="list-disc pl-5 text-[11px] text-error-dark/90 space-y-0.5">
                                        {(Object.values(localErrs).length > 0 ? Object.values(localErrs) : originalErrs).map((err: any, i: number) => (
                                            <li key={i}>{String(err)}</li>
                                        ))}
                                    </ul>
                                </div>

                                <Button
                                    variant="outline-primary"
                                    className="w-full mt-2 flex justify-center items-center gap-2"
                                    onClick={() => onEditClick(q.id)}
                                >
                                    <Edit3 size={16} />
                                    {t('products.btn_repair_lot')}
                                </Button>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    );
};
