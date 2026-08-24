import { PATH_METADATA } from '@nestjs/common/constants';
import { CheckoutController } from './checkout.controller';

describe('CheckoutController preview route', () => {
  it('exposes a protected settlement preview endpoint', () => {
    const preview = (
      CheckoutController.prototype as unknown as { preview?: unknown }
    ).preview;

    expect(preview).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, preview as object)).toBe(
      ':id/preview',
    );
  });
});
