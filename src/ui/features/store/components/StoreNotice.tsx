import React from 'react';
import { AlertTriangle, PackageSearch } from 'lucide-react';

interface StoreNoticeProps {
    title?: string;
    message: string;
    /** `error` usa role="alert"; `info` es un bloque informativo. */
    tone?: 'info' | 'error';
    children?: React.ReactNode;
}

/** Estado vacio / no disponible / error de las paginas publicas. Presentacional. */
export const StoreNotice: React.FC<StoreNoticeProps> = ({ title, message, tone = 'info', children }) => {
    const Icon = tone === 'error' ? AlertTriangle : PackageSearch;

    return (
        <div
            role={tone === 'error' ? 'alert' : undefined}
            className="mx-auto flex w-full max-w-[32rem] flex-col items-center gap-sm rounded-lg border border-border bg-surface-paper px-lg py-xl text-center shadow-cards"
        >
            <span
                aria-hidden="true"
                className={`flex h-12 w-12 items-center justify-center rounded-full ${
                    tone === 'error' ? 'bg-error-light text-error-dark' : 'bg-primary-light text-primary'
                }`}
            >
                <Icon size={24} />
            </span>
            {title && <h2 className="text-xl">{title}</h2>}
            <p className="text-text-secondary">{message}</p>
            {children}
        </div>
    );
};
