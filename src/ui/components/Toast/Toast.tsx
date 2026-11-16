import React from 'react';
import { CheckCircle, AlertTriangle, X, Info } from 'lucide-react';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface ToastProps {
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
    onClose: () => void;
    action?: ToastAction;
}

const toastStyles = {
    success: 'bg-success text-white shadow-[0_4px_12px_rgba(2,180,70,0.3)]',
    error: 'bg-error text-white shadow-lg',
    info: 'bg-info text-white shadow-lg',
    warning: 'bg-warning text-heading shadow-lg',
};

const toastIcons = {
    success: <CheckCircle size={24} className="shrink-0" />,
    error: <AlertTriangle size={24} className="shrink-0" />,
    info: <Info size={24} className="shrink-0" />,
    warning: <AlertTriangle size={24} className="shrink-0" />,
};

export const Toast: React.FC<ToastProps> = ({ message, type, onClose, action }) => {
    return (
        <div className={`fixed top-4 left-4 right-4 md:left-auto md:top-lg md:right-lg md:w-[380px] bottom-auto z-[200] p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-top-5 rounded-[12px] h-auto ${toastStyles[type]}`}>
            <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">{toastIcons[type]}</span>
                <span className="text-sm font-bold flex-1 text-left whitespace-normal leading-snug">{message}</span>
                <button onClick={onClose} className="opacity-70 hover:opacity-100 p-1 shrink-0 transition-opacity mt-0.5">
                    <X size={18} />
                </button>
            </div>
            {action && (
                <div className="flex justify-end pl-9">
                    <button
                        onClick={() => {
                            action.onClick();
                            onClose();
                        }}
                        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/30 rounded-md transition-colors"
                    >
                        {action.label}
                    </button>
                </div>
            )}
        </div>
    );
};
