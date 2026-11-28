import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
}));

vi.mock('../config/storeSupabaseClient', () => ({
    storeSupabase: {
        auth: {
            signInWithPassword: mocks.signInWithPassword,
            signUp: mocks.signUp,
            signOut: mocks.signOut,
            getSession: mocks.getSession,
            onAuthStateChange: mocks.onAuthStateChange,
        },
    },
}));
// El cliente ADMIN jamas debe tocarse desde la auth de la tienda.
vi.mock('../config/supabaseClient', () => {
    throw new Error('storeAuthService NO debe importar el cliente admin');
});

import {
    signInStoreCustomer,
    signUpStoreCustomer,
    signOutStoreCustomer,
    getStoreSession,
    subscribeStoreAuth,
} from './storeAuthService';

const REG = {
    email: ' Ana@Example.com ',
    password: 'Secreta123',
    fullName: ' Ana Perez ',
    phone: '70001111',
    address: 'Calle 1',
    department: 'San Salvador',
    municipality: 'Soyapango',
};

beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/cuenta/registro');
});

describe('signInStoreCustomer', () => {
    it('usa el cliente de tienda con email normalizado y sin captcha si no se da', async () => {
        mocks.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
        await signInStoreCustomer({ email: '  Ana@Example.com ', password: 'x' });
        expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@example.com', password: 'x' });
    });

    it('pasa captchaToken en options cuando se provee', async () => {
        mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
        await signInStoreCustomer({ email: 'a@b.co', password: 'x', captchaToken: 'tok' });
        expect(mocks.signInWithPassword).toHaveBeenCalledWith({
            email: 'a@b.co',
            password: 'x',
            options: { captchaToken: 'tok' },
        });
    });

    it.each([
        [{ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'store.errors.invalid_credentials'],
        [{ code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' }, 'store.errors.email_unconfirmed'],
        [{ code: 'over_request_rate_limit', status: 429, message: 'rate' }, 'store.errors.rate_limited'],
        [{ status: 400, message: 'Invalid login credentials' }, 'store.errors.invalid_credentials'],
        [{ status: 500, message: 'database exploded' }, 'store.errors.generic'],
    ])('mapea el error de auth %j a %s sin filtrar el mensaje', async (authError, key) => {
        mocks.signInWithPassword.mockResolvedValue({ data: {}, error: authError });
        const err = await signInStoreCustomer({ email: 'a@b.co', password: 'x' }).catch((e) => e);
        expect(err.i18nKey).toBe(key);
        expect(err.message).toBe(key);
    });

    it('red caida => generic', async () => {
        mocks.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(signInStoreCustomer({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
            i18nKey: 'store.errors.generic',
        });
    });
});

describe('signUpStoreCustomer', () => {
    it('envia SOLO datos de contacto en metadata (nunca roles/tenant) y redirige a /cuenta/confirmado', async () => {
        mocks.signUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [{}] }, session: null }, error: null });

        await signUpStoreCustomer(REG);

        expect(mocks.signUp).toHaveBeenCalledTimes(1);
        const arg = mocks.signUp.mock.calls[0][0];
        expect(arg.email).toBe('ana@example.com');
        expect(arg.password).toBe('Secreta123');
        expect(arg.options.emailRedirectTo).toBe(`${window.location.origin}/cuenta/confirmado`);
        expect(arg.options.data).toEqual({
            full_name: 'Ana Perez',
            phone: '70001111',
            address: 'Calle 1',
            department: 'San Salvador',
            municipality: 'Soyapango',
        });
        expect(Object.keys(arg.options.data)).not.toEqual(expect.arrayContaining(['roles', 'tenant_id', 'role']));
        expect(arg.options.captchaToken).toBeUndefined();
    });

    it('campos opcionales vacios no se mandan; captchaToken se manda si existe', async () => {
        mocks.signUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });
        await signUpStoreCustomer({ email: 'a@b.co', password: 'Secreta123', fullName: 'Ana', phone: '7000', captchaToken: 'tk' });
        const arg = mocks.signUp.mock.calls[0][0];
        expect(arg.options.data).toEqual({ full_name: 'Ana', phone: '7000' });
        expect(arg.options.captchaToken).toBe('tk');
    });

    it('email duplicado (identities vacio, respuesta ofuscada) se trata como exito: no filtra que existe', async () => {
        mocks.signUp.mockResolvedValue({ data: { user: { id: 'u9', identities: [] }, session: null }, error: null });
        await expect(signUpStoreCustomer(REG)).resolves.toBeUndefined();
    });

    it('user_already_exists tambien se trata como exito', async () => {
        mocks.signUp.mockResolvedValue({ data: {}, error: { code: 'user_already_exists', status: 422, message: 'exists' } });
        await expect(signUpStoreCustomer(REG)).resolves.toBeUndefined();
    });

    it.each([
        [{ code: 'signup_disabled', status: 422, message: 'Signups not allowed for this instance' }, 'store.errors.signup_unavailable'],
        [{ code: 'email_provider_disabled', status: 422, message: 'Email signups are disabled' }, 'store.errors.signup_unavailable'],
        [{ status: 422, message: 'Signups not allowed for this instance' }, 'store.errors.signup_unavailable'],
        [{ code: 'weak_password', status: 422, message: 'Password should be at least 6 characters' }, 'store.errors.weak_password'],
        [{ code: 'over_email_send_rate_limit', status: 429, message: 'rate' }, 'store.errors.rate_limited'],
        [{ code: 'validation_failed', status: 400, message: 'Unable to validate email address' }, 'store.errors.invalid_email'],
        [{ status: 500, message: 'Database error saving new user' }, 'store.errors.generic'],
    ])('mapea el error de registro %j a %s', async (authError, key) => {
        mocks.signUp.mockResolvedValue({ data: {}, error: authError });
        const err = await signUpStoreCustomer(REG).catch((e) => e);
        expect(err.i18nKey).toBe(key);
    });

    it('excepcion de red => generic (no crashea)', async () => {
        mocks.signUp.mockRejectedValue(new Error('boom'));
        await expect(signUpStoreCustomer(REG)).rejects.toMatchObject({ i18nKey: 'store.errors.generic' });
    });
});

describe('signOutStoreCustomer', () => {
    it("cierra SOLO la sesion local de la tienda (scope 'local'); nunca global/others", async () => {
        mocks.signOut.mockResolvedValue({ error: null });
        await signOutStoreCustomer();
        expect(mocks.signOut).toHaveBeenCalledTimes(1);
        expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('un error en signOut no rompe (la UI igual limpia su estado)', async () => {
        mocks.signOut.mockResolvedValue({ error: { message: 'x' } });
        await expect(signOutStoreCustomer()).resolves.toBeUndefined();
        mocks.signOut.mockRejectedValue(new Error('net'));
        await expect(signOutStoreCustomer()).resolves.toBeUndefined();
    });
});

describe('getStoreSession / subscribeStoreAuth', () => {
    it('getStoreSession devuelve la sesion o null (incluye fallos)', async () => {
        mocks.getSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } }, error: null });
        expect(await getStoreSession()).toEqual({ access_token: 't' });
        mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
        expect(await getStoreSession()).toBeNull();
        mocks.getSession.mockRejectedValueOnce(new Error('x'));
        expect(await getStoreSession()).toBeNull();
    });

    it('subscribeStoreAuth reenvia sesiones del cliente de tienda y devuelve el unsubscribe', () => {
        const unsubscribe = vi.fn();
        let handler: (e: string, s: unknown) => void = () => {};
        mocks.onAuthStateChange.mockImplementation((cb) => {
            handler = cb;
            return { data: { subscription: { unsubscribe } } };
        });
        const seen: unknown[] = [];
        const stop = subscribeStoreAuth((s) => seen.push(s));
        handler('SIGNED_IN', { user: { id: 'u1' } });
        handler('SIGNED_OUT', null);
        expect(seen).toEqual([{ user: { id: 'u1' } }, null]);
        stop();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
