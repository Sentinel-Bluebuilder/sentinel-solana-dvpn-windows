// Desktop words for an empty settings copy (Q0544): Install service rewrites it. Android carries phone words in its
// own src/shared/settings-copy.ts (no Install service there), so this literal lives in a desktop platform test.
import { describe, expect, it } from 'vitest';
import { EMPTY_SETTINGS_COPY, unreadableSettingsCopy } from '../../../src/shared/settings-copy';

describe('desktop settings-copy words', () => {
  it('an empty copy names Install service; a missing one says install first', () => {
    expect(EMPTY_SETTINGS_COPY).toMatch(/is empty.*Install service/);
    expect(unreadableSettingsCopy(false)).toMatch(/Install the service first/);
  });
});
