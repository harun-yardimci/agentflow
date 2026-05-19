import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          4: 'var(--surface-4)',
          5: 'var(--surface-5)',
        },
        border: {
          primary: 'var(--border-primary)',
          secondary: 'var(--border-secondary)',
          subtle: 'var(--border-subtle)',
          hover: 'var(--border-hover)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          dim: 'var(--text-dim)',
        },
        accent: {
          orange: 'var(--accent-primary)',
          'orange-bg': 'var(--accent-primary-bg)',
          blue: 'var(--accent-info)',
          'blue-bg': 'var(--accent-info-bg)',
          green: 'var(--accent-success)',
          'green-bg': 'var(--accent-success-bg)',
          amber: 'var(--accent-warning)',
          'amber-bg': 'var(--accent-warning-bg)',
          red: 'var(--accent-danger)',
          'red-bg': 'var(--accent-danger-bg)',
          gray: 'var(--accent-neutral)',
        },
        status: {
          idle: 'var(--status-idle)',
          active: 'var(--status-active)',
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          error: 'var(--status-error)',
          rejected: 'var(--status-rejected)',
        },
        model: {
          claude: 'var(--model-claude)',
          gemini: 'var(--model-gemini)',
          codex: 'var(--model-codex)',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
        sans: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['0.9375rem', { lineHeight: '1.4', fontWeight: '600' }],
        heading: ['0.875rem', { lineHeight: '1.35', fontWeight: '600' }],
        body: ['0.75rem', { lineHeight: '1.5', fontWeight: '400' }],
        caption: ['0.6875rem', { lineHeight: '1.4', fontWeight: '500' }],
        micro: ['0.625rem', { lineHeight: '1.3', fontWeight: '500' }],
      },
      spacing: {
        0: 'var(--space-0)',
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
      },
    },
  },
};

export default config;
