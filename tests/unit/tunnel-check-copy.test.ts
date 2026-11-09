// Q0357: dvpnd's post-connect tunnel check ends a session that carries nothing; the app must say why
// (never the generic "tunnel didn't come up" copy, never the TLS-interception copy).
import { describe, expect, it } from 'vitest';
import { connectErrorCopy } from '../../src/core/session/state';

const LARGE =
  'StartSession: unknown: this network drops large packets, so the tunnel cannot carry traffic; a node with V2Ray or Xray usually works ' +
  '(after clamping TCP to a 1280-byte path: fetching https://www.cloudflare.com/cdn-cgi/trace through the tunnel: ' +
  'Get "https://www.cloudflare.com/cdn-cgi/trace": tls: failed to verify certificate: x509: certificate signed by unknown authority)';
const DEAD =
  'StartSession: unknown: no traffic passes through the tunnel: the node accepted the session but nothing comes back; ' +
  'try another node or protocol (connecting to www.google.com:443 through the tunnel: not ready)';

describe('tunnel check copy (Q0357)', () => {
  it('a path that drops large packets says so and points to a TCP protocol', () => {
    const c = connectErrorCopy(LARGE);
    expect(c.code).toBe('tunnel-mtu');
    expect(c.message).toMatch(/drops large packets/);
    expect(c.message).toMatch(/V2Ray or Xray/);
    expect(c.action).toBe('Try another protocol');
    expect(c.retry).toBe(false);
  });

  it('a dead tunnel is not mistaken for a tunnel that never came up', () => {
    const c = connectErrorCopy(DEAD);
    expect(c.code).toBe('tunnel-dead');
    expect(c.message).toMatch(/no traffic passes/);
    expect(c.retry).toBe(true);
  });

  it('the generic tunnel copy is unchanged', () => {
    expect(connectErrorCopy('StartSession: failed precondition: starting service: handshake did not complete').code).toBe('tunnel-failed');
  });
});
