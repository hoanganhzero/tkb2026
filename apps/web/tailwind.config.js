/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#F2F4F7',
        surface: '#FFFFFF',
        sunken: '#E7EAF0',
        hover: '#EDF0F5',
        hair: '#E3E7EE',
        solid: '#C9D0DB',
        strong: '#8A93A3',
        ink: '#131A24',
        'ink-2': '#5B6472',
        'ink-3': '#8A93A3',
        brand: { 900: '#0F2A5C', 700: '#1B4A9C', 600: '#2563C7', 100: '#DCE8FB' },
        ok: { bg: '#D8F3E3', line: '#2F9E68' },
        warn: { bg: '#FDF0CE', line: '#C08A12' },
        block: { bg: '#FBDDDD', line: '#C43D3D' },
        pin: '#6B47C9'
      },
      fontFamily: {
        ui: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
        data: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      fontSize: {
        cell: ['12px', '14px']
      }
    }
  },
  plugins: []
};
