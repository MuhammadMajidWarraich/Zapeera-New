import { describe, it, expect } from '@jest/globals';
import {
  parseNetstatListeningPids,
  parseLsofPids,
  isZapeeraHealthPayload,
  findPortOwnerPids,
} from '../src/utils/port-manager';

describe('parseNetstatListeningPids (Windows)', () => {
  it('extracts LISTENING pids for the exact port', () => {
    const output = [
      'TCP    0.0.0.0:4200    0.0.0.0:0    LISTENING    1234',
      'TCP    0.0.0.0:4201    0.0.0.0:0    LISTENING    9999',
      'TCP    127.0.0.1:4200  127.0.0.1:0  LISTENING    5678',
      'TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    7777',
    ].join('\r\n');

    expect(parseNetstatListeningPids(output, 4200)).toEqual(['1234', '5678']);
    expect(parseNetstatListeningPids(output, 8080)).toEqual(['7777']);
    expect(parseNetstatListeningPids(output, 9999)).toEqual([]);
  });

  it('ignores non-listening and non-numeric lines', () => {
    const output = [
      'TCP    0.0.0.0:4200    0.0.0.0:0    TIME_WAIT    1234',
      '  Active Connections',
      'TCP    0.0.0.0:4200    0.0.0.0:0    LISTENING    12-34',
      'TCP    [::]:4200      [::]:0        LISTENING    5555',
    ].join('\r\n');

    expect(parseNetstatListeningPids(output, 4200)).toEqual(['5555']);
  });
});

describe('parseLsofPids (macOS/Linux)', () => {
  it('parses one pid per line', () => {
    expect(parseLsofPids('1234\n5678\n')).toEqual(['1234', '5678']);
  });

  it('returns empty for empty output', () => {
    expect(parseLsofPids('')).toEqual([]);
  });
});

describe('isZapeeraHealthPayload', () => {
  it('accepts the Zapeera /health payload', () => {
    expect(isZapeeraHealthPayload({ status: 'ok', database: { type: 'sqlite', mode: 'sqlite' } })).toBe(true);
    expect(isZapeeraHealthPayload({ status: 'ok', database: {} })).toBe(true);
  });

  it('accepts the Zapeera root payload', () => {
    expect(isZapeeraHealthPayload({ message: 'Zapeera Business Management API', version: '1.0.0' })).toBe(true);
  });

  it('rejects unrelated services', () => {
    expect(isZapeeraHealthPayload({ status: 'ok', version: '1.0' })).toBe(false);
    expect(isZapeeraHealthPayload({ message: 'Hello World' })).toBe(false);
    expect(isZapeeraHealthPayload('nope')).toBe(false);
    expect(isZapeeraHealthPayload(null)).toBe(false);
  });
});

describe('findPortOwnerPids (Issue 7 — verify before stopping)', () => {
  it('never reports a non-Zapeera listener as stoppable (confirmedZapeera=false)', async () => {
    // exec stub returns a LISTENING pid (Windows netstat format); the probe
    // will fail (no real server), so the owner must NOT be confirmed as
    // Zapeera. The platform is injected so the test is deterministic on CI
    // (Linux) as well.
    const owner = await findPortOwnerPids(59999, (() => {
      let called = false;
      return (): string => {
        if (!called) {
          called = true;
          return 'TCP    0.0.0.0:59999    0.0.0.0:0    LISTENING    4242\r\n';
        }
        throw new Error('no more calls');
      };
    })() as any, 'win32');

    expect(owner.pids).toEqual(['4242']);
    expect(owner.confirmedZapeera).toBe(false);
  });

  it('parses the lsof output format on Linux/macOS (confirmedZapeera=false)', async () => {
    const owner = await findPortOwnerPids(59997, (() => {
      let called = false;
      return (): string => {
        if (!called) {
          called = true;
          return '4242\n';
        }
        throw new Error('no more calls');
      };
    })() as any, 'linux');

    expect(owner.pids).toEqual(['4242']);
    expect(owner.confirmedZapeera).toBe(false);
  });

  it('returns empty pids when the port is free', async () => {
    const owner = await findPortOwnerPids(59998, (() => {
      return (): string => {
        throw new Error('no listeners');
      };
    })() as any);

    expect(owner.pids).toEqual([]);
    expect(owner.confirmedZapeera).toBe(false);
  });
});
