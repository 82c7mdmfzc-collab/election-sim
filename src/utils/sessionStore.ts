const KEY = 'election-sim-session-v1';

export interface SessionData {
  lobbyId: string;
  localPlayerId: string;
}

export const saveSession = (d: SessionData): void =>
  localStorage.setItem(KEY, JSON.stringify(d));

export const loadSession = (): SessionData | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionData) : null;
  } catch {
    return null;
  }
};

export const clearSession = (): void => localStorage.removeItem(KEY);
