// ─── appUserAccount: the account setup-daemon.ps1 adds to the sentinel-dvpn group (rc2, connect-de) ───
// Windows OpenSSH on a workgroup machine sets USERDOMAIN=WORKGROUP, so `WORKGROUP\ddv` reached net.exe
// ("no such global user or group"); as SYSTEM the machine account `HOST$` reached dq(), which refuses `$`.
import { describe, it, expect } from 'vitest';
import { elevatedArgLine } from '../../../src/main/system/elevate';

const { appUserAccount } = await import('../../../src/main/daemon/manager');

describe('appUserAccount', () => {
  it('USERDOMAIN=WORKGROUP (Windows OpenSSH, no domain): the computer is the domain', () => {
    expect(appUserAccount({ USERDOMAIN: 'WORKGROUP', COMPUTERNAME: 'ddv3-dvw-proof', USERNAME: 'ddv' })).toBe('ddv3-dvw-proof\\ddv');
    expect(appUserAccount({ USERDOMAIN: 'workgroup', COMPUTERNAME: 'PC1', USERNAME: 'ddv' })).toBe('PC1\\ddv');
  });
  it('no USERDOMAIN: the computer is the domain', () => {
    expect(appUserAccount({ COMPUTERNAME: 'PC1', USERNAME: 'ddv' })).toBe('PC1\\ddv');
  });
  it('negative control: a real domain keeps it', () => {
    expect(appUserAccount({ USERDOMAIN: 'CORP', COMPUTERNAME: 'PC1', USERNAME: 'user' })).toBe('CORP\\user');
    expect(appUserAccount({ USERDOMAIN: 'PC1', COMPUTERNAME: 'PC1', USERNAME: 'user' })).toBe('PC1\\user');
  });
  it('the machine account (SYSTEM, a service) gives no user, so no elevated step gets `$`', () => {
    expect(appUserAccount({ USERDOMAIN: 'WORKGROUP', COMPUTERNAME: 'ddv3-dvw-proof', USERNAME: 'ddv3-dvw-proof$' })).toBe('');
  });
  it('the fixed account passes the elevated-step check; the old WORKGROUP one with `$` did not', () => {
    expect(() => elevatedArgLine('C:\\x\\setup-daemon.ps1', { User: appUserAccount({ USERDOMAIN: 'WORKGROUP', COMPUTERNAME: 'ddv3-dvw-proof', USERNAME: 'ddv' }) })).not.toThrow();
    expect(() => elevatedArgLine('C:\\x\\setup-daemon.ps1', { User: 'WORKGROUP\\ddv3-dvw-proof$' })).toThrow(/refusing unsafe argument/);
  });
  it('CODE-AUDIT U-16: a user folder with letters outside ASCII passes; quotes, $, ` ; & still refused', () => {
    for (const p of ['C:\\Users\\José\\AppData\\Local\\Temp\\devnet-dvpn-ab.json', 'C:\\Users\\Müller\\x.json', 'C:\\Users\\李\\x.json']) {
      expect(() => elevatedArgLine('x.ps1', { Result: p })).not.toThrow();
    }
    for (const bad of ["C:\\Users\\O'Brien\\x", 'a"b', 'a$b', 'a`b', 'a;b', 'a&b', 'a\nb']) {
      expect(() => elevatedArgLine('x.ps1', { Result: bad })).toThrow(/refusing unsafe argument/);
    }
  });
  it('no USERNAME at all: empty', () => {
    expect(appUserAccount({})).toBe('');
  });
});
