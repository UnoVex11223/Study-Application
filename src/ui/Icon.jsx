// Small stroke icon set (24px grid, drawn for this app).
const PATHS = {
  today: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="M9 15l2 2 4-4"/></>,
  courses: <><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/></>,
  map: <><circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="6" r="2.3"/><circle cx="12" cy="17" r="2.3"/><path d="M8 8l3 7M16.5 8l-3.3 7M8.3 7h7.4"/></>,
  progress: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  play: <path d="M8 5.5v13l10.5-6.5z"/>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5"/>,
  x: <path d="M6 6l12 12M18 6L6 18"/>,
  chevron: <path d="M9 6l6 6-6 6"/>,
  back: <path d="M15 6l-6 6 6 6"/>,
  bulb: <><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  alert: <><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/></>,
  pen: <><path d="M3 21l3.5-1 11-11-2.5-2.5-11 11z"/><path d="M14 6l2.5 2.5M3 21h9"/></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/></>,
  zoomIn: <><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M11 8v6M8 11h6"/></>,
  zoomOut: <><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M8 11h6"/></>,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></>,
  pause: <path d="M9 5v14M15 5v14"/>,
  flag: <><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></>,
  wand: <><path d="M4 20L15 9"/><path d="M14 4v2M19 9h2M17.5 5.5l1.4-1.4M14 12v0M18 11l1.5 1.5"/></>,
  undo: <><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  unlock: <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></>,
  note: <><path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M9 13h6M9 17h4"/></>,
  shelf: <><path d="M3 20.5h18"/><rect x="4.5" y="4.5" width="3.6" height="16" rx=".8"/><rect x="9.8" y="7.5" width="3.6" height="13" rx=".8"/><path d="M15.2 9.3l3.4-.9 2.9 11.2-3.4.9z"/><path d="M6.3 8v2M11.6 11v2"/></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 1h13v-3"/><path d="M9 7h6"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/></>,
  volume: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/></>,
  mute: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></>,
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6"/>,
  covers: <><rect x="3.5" y="4" width="7.5" height="11.5" rx="1.2"/><rect x="13" y="4" width="7.5" height="11.5" rx="1.2"/><path d="M2.5 19.5h19"/></>,
  spines: <><path d="M5.5 19V6.5M9 19V4.5M12.5 19V7.5M16 19V5.5M19.5 19V8.5"/><path d="M2.5 19.5h19"/></>,
};

export default function Icon({ name, size = 18, stroke = 1.7, className, style }) {
  const filled = name === "play";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth={filled ? 0 : stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
