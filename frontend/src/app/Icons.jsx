/** Inline SVG icons — 24x24 viewBox, no emoji, no icon dependency. */
const S = ({ children, size = 18, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

export const IconStream = (p) => (
  <S {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </S>
);

export const IconToday = (p) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </S>
);

export const IconActivity = (p) => (
  <S {...p}>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </S>
);

export const IconSkills = (p) => (
  <S {...p}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-.91z" />
  </S>
);

export const IconPlugins = (p) => (
  <S {...p}>
    <path d="M9 3v4M15 3v4M5 7h14v6a7 7 0 0 1-14 0z" />
    <path d="M12 20v2" />
  </S>
);

export const IconSettings = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </S>
);

export const IconKill = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </S>
);

export const IconUndo = (p) => (
  <S {...p}>
    <path d="M3 7v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
  </S>
);

export const IconSun = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </S>
);

export const IconMoon = (p) => (
  <S {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </S>
);

export const IconSearch = (p) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </S>
);

export const IconSend = (p) => (
  <S {...p}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
  </S>
);

export const IconMail = (p) => (
  <S {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 7l10 6 10-6" />
  </S>
);

export const IconClock = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </S>
);

export const IconPlug = (p) => (
  <S {...p}>
    <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z" />
    <path d="M12 17v5" />
  </S>
);

export const IconSend2 = IconSend;
