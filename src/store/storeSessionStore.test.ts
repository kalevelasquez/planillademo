import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getStoreSession: vi.fn(),
    subscribeStoreAuth: vi.fn(),
    signOutStoreCustomer: vi.fn(),
}));
vi.mock('../services/storeAuthService', () => ({
    getStoreSession: mocks.getStoreSession,
    subscribeStoreAuth: mocks.subscribeStoreAuth,
    signOutStoreCustomer: mocks.signOutStoreCustomer,
}));

import { useStoreSessionStore } from './storeSessionStore';

type Listener = (s: unknown) => void;
let listener: Listener = () => {};
const unsubscribe = vi.fn();

beforeEach(() => {
    // reset() cancela la suscripcion previa (llama a unsubscribe): se hace antes de limpiar los contadores.
    useStoreSessionStore.getState().reset();
    vi.clearAllMocks();
    listener = () => {};
    mocks.subscribeStoreAuth.mockImplementation((cb: Listener) => {
        listener = cb;
        return unsubscribe;
    });
    mocks.getStoreSession.mockResolvedValue(null);
    mocks.signOutStoreCustomer.mockResolvedValue(undefined);
});

describe('storeSessionStore', () => {
    it('arranca en loading y pasa a ready con la sesion existente', async () => {
        const session = { user: { id: 'c1', email: 'a@b.co' } };
        mocks.getStoreSession.mockResolvedValue(session);
        expect(useStoreSessionStore.getState().status).toBe('loading');

        useStoreSessionStore.getState().init();
        await vi.waitFor(() => expect(useStoreSessionStore.getState().status).toBe('ready'));

        expect(useStoreSessionStore.getState().session).toBe(session);
    });

    it('sin sesion previa queda ready con session null', async () => {
        useStoreSessionStore.getState().init();
        await vi.waitFor(() => expect(useStoreSessionStore.getState().status).toBe('ready'));
        expect(useStoreSessionStore.getState().session).toBeNull();
    });

    it('reacciona a cambios de auth (login y logout) del cliente de tienda', async () => {
        useStoreSessionStore.getState().init();
        await vi.waitFor(() => expect(useStoreSessionStore.getState().status).toBe('ready'));

        const session = { user: { id: 'c2' } };
        listener(session);
        expect(useStoreSessionStore.getState().session).toBe(session);

        listener(null);
        expect(useStoreSessionStore.getState().session).toBeNull();
    });

    it('init es idempotente (una sola suscripcion) y devuelve cleanup que cancela', () => {
        const stop1 = useStoreSessionStore.getState().init();
        useStoreSessionStore.getState().init();
        expect(mocks.subscribeStoreAuth).toHaveBeenCalledTimes(1);

        stop1();
        expect(unsubscribe).toHaveBeenCalledTimes(1);

        // tras cancelar se puede volver a iniciar
        useStoreSessionStore.getState().init();
        expect(mocks.subscribeStoreAuth).toHaveBeenCalledTimes(2);
    });

    it('signOut llama al logout LOCAL de la tienda y limpia la sesion', async () => {
        const session = { user: { id: 'c1' } };
        mocks.getStoreSession.mockResolvedValue(session);
        useStoreSessionStore.getState().init();
        await vi.waitFor(() => expect(useStoreSessionStore.getState().session).toBe(session));

        await useStoreSessionStore.getState().signOut();

        expect(mocks.signOutStoreCustomer).toHaveBeenCalledTimes(1);
        expect(useStoreSessionStore.getState().session).toBeNull();
    });
});
