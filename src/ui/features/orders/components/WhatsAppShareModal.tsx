import React from 'react';
import { X, User, Truck, MessageCircle, Settings, Loader2 } from 'lucide-react';
import type { OrderDTO } from '../../../../services/orderService';
import type { Dispatcher } from '../../../../services/dispatcherService';
import { BRAND } from '../../../../config/brand';
import { Button } from '../../../components/Button';

interface WhatsAppShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    order: OrderDTO;
    dispatchers: Dispatcher[];
    onSendToClient: (order: OrderDTO) => Promise<void>;
    onSendToBodega: (order: OrderDTO, phone: string) => Promise<void>;
    isLoading?: boolean;
}

export const WhatsAppShareModal: React.FC<WhatsAppShareModalProps> = ({
    isOpen,
    onClose,
    order,
    dispatchers,
    onSendToClient,
    onSendToBodega,
    isLoading = false
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-modals w-full max-w-[400px] animate-in zoom-in-95 duration-200 overflow-hidden">
                {/* Header */}
                <div className="px-lg py-md border-b border-border bg-surface/50 flex justify-between items-center">
                    <div>
                        <h3 className="text-h3 text-heading font-bold">Reenviar Pedido</h3>
                        <p className="text-[11px] text-text-secondary uppercase tracking-wider font-semibold">
                            {order.order_number}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-text-secondary hover:text-heading transition-colors p-1"
                        disabled={isLoading}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-lg flex flex-col gap-lg">
                    {/* Opción 1: Cliente */}
                    <div className="flex flex-col gap-sm">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-1">
                            Enviar al Cliente
                        </label>
                        <Button
                            variant="primary"
                            onClick={() => onSendToClient(order)}
                            isLoading={isLoading}
                            className="w-full flex justify-center items-center gap-md py-md"
                        >
                            <MessageCircle size={20} />
                            Enviar a {order.customers?.business_name || 'Cliente'}
                        </Button>
                        <p className="text-[11px] text-text-secondary text-center px-lg">
                            Se enviará el link del PDF oficial al número registrado: <span className="font-bold">{order.customers?.phone || 'Sin teléfono'}</span>
                        </p>
                    </div>

                    <div className="h-px bg-border my-xs relative">
                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-md text-[10px] font-bold text-text-secondary/50 uppercase tracking-widest">
                            O
                        </span>
                    </div>

                    {/* Opción 2: Bodega / Despacho */}
                    <div className="flex flex-col gap-sm">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-1">
                            Enviar a Despacho (Bodega)
                        </label>

                        <div className="flex flex-col gap-xs max-h-[220px] overflow-y-auto pr-xs custom-scrollbar">
                            {dispatchers.length > 0 ? (
                                dispatchers.map(d => (
                                    <button
                                        key={d.id}
                                        disabled={isLoading}
                                        onClick={() => onSendToBodega(order, d.phone)}
                                        className="flex items-center gap-md p-md rounded-md hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all text-left group disabled:opacity-50"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:scale-110 transition-transform">
                                            <User size={20} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-body font-bold text-heading truncate">{d.name}</p>
                                            <p className="text-caption text-text-secondary">{d.phone}</p>
                                        </div>
                                        <Truck size={16} className="text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                ))
                            ) : (
                                <p className="text-caption text-text-secondary italic p-md text-center">
                                    No hay despachadores registrados.
                                </p>
                            )}

                            <div className="h-px bg-border my-xs" />

                            <button
                                disabled={isLoading}
                                onClick={() => onSendToBodega(order, BRAND.PHONE_BODEGA)}
                                className="flex items-center gap-md p-md rounded-md hover:bg-surface border border-dashed border-border transition-all text-left disabled:opacity-50"
                            >
                                <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-text-secondary shrink-0">
                                    <Settings size={20} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-body font-bold text-text-secondary truncate">Número por defecto (Bodega)</p>
                                    <p className="text-caption text-text-secondary opacity-60">Fijo: {BRAND.PHONE_BODEGA}</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer simple indicando estado */}
                {isLoading && (
                    <div className="bg-surface/50 border-t border-border px-lg py-sm flex items-center justify-center gap-sm">
                        <Loader2 size={14} className="animate-spin text-primary" />
                        <span className="text-[11px] text-text-secondary font-medium">Procesando envío...</span>
                    </div>
                )}
            </div>
        </div>
    );
};
