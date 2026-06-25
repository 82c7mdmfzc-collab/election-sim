import { describe, it, expect } from 'vitest';
import { parseDailyStatus } from './profile';

describe('parseDailyStatus', () => {
  it('returns null for empty / never-played / non-object input', () => {
    expect(parseDailyStatus({})).toBeNull();
    expect(parseDailyStatus(null)).toBeNull();
    expect(parseDailyStatus(undefined)).toBeNull();
    expect(parseDailyStatus('nope')).toBeNull();
    expect(parseDailyStatus({ count: 3 })).toBeNull(); // no lastDate
  });

  it('maps the server jsonb onto the local shape', () => {
    expect(parseDailyStatus({
      count: 4,
      lastDate: '2026-06-22',
      lastWonDate: '2026-06-21',
      lastEv: 312,
    })).toEqual({
      lastPlayedDate: '2026-06-22',
      lastWonDate: '2026-06-21',
      streak: 4,
      lastEv: 312,
    });
  });

  it('defaults missing/blank fields safely', () => {
    expect(parseDailyStatus({ lastDate: '2026-06-22' })).toEqual({
      lastPlayedDate: '2026-06-22',
      lastWonDate: null,
      streak: 0,
      lastEv: 0,
    });
    expect(parseDailyStatus({ lastDate: '2026-06-22', lastWonDate: '' })).toEqual({
      lastPlayedDate: '2026-06-22',
      lastWonDate: null,
      streak: 0,
      lastEv: 0,
    });
  });
});
