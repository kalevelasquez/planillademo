import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock de supabase (admin client re-exportado por authService) ─────────────
// Builder encadenable: cada `await` consume el siguiente resultado de la cola.
const dbQueue: Array<{ data?: unknown; error?: unknown }> = [];
const dbCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];

const makeBuilder = (table: string) => {
    const ops: Array<[string, unknown[]]> = [];
    dbCalls.push({ table, ops });
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'update', 'is']) {
        builder[m] = (...args: unknown[]) => { ops.push([m, args]); return builder; };
    }
    builder.then = (resolve: (v: unknown) => void) => resolve(dbQueue.shift() ?? { data: [], error: null });
    return builder;
};

const storageUpload = vi.fn();
const storageRemove = vi.fn();
const storageGetPublicUrl = vi.fn();
const storageFrom = vi.fn();

vi.mock('./authService', () => ({
    supabase: {
        from: (table: string) => makeBuilder(table),
        storage: { from: (bucket: string) => storageFrom(bucket) },
        auth: { getUser: vi.fn() },
    },
}));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { storageService, validateProductImage, PRODUCT_IMAGE_MAX_BYTES } from './storageService';
import { productService } from './productService';

const file = (type: string, size = 1024, name = 'f.png') => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
};

const PUBLIC = 'https://x.supabase.co/storage/v1/object/public/product_images/';

const target = { id: 'p1', tenant_id: 't1', name: 'MANZANA', caliber: '100S', quality: 'PRIMERA' };

beforeEach(() => {
    dbQueue.length = 0;
    dbCalls.length = 0;
    storageUpload.mockReset().mockResolvedValue({ data: { path: 'ok' }, error: null });
    storageRemove.mockReset().mockResolvedValue({ data: [], error: null });
    storageGetPublicUrl.mockReset().mockImplementation((p: string) => ({ data: { publicUrl: PUBLIC + p } }));
    storageFrom.mockReset().mockReturnValue({
        upload: storageUpload, remove: storageRemove, getPublicUrl: storageGetPublicUrl,
    });
});

describe('validateProductImage', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp'])('acepta %s', (t) => {
        expect(validateProductImage(file(t))).toBeNull();
    });

    it('acepta exactamente 2 MB', () => {
        expect(validateProductImage(file('image/png', PRODUCT_IMAGE_MAX_BYTES))).toBeNull();
    });

    it.each(['application/pdf', 'image/gif', 'image/svg+xml', ''])('rechaza tipo %s con clave i18n', (t) => {
        expect(validateProductImage(file(t))).toBe('inventory.image.invalidType');
    });

    it('rechaza archivos sobre 2 MB', () => {
        expect(validateProductImage(file('image/png', PRODUCT_IMAGE_MAX_BYTES + 1))).toBe('inventory.image.tooLarge');
    });
});

describe('storageService.uploadProductImage', () => {
    it('sube al bucket product_images bajo la carpeta del tenant con nombre unico (cache busting)', async () => {
        const res = await storageService.uploadProductImage('t1', 'p1', file('image/png'));
        expect(storageFrom).toHaveBeenCalledWith('product_images');
        const [path, , opts] = storageUpload.mock.calls[0];
        expect(path).toMatch(/^t1\/p1-\d+\.png$/);
        expect(opts).toMatchObject({ contentType: 'image/png', upsert: false });
        expect(Number(opts.cacheControl)).toBeGreaterThanOrEqual(31536000);
        expect(res.publicUrl).toBe(PUBLIC + path);
        expect(res.path).toBe(path);
    });

    it('usa extension segun el mime (jpeg->jpg, webp->webp)', async () => {
        await storageService.uploadProductImage('t1', 'p1', file('image/jpeg'));
        await storageService.uploadProductImage('t1', 'p1', file('image/webp'));
        expect(storageUpload.mock.calls[0][0]).toMatch(/\.jpg$/);
        expect(storageUpload.mock.calls[1][0]).toMatch(/\.webp$/);
    });

    it('no sube si el archivo es invalido', async () => {
        await expect(storageService.uploadProductImage('t1', 'p1', file('application/pdf')))
            .rejects.toMatchObject({ i18nKey: 'inventory.image.invalidType' });
        expect(storageUpload).not.toHaveBeenCalled();
    });

    it('error de storage -> uploadError', async () => {
        storageUpload.mockResolvedValue({ data: null, error: { message: 'boom' } });
        await expect(storageService.uploadProductImage('t1', 'p1', file('image/png')))
            .rejects.toMatchObject({ i18nKey: 'inventory.image.uploadError' });
    });
});

describe('storageService.productImagePathFromUrl / removeProductImageByUrl', () => {
    it('extrae la ruta del objeto desde la URL publica', () => {
        expect(storageService.productImagePathFromUrl(PUBLIC + 't1/p1-1.png')).toBe('t1/p1-1.png');
        expect(storageService.productImagePathFromUrl('https://otro.com/a.png')).toBeNull();
        expect(storageService.productImagePathFromUrl(null)).toBeNull();
    });

    it('remove ignora URLs ajenas al bucket', async () => {
        await storageService.removeProductImagesByUrl(['https://otro.com/a.png']);
        expect(storageRemove).not.toHaveBeenCalled();
    });

    it('remove borra las rutas del bucket', async () => {
        await storageService.removeProductImagesByUrl([PUBLIC + 't1/a.png', PUBLIC + 't1/b.png']);
        expect(storageRemove).toHaveBeenCalledWith(['t1/a.png', 't1/b.png']);
    });
});

describe('productService.setProductImage', () => {
    const sibling = (id: string, image_url: string | null, name = 'MANZANA') =>
        ({ id, name, caliber: '100S', quality: 'PRIMERA', image_url });

    it('archivo invalido: no sube ni toca la BD', async () => {
        await expect(productService.setProductImage(target, file('application/pdf')))
            .rejects.toMatchObject({ i18nKey: 'inventory.image.invalidType' });
        expect(storageUpload).not.toHaveBeenCalled();
        expect(dbCalls).toHaveLength(0);
    });

    it('aplica la imagen a TODOS los lotes del grupo (nombre sin distinguir mayusculas), no a otros productos', async () => {
        dbQueue.push({ data: [sibling('p1', null), sibling('p2', null, 'Manzana'), sibling('p3', null, 'PERA')] }); // lotes
        dbQueue.push({ data: [{ id: 'p1' }, { id: 'p2' }] });                                                      // update
        const url = await productService.setProductImage(target, file('image/png'));

        expect(url).toMatch(/^https:\/\/x\.supabase\.co\/.*\/t1\/p1-\d+\.png$/);
        const update = dbCalls[1];
        const upd = update.ops.find(o => o[0] === 'update')!;
        expect(upd[1][0]).toEqual({ image_url: url });
        const inOp = update.ops.find(o => o[0] === 'in')!;
        expect(inOp[1]).toEqual(['id', expect.arrayContaining(['p1', 'p2'])]);
        expect((inOp[1][1] as string[])).not.toContain('p3');
    });

    it('limita la busqueda de lotes al tenant, calibre y calidad del producto', async () => {
        dbQueue.push({ data: [sibling('p1', null)] });
        dbQueue.push({ data: [{ id: 'p1' }] });
        await productService.setProductImage(target, file('image/png'));
        const eqs = dbCalls[0].ops.filter(o => o[0] === 'eq').map(o => o[1]);
        expect(eqs).toEqual(expect.arrayContaining([['tenant_id', 't1'], ['caliber', '100S'], ['quality', 'PRIMERA']]));
    });

    it('reemplazo: borra el objeto viejo solo si ya nadie lo referencia', async () => {
        const old = PUBLIC + 't1/p1-100.png';
        const shared = PUBLIC + 't1/otro-5.png';
        dbQueue.push({ data: [sibling('p1', old), sibling('p2', shared)] }); // lotes
        dbQueue.push({ data: [{ id: 'p1' }, { id: 'p2' }] });                // update
        dbQueue.push({ data: [{ image_url: shared }] });                     // aun referenciada
        await productService.setProductImage(target, file('image/png'));
        expect(storageRemove).toHaveBeenCalledWith(['t1/p1-100.png']);
    });

    it('si el UPDATE falla (error), borra el objeto recien subido y lanza uploadError', async () => {
        dbQueue.push({ data: [sibling('p1', null)] });
        dbQueue.push({ data: null, error: { message: 'rls' } });
        await expect(productService.setProductImage(target, file('image/png')))
            .rejects.toMatchObject({ i18nKey: 'inventory.image.uploadError' });
        const uploaded = storageUpload.mock.calls[0][0];
        expect(storageRemove).toHaveBeenCalledWith([uploaded]);
    });

    it('si el UPDATE no afecta filas (RLS silencioso) tambien hace rollback del objeto', async () => {
        dbQueue.push({ data: [sibling('p1', null)] });
        dbQueue.push({ data: [] });
        await expect(productService.setProductImage(target, file('image/png')))
            .rejects.toMatchObject({ i18nKey: 'inventory.image.uploadError' });
        expect(storageRemove).toHaveBeenCalledWith([storageUpload.mock.calls[0][0]]);
    });
});

describe('productService.removeProductImage', () => {
    it('pone image_url=NULL en el grupo y borra los objetos huerfanos', async () => {
        const old = PUBLIC + 't1/p1-100.png';
        dbQueue.push({ data: [{ id: 'p1', name: 'MANZANA', caliber: '100S', quality: 'PRIMERA', image_url: old }] });
        dbQueue.push({ data: [{ id: 'p1' }] });
        dbQueue.push({ data: [] });
        await productService.removeProductImage(target);
        const upd = dbCalls[1].ops.find(o => o[0] === 'update')!;
        expect(upd[1][0]).toEqual({ image_url: null });
        expect(storageRemove).toHaveBeenCalledWith(['t1/p1-100.png']);
    });
});
