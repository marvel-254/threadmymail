/**
 * Icon set — SVG-based (Lucide-style), no emojis (DB rule).
 * All icons accept size + color, defaulting to theme tokens.
 */
import React from 'react';
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { colors } from '../theme/theme';

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

const base = (size: number, color: string, strokeWidth: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconPower = ({ size = 22, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <Line x1="12" y1="2" x2="12" y2="12" />
  </Svg>
);

export const IconMenu = ({ size = 22, color = colors.text, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Line x1="3" y1="6" x2="21" y2="6" />
    <Line x1="3" y1="12" x2="21" y2="12" />
    <Line x1="3" y1="18" x2="21" y2="18" />
  </Svg>
);

export const IconBack = ({ size = 22, color = colors.text, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Line x1="19" y1="12" x2="5" y2="12" />
    <Polyline points="12 19 5 12 12 5" />
  </Svg>
);

export const IconSend = ({ size = 22, color = colors.textOnPrimary, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Line x1="22" y1="2" x2="11" y2="13" />
    <Polygon points="22 2 15 22 11 13 2 9 22 2" />
  </Svg>
);

export const IconToday = ({ size = 22, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <Line x1="16" y1="2" x2="16" y2="6" />
    <Line x1="8" y1="2" x2="8" y2="6" />
    <Line x1="3" y1="10" x2="21" y2="10" />
  </Svg>
);

export const IconMail = ({ size = 22, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
    <Polyline points="22,6 12,13 2,6" />
  </Svg>
);

export const IconAgent = ({ size = 22, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
);

export const IconActivity = ({ size = 22, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Svg>
);

export const IconSettings = ({ size = 22, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

export const IconSparkle = ({ size = 18, color = colors.primary, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-.91L12 2z" />
  </Svg>
);

export const IconCheck = ({ size = 18, color = colors.success, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const IconX = ({ size = 18, color = colors.danger, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Line x1="18" y1="6" x2="6" y2="18" />
    <Line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

export const IconChevron = ({ size = 20, color = colors.textSubtle, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const IconPlus = ({ size = 20, color = colors.text, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const IconThumbUp = ({ size = 18, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </Svg>
);

export const IconThumbDown = ({ size = 18, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
  </Svg>
);

export const IconRefresh = ({ size = 18, color = colors.textMuted, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Polyline points="23 4 23 10 17 10" />
    <Path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </Svg>
);

export const IconWifi = ({ size = 18, color = colors.warn, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <Path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <Path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <Line x1="12" y1="20" x2="12.01" y2="20" />
  </Svg>
);

export const IconTrash = ({ size = 18, color = colors.danger, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Polyline points="3 6 5 6 21 6" />
    <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
);

export const IconTest = ({ size = 18, color = colors.accent, strokeWidth = 2 }: IconProps) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <Polyline points="22 4 12 14.01 9 11.01" />
  </Svg>
);
