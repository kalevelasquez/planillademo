import React from 'react';
import { AlertCircle, Edit3 } from 'lucide-react';
import { Button } from '../../../../ui/components/Button';
import { useTranslation } from 'react-i18next';

interface QuarantineTableProps {
    quarantineItems: any[];
    quarantineEdits: Record<string, any>;
    quarantineFieldErrors: Record<string, Record<string, string>>;
    isQuarantineLoading: boolean;
    onEditClick: (id: string) => void;
}

export const QuarantineTable: React.FC<QuarantineTableProps> = ({
    quarantineItems,
    quarantineEdits,
    quarantineFieldErrors,
    isQuarantineLoading,
    onEditClick
}) => {
    const { t } = useTranslation();
    return (
        <div className="hidden lg:block overflow-x-auto w-full min-w-0">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-surface/50 border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                        <th className="p-md font-semibold w-[5%] text-center">{t('products.quarantine_col_row')}</th>
                        <th className="p-md font-semibold w-[30%]">{t('products.quarantine_col_product')}</th>
                        <th className="p-md font-semibold w-[40%]">{t('products.quarantine_col_errors')}</th>
                        <th className="p-md font-semibold w-[25%] text-center">{t('products.quarantine_col_action')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                    {isQuarantineLoading && quarantineItems.length === 0 ? (
                        <tr>
                            <td colSpan={4} className="p-xl text-center">
                                <div className="flex flex-col items-center justify-center animate-pulse">
                                    <div className="w-8 h-8 border-4 border-warning/30 border-t-warning rounded-full animate-spin mb-sm"></div>
                                    <p className="text-caption text-text-secondary">{t('products.quarantine_loading')}</p>
                                </div>
                            </td>
                        </tr>
                    ) : quarantineItems.map(q => {
                        const originalErrs = q.validation_errors || [];
                        const localErrs = quarantineFieldErrors[q.id] || {};
                        return (
                            <tr key={q.id} className="hover:bg-warning/5 transition-colors">
                                <td className="p-md text-center font-mono font-bold text-text-secondary align-top">
                                    #{q.excel_row_number}
                                </td>
                                <td className="p-md align-top">
                                    <div className="font-bold text-heading">{quarantineEdits[q.id]?.name || q.raw_data?.PRODUCTO || t('products.quarantine_no_name')}</div>
                                    <div className="text-caption text-text-secondary mt-1">{t('products.label_brand')}: {quarantineEdits[q.id]?.brand || q.raw_data?.MARCA || t('common.not_available')}</div>
                                </td>
                                <td className="p-md align-top">
                                    <div className="flex items-start gap-1.5 p-sm bg-error/5 border border-error/10 rounded-md text-[11px] text-error-dark/90">
                                        <AlertCircle size={14} className="text-error-dark mt-0.5 shrink-0" />
                                        <ul className="list-disc pl-4 space-y-0.5 m-0">
                                            {(Object.values(localErrs).length > 0 ? Object.values(localErrs) : originalErrs).map((err: any, i: number) => (
                                                <li key={i}>{String(err)}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </td>
                                <td className="p-md align-middle text-center">
                                    <Button
                                        variant="outline-primary"
                                        className="w-full flex justify-center items-center gap-2"
                                        onClick={() => onEditClick(q.id)}
                                    >
                                        <Edit3 size={16} />
                                        {t('products.btn_repair_lot')}
                                    </Button>
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    );
};
