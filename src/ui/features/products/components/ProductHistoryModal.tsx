import React, { useState, useEffect } from 'react';
import { X, History, ArrowRight, User, Tag, Package } from 'lucide-react';
import { Button } from '../../../components/Button';
import { auditService, type AuditEntry } from '../../../../services/auditService';
import type { Product } from '../../../../services/productService';
import { getAuditLabel, AUDIT_COLORS } from '../../admin/hooks/auditTranslate';
import { useTranslation } from 'react-i18next';

interface ProductHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    tenantId: string;
}

export const ProductHistoryModal: React.FC<ProductHistoryModalProps> = ({ isOpen, onClose, product, tenantId }) => {
    const { t, i18n } = useTranslation();
    const [logs, setLogs] = useState<AuditEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && product && tenantId) {
            loadHistory();
        }
    }, [isOpen, product, tenantId]);

    const loadHistory = async () => {
        if (!product) return;
        setIsLoading(true);
        try {
            const data = await auditService.getResourceHistory(tenantId, 'products', product.id);
            setLogs(data);
            if (data.length > 0) {
                setExpandedLogId(data[0].id); // Expandir el más reciente por defecto
            }
        } catch (error) {
            console.error('Error cargando historial de producto:', error);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen || !product) return null;

    const formatValue = (val: any, key: string) => {
        if (val === null || val === undefined) return <span className="text-text-secondary italic">{t('common.empty_italic')}</span>;

        if (typeof val === 'boolean') return val ? t('common.yes') : t('common.no');

        if (typeof val === 'number' && (key.includes('price') || key.includes('amount') || key.includes('discount') || key.includes('total'))) {
            return new Intl.NumberFormat(i18n.language === 'es' ? 'es-GT' : 'en-US', { style: 'currency', currency: 'USD' }).format(val);
        }

        if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T/)) {
            return new Date(val).toLocaleString(i18n.language === 'es' ? 'es-GT' : 'en-US');
        }

        if (typeof val === 'object') return JSON.stringify(val);

        return String(val);
    };

    const getIgnoredKeys = () => ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'sku_sintetico'];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-heading/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-modals w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-lg py-md border-b border-border flex justify-between items-center bg-surface/50">
                    <div className="flex items-center gap-md">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                            <History size={24} />
                        </div>
                        <div>
                            <h3 className="text-h3 text-heading">{t('products.history_modal_title')}</h3>
                            <p className="text-caption text-text-secondary">
                                {product.name} • {product.shipment_number}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white hover:text-error rounded-full transition-colors">
                        <X size={24} className="text-text-secondary" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-md md:p-lg bg-gray-50/30">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-xl gap-sm">
                            <div className="w-8 h-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                            <p className="text-caption text-text-secondary">{t('products.history_query_loading')}</p>
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-xl text-center opacity-60">
                            <Package size={48} className="text-text-secondary mb-md" />
                            <p className="text-body font-medium text-heading">{t('products.history_no_logs')}</p>
                            <p className="text-caption text-text-secondary mt-1">{t('products.history_empty_desc')}</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-md">
                            {logs.map((log) => (
                                <div key={log.id} className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
                                    {/* Log Header */}
                                    <button
                                        onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                                        className="w-full px-md py-sm flex items-center justify-between hover:bg-surface/50 transition-colors text-left"
                                    >
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-sm">
                                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${AUDIT_COLORS[log.action] || AUDIT_COLORS.DEFAULT}`}>
                                                    {getAuditLabel(log.action)}
                                                </span>
                                                <span className="text-sm font-bold text-heading">
                                                    {new Date(log.created_at).toLocaleString(i18n.language === 'es' ? 'es-GT' : 'en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                                                <User size={10} />
                                                <span>{log.user_email || t('products.history_system_user')}</span>
                                            </div>
                                        </div>
                                        <div className="text-primary p-1">
                                            <History size={16} className={expandedLogId === log.id ? 'rotate-180 transition-transform' : 'transition-transform'} />
                                        </div>
                                    </button>

                                    {/* Diff Details */}
                                    {expandedLogId === log.id && (
                                        <div className="px-md pb-md pt-xs border-t border-border/50 animate-in slide-in-from-top-2 duration-200">
                                            <div className="grid grid-cols-1 gap-sm">
                                                {Object.keys(log.new_values || {}).filter(k => !getIgnoredKeys().includes(k)).map(key => {
                                                    const oldVal = log.old_values ? log.old_values[key] : null;
                                                    const newVal = log.new_values[key];
                                                    const isChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);

                                                    if (!isChanged && log.action === 'UPDATE') return null;

                                                    return (
                                                        <div key={key} className="flex flex-col gap-1 p-2 bg-surface/30 rounded border border-border/50">
                                                            <div className="flex items-center gap-1">
                                                                <Tag size={10} className="text-primary" />
                                                                <span className="text-[10px] font-bold uppercase text-text-secondary tracking-wider">{getAuditLabel(key)}</span>
                                                            </div>
                                                            <div className="flex items-center gap-md">
                                                                {log.action === 'UPDATE' && (
                                                                    <>
                                                                        <div className="flex-1 text-xs text-error line-through bg-error/5 px-2 py-1 rounded">
                                                                            {formatValue(oldVal, key)}
                                                                        </div>
                                                                        <ArrowRight size={12} className="text-text-secondary shrink-0" />
                                                                    </>
                                                                )}
                                                                <div className="flex-1 text-xs text-success font-bold bg-success/5 px-2 py-1 rounded">
                                                                    {formatValue(newVal, key)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-lg py-md border-t border-border flex justify-end bg-surface/30">
                    <Button onClick={onClose} variant="secondary">{t('products.btn_close_history')}</Button>
                </div>
            </div>
        </div>
    );
};
