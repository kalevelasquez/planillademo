import React from 'react';
import { Loader2 } from 'lucide-react';

export interface PageLoaderProps {
    label?: string;
    fullPage?: boolean;
    className?: string;
}

/**
 * Reemplaza los `<div className="... animate-pulse" />` sueltos (ambiguos — un rectángulo gris
 * puede leerse como "esto está roto" en vez de "está cargando") por el mismo spinner + texto que
 * ya usa `OrderDetailView` (Pedidos). `fullPage` reproduce ese caso (bloque centrado, ícono
 * grande, min-h-[400px]); sin `fullPage` es el reemplazo directo de un placeholder de sección
 * embebido en una pantalla que ya renderizó su header/filtros.
 */
export const PageLoader: React.FC<PageLoaderProps> = ({ label = 'Cargando...', fullPage = false, className = '' }) => (
    <div className={`flex flex-col items-center justify-center gap-3 ${fullPage ? 'min-h-[400px]' : 'py-lg'} ${className}`}>
        <Loader2 size={fullPage ? 40 : 24} className="animate-spin text-primary" />
        {label && <p className="text-body text-text-secondary">{label}</p>}
    </div>
);
