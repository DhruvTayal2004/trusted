import { Platform } from 'react-native';

/** DukaanOS design tokens: high contrast, large targets, works in bright shop light. */
export const colors = {
  bg: '#F6F4EE',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEBE2',
  border: '#DDD7C9',
  text: '#1B1A17',
  textMuted: '#6B665C',
  textOnPrimary: '#FFFFFF',
  primary: '#1F6F43', // kirana green
  primaryDark: '#174F31',
  accent: '#D97706', // haldi
  danger: '#B42318',
  dangerBg: '#FEE4E2',
  success: '#067647',
  successBg: '#D1FADF',
  warning: '#B54708',
  warningBg: '#FEF0C7',
  info: '#175CD3',
  infoBg: '#D1E9FF',
  cash: '#1F6F43',
  upi: '#175CD3',
  credit: '#B54708',
  overlay: 'rgba(0,0,0,0.45)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const font = {
  regular: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, display: 36 },
};

export const touch = { min: 48, big: 64, huge: 88 } as const;
