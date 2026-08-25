import { useEffect, useState } from 'react';

import { NominatimResult, searchGeocode } from './geocoding';

// Debounced Nominatim autocomplete, shared by app/atlas/index.tsx's own
// search bar and app/atlas/location.tsx's "search for the real place"
// recovery UI — identical logic in both, so it lives here once rather than
// being copy-pasted. Bounded to hubCenter when given (see
// lib/atlas/geocoding.ts's HUB_BOUND_DEGREES) — a local hub has no business
// suggesting a same-named place on another continent.
export function useGeocodeSuggestions(query: string, hubCenter: [number, number] | null) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      searchGeocode(q, hubCenter ?? undefined).then((results) => {
        if (cancelled) return;
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, hubCenter]);

  return { suggestions, showSuggestions, setShowSuggestions };
}
