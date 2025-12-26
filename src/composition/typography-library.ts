/**
 * Typography Library
 * Curated collection of typography styles organized by category
 */

import type { TypographyStyle, StyleCategory } from './types';

// Style definitions extracted from composition-layer.html
export const TYPOGRAPHY_STYLES: TypographyStyle[] = [
  // === SWISS / INTERNATIONAL ===
  {
    id: 'swiss',
    name: 'Swiss International',
    category: 'swiss',
    cssClass: 'style-swiss',
    fontFamily: 'Epilogue',
    description: 'Clean grid-based design with bold typography',
    preview: { title: 'HELVETICA', meta: 'FIG 01. - 2025' }
  },
  {
    id: 'neuegrafik',
    name: 'Neue Grafik',
    category: 'swiss',
    cssClass: 'style-neuegrafik',
    fontFamily: 'Helvetica Neue',
    description: 'Muller-Brockmann inspired mathematical precision',
    preview: { title: 'neue grafik', meta: 'issue 01' }
  },
  {
    id: 'werkbund',
    name: 'Werkbund',
    category: 'swiss',
    cssClass: 'style-werkbund',
    fontFamily: 'DM Sans',
    description: 'German design reform movement aesthetic',
    preview: { title: 'WERKBUND', meta: '1907' }
  },
  {
    id: 'minimal',
    name: 'Minimalist',
    category: 'swiss',
    cssClass: 'style-minimal',
    fontFamily: 'Inter',
    description: 'Ultra-clean with maximum whitespace',
    preview: { title: 'less', meta: 'is more' }
  },

  // === ART MOVEMENTS ===
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    category: 'art',
    cssClass: 'style-bauhaus',
    fontFamily: 'Work Sans',
    description: 'Geometric forms, primary colors, diagonal energy',
    preview: { title: 'BAUHAUS', meta: '1919' }
  },
  {
    id: 'destijl',
    name: 'De Stijl',
    category: 'art',
    cssClass: 'style-destijl',
    fontFamily: 'Work Sans',
    description: 'Mondrian-inspired primary color blocks',
    preview: { title: 'DE STIJL', meta: 'NEOPLASTICISM' }
  },
  {
    id: 'deco',
    name: 'Art Deco',
    category: 'art',
    cssClass: 'style-deco',
    fontFamily: 'Poiret One',
    description: 'Elegant geometric patterns and gold accents',
    preview: { title: 'ART DECO', meta: 'GATSBY' }
  },
  {
    id: 'nouveau',
    name: 'Art Nouveau',
    category: 'art',
    cssClass: 'style-nouveau',
    fontFamily: 'Cormorant Garamond',
    description: 'Organic curves and natural forms',
    preview: { title: 'Nouveau', meta: 'Belle Epoque' }
  },
  {
    id: 'construct',
    name: 'Constructivist',
    category: 'art',
    cssClass: 'style-construct',
    fontFamily: 'Oswald',
    description: 'Soviet avant-garde with bold angles',
    preview: { title: 'CONSTRUCT', meta: 'REVOLUTION' }
  },
  {
    id: 'avantgarde',
    name: 'Russian Avant-Garde',
    category: 'art',
    cssClass: 'style-avantgarde',
    fontFamily: 'Bebas Neue',
    description: 'Bold propaganda poster style',
    preview: { title: 'AVANT', meta: 'GARDE' }
  },
  {
    id: 'futurism',
    name: 'Futurism',
    category: 'art',
    cssClass: 'style-futurism',
    fontFamily: 'Oswald',
    description: 'Dynamic motion and speed lines',
    preview: { title: 'VELOCITA', meta: 'FUTURO' }
  },
  {
    id: 'dada',
    name: 'Dadaism',
    category: 'art',
    cssClass: 'style-dada',
    fontFamily: 'Special Elite',
    description: 'Chaotic anti-art collage aesthetic',
    preview: { title: 'DADA', meta: 'ANTI-ART' }
  },

  // === CLASSIC / EDITORIAL ===
  {
    id: 'editorial',
    name: 'Editorial',
    category: 'classic',
    cssClass: 'style-editorial',
    fontFamily: 'Playfair Display',
    description: 'Magazine cover elegance',
    preview: { title: 'VOGUE', meta: 'SPRING 2025' }
  },
  {
    id: 'art',
    name: 'Gallery',
    category: 'classic',
    cssClass: 'style-art',
    fontFamily: 'DM Serif Display',
    description: 'Museum exhibition style',
    preview: { title: 'Exhibition', meta: 'GALLERY' }
  },
  {
    id: 'retro',
    name: 'Retro Frame',
    category: 'classic',
    cssClass: 'style-retro',
    fontFamily: 'Righteous',
    description: 'Vintage poster with decorative border',
    preview: { title: 'RETRO', meta: 'VINTAGE' }
  },
  {
    id: 'streamline',
    name: 'Streamline Moderne',
    category: 'classic',
    cssClass: 'style-streamline',
    fontFamily: 'Poiret One',
    description: '1930s aerodynamic elegance',
    preview: { title: 'STREAMLINE', meta: 'MODERNE' }
  },

  // === MODERN DIGITAL ===
  {
    id: 'tech',
    name: 'Tech / HUD',
    category: 'digital',
    cssClass: 'style-tech',
    fontFamily: 'JetBrains Mono',
    description: 'Sci-fi interface with data overlays',
    preview: { title: 'SYSTEM', meta: 'v2.0.25' }
  },
  {
    id: 'brutal',
    name: 'Brutalist',
    category: 'digital',
    cssClass: 'style-brutal',
    fontFamily: 'Archivo Black',
    description: 'Raw, unpolished web brutalism',
    preview: { title: 'BRUTAL', meta: 'RAW' }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    category: 'digital',
    cssClass: 'style-cyberpunk',
    fontFamily: 'Orbitron',
    description: 'Neon-lit dystopian future',
    preview: { title: 'CYBER', meta: 'PUNK 2077' }
  },
  {
    id: 'glitch',
    name: 'Glitch',
    category: 'digital',
    cssClass: 'style-glitch',
    fontFamily: 'VT323',
    description: 'Digital corruption and artifacts',
    preview: { title: 'GL1TCH', meta: 'ERR0R' }
  },
  {
    id: 'kinetic',
    name: 'Kinetic / Op Art',
    category: 'digital',
    cssClass: 'style-kinetic',
    fontFamily: 'Space Grotesk',
    description: 'Optical illusion patterns',
    preview: { title: 'KINETIC', meta: 'OP ART' }
  },

  // === EXPRESSIVE ===
  {
    id: 'acid',
    name: 'Acid Graphix',
    category: 'expressive',
    cssClass: 'style-acid',
    fontFamily: 'Climate Crisis',
    description: 'Rave culture warped typography',
    preview: { title: 'ACID', meta: 'GRAPHIX' }
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    category: 'expressive',
    cssClass: 'style-vaporwave',
    fontFamily: 'Major Mono Display',
    description: 'Retro-futuristic aesthetic',
    preview: { title: 'VAPOR', meta: 'WAVE' }
  },
  {
    id: 'psychedelic',
    name: 'Psychedelic 60s',
    category: 'expressive',
    cssClass: 'style-psychedelic',
    fontFamily: 'Bangers',
    description: 'Flower power and liquid letters',
    preview: { title: 'PSYCHE', meta: 'DELIC' }
  },
  {
    id: 'popart',
    name: 'Pop Art',
    category: 'expressive',
    cssClass: 'style-popart',
    fontFamily: 'Bangers',
    description: 'Warhol-inspired bold graphics',
    preview: { title: 'POP!', meta: 'ART' }
  },
  {
    id: 'memphis',
    name: 'Memphis',
    category: 'expressive',
    cssClass: 'style-memphis',
    fontFamily: 'Syne',
    description: '80s Italian design movement',
    preview: { title: 'MEMPHIS', meta: '1981' }
  },
  {
    id: 'grunge',
    name: 'Grunge',
    category: 'expressive',
    cssClass: 'style-grunge',
    fontFamily: 'Special Elite',
    description: '90s distressed and worn aesthetic',
    preview: { title: 'GRUNGE', meta: 'SEATTLE' }
  },
  {
    id: 'punk',
    name: 'Punk / DIY',
    category: 'expressive',
    cssClass: 'style-punk',
    fontFamily: 'Special Elite',
    description: 'Cut-and-paste zine aesthetic',
    preview: { title: 'PUNK', meta: 'DIY' }
  },
  {
    id: 'postmodern',
    name: 'Postmodern',
    category: 'expressive',
    cssClass: 'style-postmodern',
    fontFamily: 'Space Grotesk',
    description: 'Deconstructed design rules',
    preview: { title: 'POST', meta: 'MODERN' }
  },

  // === CULTURAL ===
  {
    id: 'zen',
    name: 'Zen / Vertical',
    category: 'cultural',
    cssClass: 'style-zen',
    fontFamily: 'Noto Sans JP',
    description: 'Japanese minimalism with vertical text',
    preview: { title: 'ZEN', meta: 'WABI-SABI' }
  },
  {
    id: 'jpmod',
    name: 'Japanese Modern',
    category: 'cultural',
    cssClass: 'style-jpmod',
    fontFamily: 'Noto Sans JP',
    description: 'Contemporary Japanese design',
    preview: { title: 'TOKYO', meta: 'MODERN' }
  },
  {
    id: 'concrete',
    name: 'Concrete Poetry',
    category: 'cultural',
    cssClass: 'style-concrete',
    fontFamily: 'IBM Plex Mono',
    description: 'Visual poetry shaped text',
    preview: { title: 'CONCRETE', meta: 'POETRY' }
  }
];

// Category metadata for UI organization
export const STYLE_CATEGORIES: Record<StyleCategory, { name: string; description: string }> = {
  swiss: {
    name: 'Swiss / International',
    description: 'Clean, grid-based modernist design'
  },
  art: {
    name: 'Art Movements',
    description: 'Historical avant-garde aesthetics'
  },
  classic: {
    name: 'Classic / Editorial',
    description: 'Timeless elegance and refinement'
  },
  digital: {
    name: 'Modern Digital',
    description: 'Tech-inspired contemporary styles'
  },
  expressive: {
    name: 'Expressive / Bold',
    description: 'High-impact visual statements'
  },
  cultural: {
    name: 'Cultural / Regional',
    description: 'Global design traditions'
  }
};

// Helper functions
export function getStyleById(id: string): TypographyStyle | undefined {
  return TYPOGRAPHY_STYLES.find(s => s.id === id);
}

export function getStylesByCategory(category: StyleCategory): TypographyStyle[] {
  return TYPOGRAPHY_STYLES.filter(s => s.category === category);
}

export function getAllCategories(): StyleCategory[] {
  return Object.keys(STYLE_CATEGORIES) as StyleCategory[];
}

export function getGroupedStyles(): Map<StyleCategory, TypographyStyle[]> {
  const grouped = new Map<StyleCategory, TypographyStyle[]>();
  for (const category of getAllCategories()) {
    grouped.set(category, getStylesByCategory(category));
  }
  return grouped;
}
