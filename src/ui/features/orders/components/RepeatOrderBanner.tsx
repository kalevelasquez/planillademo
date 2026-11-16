import { RefreshCw, Package, Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import type { OrderDTO } from '../../../../services/orderService';

interface RepeatOrderBannerProps {
    order: OrderDTO;
    onRepeat: () => void;
    onDismiss: () => void;
}

export const RepeatOrderBanner: React.FC<RepeatOrderBannerProps> = ({ order, onRepeat, onDismiss }) => {
    const { t, i18n } = useTranslation();
    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return new Intl.DateTimeFormat(i18n.language === 'es' ? 'es-HN' : 'en-US', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            }).format(date);
        } catch (e) {
            return dateString;
        }
    };

    return (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-md mb-lg relative overflow-hidden group animate-in slide-in-from-top duration-300">
            {/* Background design element */}
            <div className="absolute -right-8 -top-8 text-primary/5 transform rotate-12 group-hover:rotate-6 transition-transform duration-500">
                <RefreshCw size={120} />
            </div>

            {/* Removal of 'X' button per US-ORD-08 logic refinement */}

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-md relative z-10">
                <div className="flex items-start gap-sm pr-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                        <RefreshCw size={20} />
                    </div>
                    <div className="flex-1">
                        <h4 className="text-body font-bold text-heading flex items-center gap-2">
                            {t('catalog.repeat_banner_title')}
                            <span className="px-1.5 py-0.5 bg-primary text-white text-[10px] font-black rounded uppercase tracking-tighter">
                                {t('catalog.repeat_banner_new')}
                            </span>
                        </h4>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                            <span className="text-caption text-text-secondary flex items-center gap-1.5">
                                <Calendar size={13} className="opacity-50" />
                                {formatDate(order.created_at)}
                            </span>
                            <span className="text-caption text-text-secondary flex items-center gap-1.5 font-medium whitespace-nowrap">
                                <Package size={13} className="opacity-50" />
                                {order.order_number}
                            </span>
                            {/* CA2: Cantidad de productos (US-ORD-08) */}
                            <span className="text-caption text-text-secondary flex items-center gap-1.5 font-medium bg-white px-2 rounded-full border border-primary/10">
                                <Package size={13} className="text-primary opacity-70" />
                                {order.order_items?.length || 0} {(order.order_items?.length === 1) ? t('catalog.products_one') : t('catalog.products_other')}
                            </span>
                            <span className="text-body font-bold text-primary ml-auto md:ml-0">
                                ${Number(order.total_amount).toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2.5">
                    <Button
                        onClick={onDismiss}
                        variant="outline-secondary"
                        size="sm"
                        className="bg-white z-20"
                    >
                        {t('catalog.btn_start_empty')}
                    </Button>
                    <Button
                        onClick={onRepeat}
                        variant="primary"
                        size="sm"
                        className="shadow-md z-20"
                    >
                        <RefreshCw size={14} className="mr-1.5" />
                        {t('catalog.btn_repeat_order')}
                    </Button>
                </div>
            </div>
        </div>
    );
};
