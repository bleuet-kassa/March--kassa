import { useEffect, useRef, useState } from 'react';
import { getVerkoper } from './auth';

// Verborgen "Verwijderen"-knoppen (verkopen, cadeaubonnen): enkel voor een ingelogde beheerder,
// en pas na de toetsenreeks "D", "+", "Enter" na elkaar (niet tijdens het typen in een veld).
// Daarna blijft de knop zichtbaar zolang het scherm openstaat; bij het verlaten reset dit vanzelf.
// De server controleert zelf ook dat het een beheerder is.
export function useVerwijderSneltoets(): { isBeheerder: boolean; toonVerwijder: boolean } {
  const rol = getVerkoper()?.rol;
  const isBeheerder = rol === 'BEHEER' || rol === 'BEHEERDER';
  const [toonVerwijder, setToonVerwijder] = useState(false);
  const stap = useRef(0); // 0 = wacht op D, 1 = D gehad (wacht op +), 2 = + gehad (wacht op Enter)
  useEffect(() => {
    if (!isBeheerder) return; // geen sneltoets voor niet-beheerders
    function opToets(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // niet tijdens typen
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; // modifiers breken de reeks niet af
      // "+" komt afhankelijk van toetsenbord/lay-out binnen als '+', '=' (Shift+=),
      // of via de code Equal/NumpadAdd — we aanvaarden ze allemaal.
      const isPlus = e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal';
      if (stap.current === 0 && (e.key === 'd' || e.key === 'D')) { stap.current = 1; return; }
      if (stap.current === 1 && isPlus) { stap.current = 2; return; }
      if (stap.current === 2 && e.key === 'Enter') { setToonVerwijder(true); stap.current = 0; return; }
      stap.current = 0; // elke andere toets begint de reeks opnieuw
    }
    window.addEventListener('keydown', opToets);
    return () => window.removeEventListener('keydown', opToets);
  }, [isBeheerder]);
  return { isBeheerder, toonVerwijder: isBeheerder && toonVerwijder };
}
