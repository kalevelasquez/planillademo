import React from 'react';
import { ShieldAlert, X, CheckCircle2 } from 'lucide-react';
import { Button } from '../../../../ui/components/Button';
import { InputField } from '../../../../ui/components/InputField';
import { useTranslation } from 'react-i18next';

interface QuarantineEditModalProps {
    item: any;
    edits: any;
    localErrs: any;
    isPromoting: boolean;
    onClose: () => void;
    onEdit: (field: string, value: any) => void;
    onPromote: () => void;
}

export const QuarantineEditModal: React.FC<QuarantineEditModalProps> = ({
    item,
    edits,
    localErrs,
    isPromoting,
    onClose,
    onEdit,
    onPromote
}) => {
    const { t } = useTranslation();
    if (!item) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[600px] flex flex-col overflow-hidden animate-in zoom-in-95"
                onClick={e => e.stopPropagation()}
            >
                {/* Header Modal */}
                <div className="flex justify-between items-center px-lg py-md border-b border-border bg-surface/50">
                    <div>
                        <h2 className="text-h2 text-heading flex items-center gap-2">
                            <ShieldAlert size={20} className="text-warning-dark" />
                            {t('products.modal_repair_title')}{item.excel_row_number}
                        </h2>
                        <p className="text-caption text-text-secondary mt-1">{t('products.modal_repair_desc')}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors self-start"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body Modal */}
                <div className="p-lg overflow-y-auto max-h-[65vh]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                        <InputField
                            label={`${t('products.table_product')} *`}
                            value={edits?.name ?? ''}
                            onChange={e => onEdit('name', e.target.value)}
                            error={localErrs?.name}
                            placeholder={t('products.placeholder_example_product')}
                        />
                        <InputField
                            label={`${t('products.table_brand')} *`}
                            value={edits?.brand ?? ''}
                            onChange={e => onEdit('brand', e.target.value)}
                            error={localErrs?.brand}
                            placeholder={t('products.placeholder_example_brand')}
                        />
                        <InputField
                            label={`${t('products.table_quality')} *`}
                            value={edits?.quality ?? ''}
                            onChange={e => onEdit('quality', e.target.value)}
                            error={localErrs?.quality}
                        />
                        <InputField
                            label={`${t('products.table_caliber')} *`}
                            value={edits?.caliber ?? ''}
                            onChange={e => onEdit('caliber', e.target.value)}
                            error={localErrs?.caliber}
                        />
                        <InputField
                            label={`${t('products.table_shipment')} *`}
                            value={edits?.shipment_number ?? ''}
                            onChange={e => onEdit('shipment_number', e.target.value)}
                            error={localErrs?.shipment_number}
                        />
                        <InputField
                            label={t('products.label_category')}
                            value={edits?.category ?? ''}
                            onChange={e => onEdit('category', e.target.value)}
                            error={localErrs?.category}
                            placeholder={t('products.placeholder_auto_category')}
                        />
                        <InputField
                            label={t('products.table_stock')}
                            type="number"
                            value={edits?.available_quantity ?? ''}
                            onChange={e => onEdit('available_quantity', e.target.value)}
                            error={localErrs?.available_quantity}
                        />
                        <InputField
                            label={t('products.label_base_price')}
                            type="number"
                            step="0.01"
                            prefix="$"
                            value={edits?.price ?? ''}
                            onChange={e => onEdit('price', e.target.value)}
                            error={localErrs?.price}
                        />
                        <div className="md:col-span-2">
                            <InputField
                                label={t('products.label_entry')}
                                type="date"
                                value={edits?.entry_date ?? ''}
                                onChange={e => onEdit('entry_date', e.target.value)}
                                error={localErrs?.entry_date}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer Modal */}
                <div className="px-lg py-md border-t border-border bg-white flex justify-end gap-sm">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        disabled={isPromoting}
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={onPromote}
                        isLoading={isPromoting}
                        className="flex items-center gap-2 bg-primary hover:bg-primary-dark"
                    >
                        <CheckCircle2 size={18} />
                        {isPromoting ? t('products.import_validate_loading') : t('products.import_validate_save')}
                    </Button>
                </div>
            </div>
        </div>
    );
};
