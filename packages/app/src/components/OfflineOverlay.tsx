import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { WifiOff } from "lucide-react";
import { useStore } from "../store.ts";

export default function OfflineOverlay() {
  const { connected } = useStore();
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    if (connected) {
      setShowOverlay(false);
      return;
    }

    // Delay showing overlay to avoid flash on brief disconnects
    const timer = setTimeout(() => setShowOverlay(true), 2000);
    return () => clearTimeout(timer);
  }, [connected]);

  return (
    <AnimatePresence>
      {showOverlay && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          <div className="text-center px-6">
            <WifiOff className="w-10 h-10 text-white/30 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-white mb-2">
              ANT server is offline
            </h2>
            <p className="text-sm text-white/40 mb-6 max-w-xs mx-auto">
              Reconnecting automatically...
            </p>
            <div className="flex justify-center">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-2 h-2 bg-emerald-400 rounded-full"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
