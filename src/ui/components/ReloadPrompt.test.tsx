import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SW_UPDATE_INTERVAL_MS } from '../../utils/swUpdate';

let capturedOptions: { onRegisteredSW?: (url: string, r: unknown) => void } = {};
let offlineReady = false;
let needRefresh = false;

vi.mock('virtual:pwa-register/react', () => ({
    useRegisterSW: (opts: typeof capturedOptions) => {
        capturedOptions = opts;
        return {
            offlineReady: [offlineReady, vi.fn()],
            needRefresh: [needRefresh, vi.fn()],
            updateServiceWorker: vi.fn(),
        };
    },
}));

import ReloadPrompt from './ReloadPrompt';

describe('ReloadPrompt (actualizacion automatica)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        offlineReady = false;
        needRefresh = false;
        capturedOptions = {};
    });
    afterEach(() => vi.useRealTimers());

    it('no muestra nada por defecto ni boton "Actualizar ahora"', () => {
        render(<ReloadPrompt />);
        expect(screen.queryByText(/Actualizar ahora/i)).toBeNull();
        expect(screen.queryByText(/Nueva versión/i)).toBeNull();
    });

    it('conserva el aviso offline-ready', () => {
        offlineReady = true;
        render(<ReloadPrompt />);
        expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
    });

    it('chequea updates cada SW_UPDATE_INTERVAL_MS (60 min) y al volver a la pestana', () => {
        expect(SW_UPDATE_INTERVAL_MS).toBe(60 * 60 * 1000);
        const update = vi.fn().mockResolvedValue(undefined);
        render(<ReloadPrompt />);
        act(() => capturedOptions.onRegisteredSW!('/sw.js', { update }));

        act(() => { vi.advanceTimersByTime(SW_UPDATE_INTERVAL_MS); });
        expect(update).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(update).toHaveBeenCalledTimes(2);

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(update).toHaveBeenCalledTimes(2);
    });

    it('no revienta si registration es undefined', () => {
        render(<ReloadPrompt />);
        expect(() => act(() => capturedOptions.onRegisteredSW!('/sw.js', undefined))).not.toThrow();
    });

    it('no chequea updates si no hay red (navigator.onLine=false)', () => {
        const update = vi.fn().mockResolvedValue(undefined);
        render(<ReloadPrompt />);
        act(() => capturedOptions.onRegisteredSW!('/sw.js', { update }));
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        act(() => { vi.advanceTimersByTime(SW_UPDATE_INTERVAL_MS); });
        expect(update).not.toHaveBeenCalled();
    });
});
