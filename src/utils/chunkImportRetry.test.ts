import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importWithRetry } from './chunkImportRetry';
import * as ToastContext from '../context/ToastContext';

describe('importWithRetry', () => {
    let toastSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        toastSpy = vi.spyOn(ToastContext, 'showGlobalToast').mockImplementation(() => { });
    });

    it('devuelve el resultado sin avisar nada cuando el import funciona', async () => {
        const resultado = await importWithRetry(async () => 'ok', 'contexto de prueba');

        expect(resultado).toBe('ok');
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('avisa con un toast de "actualizar" y re-lanza el error original cuando el import falla', async () => {
        const errorOriginal = new Error('ChunkLoadError simulado');

        await expect(importWithRetry(async () => {
            throw errorOriginal;
        }, 'contexto de prueba')).rejects.toThrow('ChunkLoadError simulado');

        expect(toastSpy).toHaveBeenCalledTimes(1);
        const [mensaje, tipo, accion] = toastSpy.mock.calls[0];
        expect(tipo).toBe('warning');
        expect(mensaje).toContain('versión más nueva');
        expect(accion?.label).toBe('Actualizar ahora');
    });

    it('el botón del toast dispara un reload manual cuando se hace clic', async () => {
        const reloadSpy = vi.fn();
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...originalLocation, reload: reloadSpy },
        });

        await expect(importWithRetry(async () => {
            throw new Error('falla');
        }, 'contexto de prueba')).rejects.toThrow();

        const [, , accion] = toastSpy.mock.calls[0];
        accion?.onClick?.();
        expect(reloadSpy).toHaveBeenCalledTimes(1);

        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });
});
