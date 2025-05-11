// app/components/NotificationsPanel.tsx
'use client';

import { FC } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  notifications: string[];
  onClose: () => void;
}

const NotificationsPanel: FC<Props> = ({ isOpen, notifications, onClose }) => (
  <AnimatePresence>
    {isOpen && (
      <motion.aside
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ type: 'tween', duration: 0.3 }}
        className="fixed top-0 right-0 h-full w-80 bg-gray-800/90 backdrop-blur-lg p-4 overflow-y-auto z-30 flex flex-col"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl text-white font-semibold">Notifications</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-700/50">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {notifications.length === 0 ? (
          <p className="text-gray-400">No updates yet.</p>
        ) : (
          <ul className="space-y-2">
            {notifications.map((note, i) => (
              <li
                key={i}
                className="text-white bg-gray-700/50 px-3 py-2 rounded-lg break-words"
              >
                {note}
              </li>
            ))}
          </ul>
        )}
      </motion.aside>
    )}
  </AnimatePresence>
);

export default NotificationsPanel;
