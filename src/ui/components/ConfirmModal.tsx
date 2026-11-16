import React from 'react';
import { X, HelpCircle } from 'lucide-react';
import { Button } from './Button';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'primary' | 'danger' | 'warning' | 'success';
    Icon?: React.ElementType;
    isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    variant = 'primary',
    Icon = HelpCircle,
    isLoading = false
}) => {
    if (!isOpen) return null;

    const variantConfig = {
        primary: {
            bg: 'bg-indigo-50',
            text: 'text-indigo-600',
            button: 'primary' as const,
            iconBg: 'bg-indigo-500'
        },
        danger: {
            bg: 'bg-red-50',
            text: 'text-red-600',
            button: 'danger' as const,
            iconBg: 'bg-red-500'
        },
        warning: {
            bg: 'bg-amber-50',
            text: 'text-amber-600',
            button: 'warning' as const,
            iconBg: 'bg-amber-500'
        },
        success: {
            bg: 'bg-emerald-50',
            text: 'text-emerald-600',
            button: 'primary' as const,
            iconBg: 'bg-emerald-500'
        }
    };

    const config = variantConfig[variant] || variantConfig.primary;

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-[2rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] w-full max-w-[420px] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 ease-out overflow-hidden border border-slate-200/60 relative">

                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all active:scale-90"
                    disabled={isLoading}
                >
                    <X size={20} />
                </button>

                <div className="p-10 flex flex-col items-center text-center">
                    <div className={`w-20 h-20 ${config.bg} rounded-3xl flex items-center justify-center ${config.text} mb-8 shadow-sm rotate-3`}>
                        <Icon size={36} strokeWidth={1.5} />
                    </div>

                    <h3 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">
                        {title}
                    </h3>

                    <div className="text-base text-slate-500 font-medium leading-relaxed w-full">
                        {message}
                    </div>
                </div>

                <div className="bg-slate-50/80 p-6 flex gap-3 border-t border-slate-100">
                    <Button
                        variant="ghost"
                        className="flex-1 h-14 rounded-2xl font-bold"
                        onClick={onClose}
                        disabled={isLoading}
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={config.button}
                        className="flex-1 h-14 rounded-2xl font-bold transition-all active:scale-95 shadow-lg shadow-indigo-500/10"
                        onClick={onConfirm}
                        isLoading={isLoading}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
};
