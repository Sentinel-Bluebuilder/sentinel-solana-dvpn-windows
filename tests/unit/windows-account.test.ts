// ─── KWIN-USER (the agent tools rc.9, Windows testing): the icacls account is written in, never %USERNAME% (PowerShell does not expand it) ───
import { describe, it, expect } from 'vitest';
import { windowsAccount, windowsSid, keyfileModeNext } from '../../src/cli/keystore';

describe('windowsAccount', () => {
  it('no SID: a domain account is DOMAIN\\user', () => expect(windowsAccount({ USERNAME: 'alice', USERDOMAIN: 'PC' }, null)).toBe('PC\\alice'));
  it('no SID, no domain: the user alone', () => expect(windowsAccount({ USERNAME: 'alice' }, null)).toBe('alice'));
  // KWIN-SID (rc9-c, Windows testing w11 over SSH): USERDOMAIN=WORKGROUP; "WORKGROUP\\user" has no mapping, the SID always does.
  it('USERDOMAIN=WORKGROUP: the icacls line grants by SID', () => {
    const acct = windowsAccount({ USERNAME: 'user', USERDOMAIN: 'WORKGROUP' }, 'S-1-5-21-111-222-333-1001');
    expect(acct).toBe('*S-1-5-21-111-222-333-1001');
    expect(keyfileModeNext('C:\\Users\\user\\k.json', 'win32', acct)).toBe('icacls "C:\\Users\\user\\k.json" /inheritance:r /remove:g *S-1-1-0 *S-1-5-11 *S-1-5-32-545 /grant:r "*S-1-5-21-111-222-333-1001:F", then devnet-dvpn agent up --yes');
  });
  it('USERDOMAIN=WORKGROUP and no SID: never "WORKGROUP\\user"', () => expect(windowsAccount({ USERNAME: 'user', USERDOMAIN: 'workgroup' }, null)).toBe('user'));
  it('windowsSid reads the SID from whoami /user /fo csv /nh', () => expect(windowsSid(() => '"w11\\user","S-1-5-21-111-222-333-1001"\r\n')).toBe('S-1-5-21-111-222-333-1001'));
  it('the Windows next never carries %USERNAME%', () => expect(keyfileModeNext('C:\\k.json', 'win32')).not.toMatch(/%USERNAME%/));
  it('negative control: the POSIX next is unchanged', () => expect(keyfileModeNext('/k.json', 'linux')).toBe('chmod 600 /k.json, then devnet-dvpn agent up --yes'));
});
