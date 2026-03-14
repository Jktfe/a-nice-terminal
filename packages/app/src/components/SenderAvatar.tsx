import { useState } from "react";
import { getSenderTheme } from "../utils/senderTheme.ts";

interface SenderAvatarProps {
  senderType?: string | null;
  senderName?: string | null;
  senderPersona?: string | null;
  senderCwd?: string | null;
  size?: number;
}

export default function SenderAvatar({ senderType, senderName, senderPersona, senderCwd, size = 20 }: SenderAvatarProps) {
  const theme = getSenderTheme(senderType);
  const Icon = theme.icon;
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative flex-shrink-0 cursor-default"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: size,
          height: size,
          backgroundColor: theme.bg,
          border: `1.5px solid ${theme.border}`,
        }}
      >
        <Icon style={{ width: size * 0.6, height: size * 0.6, color: theme.accent }} />
      </div>

      {showTooltip && (senderName || senderPersona || senderCwd) && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/10 shadow-xl text-xs whitespace-nowrap pointer-events-none">
          {senderName && <div className="font-medium" style={{ color: theme.accent }}>{senderName}</div>}
          {senderPersona && <div className="text-white/50">{senderPersona}</div>}
          {senderCwd && <div className="text-white/30 font-mono text-[10px]">{senderCwd}</div>}
        </div>
      )}
    </div>
  );
}
