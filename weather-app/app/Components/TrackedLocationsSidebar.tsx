// app/components/TrackedLocationsSidebar.tsx

'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { List, X } from 'lucide-react';

interface LocationData {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

type Props = {
  onSelectLocation: (loc: LocationData) => void;
  activeLocationId?: number;
};

export default function TrackedLocationsSidebar({ onSelectLocation, activeLocationId }: Props) {
  // Start closed by default; will flip in effect if screen ≥768px
  const [isOpen, setIsOpen] = useState(false);
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync open/close with viewport width
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(min-width: 768px)');
    const handleChange = (e: MediaQueryListEvent) => setIsOpen(e.matches);

    // Initialize
    setIsOpen(mql.matches);

    // Listen for resizes across the 768px threshold
    mql.addEventListener('change', handleChange);
    return () => {
      mql.removeEventListener('change', handleChange);
    };
  }, []);

  // Fetch tracked locations once
  useEffect(() => {
    async function fetchLocations() {
      try {
        const res = await fetch('/api/locations');
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = await res.json();
        setLocations(json.data);
      } catch (err: any) {
        console.error(err);
        setError('Failed to load locations');
      } finally {
        setLoading(false);
      }
    }
    fetchLocations();
  }, []);

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="fixed flex top-4 left-4 z-30 p-2 bg-gray-800/50 backdrop-blur-sm rounded-full hover:bg-gray-700/70 transition"
        aria-label={isOpen ? 'Close locations' : 'Open locations'}
      >
        {isOpen ? (
          <X className="w-3 h-3 text-yellow-400" />
        ) : (
          <>
            <List className="w-6 h-6 text-white" />
            <span className="hidden lg:inline text-yellow-400 mx-2">
              Tracked locations
            </span>
          </>
        )}
      </button>

      {/* Sidebar Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.3 }}
            className="fixed inset-y-0 left-0 z-20 w-64 bg-gray-800/70 backdrop-blur-md shadow-xl p-4 overflow-auto"
          >
            <h2 className="text-xl font-semibold text-yellow-400 ms-8 mb-4">
              Tracked Locations
            </h2>

            {loading ? (
              <p className="text-gray-400">Loading…</p>
            ) : error ? (
              <p className="text-red-400">{error}</p>
            ) : locations.length === 0 ? (
              <p className="text-gray-400">No locations tracked.</p>
            ) : (
              <ul className="space-y-2">
                {locations.map(loc => (
                  <li key={loc.id} className="bg-gray-500/80 rounded-md shadow-md">
                    <button
                      onClick={() => {
                        onSelectLocation(loc);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg transition
                        ${activeLocationId === loc.id
                          ? 'bg-teal-500/80 text-white font-semibold'
                          : 'hover:bg-gray-700/50 text-gray-200'}`}
                    >
                      {loc.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
