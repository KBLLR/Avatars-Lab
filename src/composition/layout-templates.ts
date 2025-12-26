/**
 * Layout Templates
 * Pre-defined composition layouts for text positioning
 */

import type { LayoutTemplate, ColorScheme } from './types';

// Layout template definitions
export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  {
    id: 'hero',
    name: 'Hero',
    description: 'Large title at top, content flows below',
    gridAreas: '"title title" "meta desc" "sig sig"',
    positions: {
      title: { gridArea: 'title', textAlign: 'left' },
      meta: { gridArea: 'meta', textAlign: 'left' },
      desc: { gridArea: 'desc', textAlign: 'right' },
      sig: { gridArea: 'sig', textAlign: 'left' }
    }
  },
  {
    id: 'split',
    name: 'Split',
    description: '50/50 vertical split layout',
    gridAreas: '"title meta" "title desc" "sig sig"',
    positions: {
      title: { gridArea: 'title', textAlign: 'left' },
      meta: { gridArea: 'meta', textAlign: 'right' },
      desc: { gridArea: 'desc', textAlign: 'right' },
      sig: { gridArea: 'sig', textAlign: 'center' }
    }
  },
  {
    id: 'corner',
    name: 'Corner',
    description: 'Content anchored to corners',
    gridAreas: '"title . meta" ". . ." "sig desc desc"',
    positions: {
      title: { gridArea: 'title', textAlign: 'left' },
      meta: { gridArea: 'meta', textAlign: 'right' },
      desc: { gridArea: 'desc', textAlign: 'right' },
      sig: { gridArea: 'sig', textAlign: 'left' }
    }
  },
  {
    id: 'full',
    name: 'Full Bleed',
    description: 'Centered content with maximum impact',
    gridAreas: '". . ." "title title title" "meta meta meta" ". . ."',
    positions: {
      title: { gridArea: 'title', textAlign: 'center' },
      meta: { gridArea: 'meta', textAlign: 'center' },
      desc: { gridArea: 'meta', textAlign: 'center' },
      sig: { gridArea: 'meta', textAlign: 'center' }
    }
  },
  {
    id: 'frame',
    name: 'Frame',
    description: 'Text as border around content',
    gridAreas: '"title title title" "sig . meta" "desc desc desc"',
    positions: {
      title: { gridArea: 'title', textAlign: 'center' },
      meta: { gridArea: 'meta', textAlign: 'right' },
      desc: { gridArea: 'desc', textAlign: 'center' },
      sig: { gridArea: 'sig', textAlign: 'left' }
    }
  },
  {
    id: 'diagonal',
    name: 'Diagonal',
    description: 'Elements arranged on diagonal axis',
    gridAreas: '"title . ." ". meta ." ". . desc"',
    positions: {
      title: { gridArea: 'title', textAlign: 'left', transform: 'rotate(-5deg)' },
      meta: { gridArea: 'meta', textAlign: 'center' },
      desc: { gridArea: 'desc', textAlign: 'right', transform: 'rotate(-5deg)' },
      sig: { top: '90%', left: '5%', textAlign: 'left' }
    }
  },
  {
    id: 'asymmetric',
    name: 'Asymmetric',
    description: 'Intentionally unbalanced composition',
    gridAreas: '". title title" ". title title" "meta . ." "desc . sig"',
    positions: {
      title: { gridArea: 'title', textAlign: 'right' },
      meta: { gridArea: 'meta', textAlign: 'left' },
      desc: { gridArea: 'desc', textAlign: 'left' },
      sig: { gridArea: 'sig', textAlign: 'right' }
    }
  },
  {
    id: 'vertical',
    name: 'Vertical',
    description: 'Stacked vertical arrangement',
    gridAreas: '"title" "meta" "desc" "sig"',
    positions: {
      title: { gridArea: 'title', textAlign: 'center' },
      meta: { gridArea: 'meta', textAlign: 'center' },
      desc: { gridArea: 'desc', textAlign: 'center' },
      sig: { gridArea: 'sig', textAlign: 'center' }
    }
  }
];

// Color scheme presets
export const COLOR_SCHEMES: ColorScheme[] = [
  // Monochrome
  {
    id: 'mono-dark',
    name: 'Dark Mono',
    category: 'mono',
    colors: { background: '#0a0a0f', foreground: '#fafafa', accent: '#666666' }
  },
  {
    id: 'mono-light',
    name: 'Light Mono',
    category: 'mono',
    colors: { background: '#fafafa', foreground: '#0a0a0f', accent: '#888888' }
  },
  {
    id: 'mono-mid',
    name: 'Mid Gray',
    category: 'mono',
    colors: { background: '#2a2a2a', foreground: '#e0e0e0', accent: '#505050' }
  },

  // Warm
  {
    id: 'warm-sunset',
    name: 'Sunset',
    category: 'warm',
    colors: { background: '#1a0a05', foreground: '#ffb347', accent: '#ff5f7a' }
  },
  {
    id: 'warm-ember',
    name: 'Ember',
    category: 'warm',
    colors: { background: '#150505', foreground: '#ff6b6b', accent: '#ffa502' }
  },
  {
    id: 'warm-terracotta',
    name: 'Terracotta',
    category: 'warm',
    colors: { background: '#2d1810', foreground: '#e8a87c', accent: '#c38d9e' }
  },

  // Cool
  {
    id: 'cool-arctic',
    name: 'Arctic',
    category: 'cool',
    colors: { background: '#050a14', foreground: '#5bf2d6', accent: '#00d9ff' }
  },
  {
    id: 'cool-ocean',
    name: 'Ocean',
    category: 'cool',
    colors: { background: '#0a1628', foreground: '#64b5f6', accent: '#4fc3f7' }
  },
  {
    id: 'cool-lavender',
    name: 'Lavender',
    category: 'cool',
    colors: { background: '#0f0a1a', foreground: '#a78bfa', accent: '#818cf8' }
  },

  // Neon
  {
    id: 'neon-cyber',
    name: 'Cyberpunk',
    category: 'neon',
    colors: { background: '#0a0014', foreground: '#ff00ff', accent: '#00ffff', secondary: '#ffff00' }
  },
  {
    id: 'neon-matrix',
    name: 'Matrix',
    category: 'neon',
    colors: { background: '#000a00', foreground: '#00ff41', accent: '#008f11' }
  },
  {
    id: 'neon-vapor',
    name: 'Vaporwave',
    category: 'neon',
    colors: { background: '#1a0028', foreground: '#ff71ce', accent: '#01cdfe', secondary: '#05ffa1' }
  },

  // Earth
  {
    id: 'earth-forest',
    name: 'Forest',
    category: 'earth',
    colors: { background: '#0a140a', foreground: '#90a955', accent: '#4f772d' }
  },
  {
    id: 'earth-desert',
    name: 'Desert',
    category: 'earth',
    colors: { background: '#1a1408', foreground: '#c9a959', accent: '#8b7355' }
  },
  {
    id: 'earth-stone',
    name: 'Stone',
    category: 'earth',
    colors: { background: '#1a1a1a', foreground: '#b8b8b8', accent: '#6b6b6b' }
  }
];

// Helper functions
export function getLayoutById(id: string): LayoutTemplate | undefined {
  return LAYOUT_TEMPLATES.find(l => l.id === id);
}

export function getColorSchemeById(id: string): ColorScheme | undefined {
  return COLOR_SCHEMES.find(c => c.id === id);
}

export function getColorSchemesByCategory(category: ColorScheme['category']): ColorScheme[] {
  return COLOR_SCHEMES.filter(c => c.category === category);
}

export function applyLayoutToElement(element: HTMLElement, layout: LayoutTemplate): void {
  // Apply grid template areas if parent uses grid
  const parent = element.parentElement;
  if (parent) {
    parent.style.display = 'grid';
    parent.style.gridTemplateAreas = layout.gridAreas;
    parent.style.gridTemplateColumns = 'repeat(3, 1fr)';
    parent.style.gridTemplateRows = 'auto 1fr auto';
  }
}

export function applyColorScheme(
  element: HTMLElement,
  scheme: ColorScheme,
  options: { applyBackground?: boolean } = {}
): void {
  element.style.color = scheme.colors.foreground;
  if (options.applyBackground) {
    element.style.backgroundColor = scheme.colors.background;
  }
  element.style.setProperty('--accent', scheme.colors.accent || scheme.colors.foreground);
  if (scheme.colors.secondary) {
    element.style.setProperty('--secondary', scheme.colors.secondary);
  }
}
