const PATHS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  down: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  volume: 'M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12',
  'volume-off': 'M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6',
  pip: 'M3 5h18v14H3zM12 12h7v5h-7z',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  'mic-off': 'M15 9.3V6a3 3 0 00-5.7-1.3M9 9v3a3 3 0 004.8 2.4M5 11a7 7 0 0011.5 5.3M19 11a7 7 0 01-.6 2.8M12 18v3M3 3l18 18',
  headphones: 'M4 15v-3a8 8 0 0116 0v3M4 15h3v5H4zM17 15h3v5h-3z',
  'headphones-off': 'M4 15v-3a8 8 0 0113.7-5.6M20 12v3M4 15h3v5H4zM17 15h3v5h-3zM3 3l18 18',
  plus: 'M12 5v14M5 12h14',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  camera: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  chat: 'M4 5h16v11H8l-4 4z',
  channels: 'M4 6h16M4 12h10M4 18h13',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  power: 'M12 3v8M6.3 6.3a8 8 0 1011.4 0',
  send: 'M4 12l16-8-6 16-2-6-8-2z',
  away: 'M12 7v5l3 3M12 21a9 9 0 110-18 9 9 0 010 18z',
}

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
