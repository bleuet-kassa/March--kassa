import { useState, type FormEvent } from 'react';
import { login } from '../api/client';
import { setSessie } from '../auth';

// Eenvoudig inlogscherm voor de verkoper. Na succes wordt de verkoper lokaal
// bewaard en meegestuurd bij elke verkoop (verschijnt op het ticket).
export function Login({ onIngelogd }: { onIngelogd: () => void }) {
  const [email, setEmail] = useState('kassa@winkel.be');
  const [wachtwoord, setWachtwoord] = useState('');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  async function verstuur(e: FormEvent) {
    e.preventDefault();
    setFout('');
    setBezig(true);
    try {
      const g = await login(email.trim(), wachtwoord);
      setSessie(g);
      onIngelogd();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Inloggen mislukt');
    } finally {
      setBezig(false);
    }
  }

  return (
    <div style={{ maxWidth: 320, margin: '10vh auto' }}>
      <h2>Aanmelden</h2>
      <form onSubmit={verstuur}>
        <label style={{ fontSize: 13, color: '#666' }}>E-mail</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: '100%', padding: 10, boxSizing: 'border-box', marginBottom: 10 }}
        />
        <label style={{ fontSize: 13, color: '#666' }}>Wachtwoord</label>
        <input
          type="password"
          value={wachtwoord}
          onChange={(e) => setWachtwoord(e.target.value)}
          autoFocus
          style={{ width: '100%', padding: 10, boxSizing: 'border-box', marginBottom: 12 }}
        />
        {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
        <button
          type="submit"
          disabled={bezig}
          style={{ width: '100%', padding: 12, fontWeight: 700, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          {bezig ? 'Bezig…' : 'Aanmelden'}
        </button>
      </form>
    </div>
  );
}
