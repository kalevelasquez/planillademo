import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CaptchaSlot } from './CaptchaSlot';

describe('CaptchaSlot (no-op en v1)', () => {
    it('no renderiza nada con el captcha apagado (VITE_STORE_CAPTCHA_ENABLED=false)', () => {
        const { container } = render(<CaptchaSlot enabled={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('aun encendido no inyecta widget en v1 (el hook existe, el proveedor no)', () => {
        const { container } = render(<CaptchaSlot enabled onToken={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });
});
