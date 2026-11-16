/**
 * PDFPreviewModal.tsx
 * ─────────────────────────────────────────────────────────────────
 * Modal de previsualización de PDF con dualidad Desktop / Mobile.
 *
 * Desktop (≥ lg): iframe embebido dentro del modal.
 * Mobile   (< lg): window.open() al visor nativo del SO.
 *
 * RN-PDF-03: revokeObjectURL al cerrar para evitar memory leaks.
 * RN-PDF-04: Safari iOS / Chrome Android — iframe inestable en mobile,
 *            se usa window.open o fallback a descarga directa.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import { X, Download, ExternalLink } from 'lucide-react';
import { Button } from '../Button';

interface PDFPreviewModalProps {
    blobUrl: string;
    orderNumber: string;
    customerName?: string;
    onClose: () => void;
}

export const PDFPreviewModal: React.FC<PDFPreviewModalProps> = ({
    blobUrl,
    orderNumber,
    customerName,
    onClose,
}) => {
    const isDesktop = window.innerWidth >= 1024; // Breakpoint lg
    const revokeRef = useRef(blobUrl);

    // RN-PDF-03: levantar una referencia al url actual para revocar en cleanup
    useEffect(() => {
        revokeRef.current = blobUrl;
    }, [blobUrl]);

    // RN-PDF-03: revocar al desmontar + cerrar con Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('keydown', handleKey);
            URL.revokeObjectURL(revokeRef.current);
        };
    }, [onClose]);

    const handleDownload = useCallback(() => {
        const link = document.createElement('a');
        link.href = blobUrl;
        
        let finalFileName = `${orderNumber}.pdf`;
        if (customerName) {
            const safeCustomerName = customerName.toLowerCase()
                .replace(/[^a-z0-9]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');
            finalFileName = `${orderNumber}_${safeCustomerName}.pdf`;
        }
        
        link.download = finalFileName;
        link.click();
    }, [blobUrl, orderNumber, customerName]);

    const handleOpenNative = useCallback(() => {
        const newTab = window.open(blobUrl, '_blank');
        if (!newTab) handleDownload(); // fallback si popup bloqueado
    }, [blobUrl, handleDownload]);

    // Mobile: abrir en visor nativo directamente (RN-PDF-04)
    if (!isDesktop) {
        handleOpenNative();
        onClose();
        return null;
    }

    // Desktop: iframe embebido
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-label={`Previsualización PDF ${orderNumber}`}
        >
            <div className="bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-5 bg-primary rounded-full" />
                        <span className="font-display font-bold text-heading text-sm">
                            {orderNumber}
                        </span>
                        <span className="text-xs text-text-secondary">— Vista Previa PDF</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={handleOpenNative}
                            className="flex items-center gap-1.5 text-xs"
                        >
                            <ExternalLink size={13} />
                            Abrir en nueva pestaña
                        </Button>
                        <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={handleDownload}
                            className="flex items-center gap-1.5 text-xs"
                        >
                            <Download size={13} />
                            Descargar
                        </Button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-md text-text-secondary hover:text-heading hover:bg-surface transition-colors"
                            aria-label="Cerrar"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* ── Visor iframe ── */}
                <iframe
                    src={blobUrl}
                    title={`PDF ${orderNumber}`}
                    className="flex-1 w-full border-0"
                />
            </div>
        </div>
    );
};
