/**
 * Composition Module Types
 * Typography, layout, and text management types for canvas composition
 */

// Typography Style Categories
export type StyleCategory =
  | 'swiss'      // Swiss / International
  | 'art'        // Art Movements
  | 'classic'    // Classic / Editorial
  | 'digital'    // Modern Digital
  | 'expressive' // Expressive / Bold
  | 'cultural';  // Cultural / Regional

// Typography Style Definition
export interface TypographyStyle {
  id: string;
  name: string;
  category: StyleCategory;
  cssClass: string;
  fontFamily: string;
  description: string;
  preview?: {
    title: string;
    meta: string;
  };
}

// Layout Template Definition
export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  gridAreas: string;  // CSS grid-template-areas
  positions: {
    title: LayoutPosition;
    meta: LayoutPosition;
    desc: LayoutPosition;
    sig: LayoutPosition;
  };
}

export interface LayoutPosition {
  gridArea?: string;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  transform?: string;
  textAlign?: 'left' | 'center' | 'right';
}

// Text Block for Custom Layouts
export interface TextBlock {
  id: string;
  type: 'title' | 'meta' | 'desc' | 'sig' | 'custom';
  content: string;
  position: {
    x: number;  // Percentage 0-100
    y: number;
  };
  style: TextBlockStyle;
}

export interface TextBlockStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: number;
  color: string;
  opacity: number;
  rotation: number;
  letterSpacing: string;
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  blendMode: string;
}

// Color Scheme Definition
export interface ColorScheme {
  id: string;
  name: string;
  category: 'mono' | 'warm' | 'cool' | 'neon' | 'earth' | 'custom';
  colors: {
    background: string;
    foreground: string;
    accent?: string;
    secondary?: string;
  };
}

// Composition State
export interface CompositionState {
  activeStyle: string;
  activeLayout: string;
  activeColorScheme: string;
  textBlocks: TextBlock[];
  gridSettings: {
    columns: number;
    rows: number;
    gutter: number;
    margin: number;
    show: boolean;
    snap: boolean;
  };
  guideSettings: {
    type: 'none' | 'thirds' | 'golden' | 'diagonal' | 'center' | 'phi' | 'fibonacci';
    show: boolean;
  };
}

// Event Types
export type CompositionEvent =
  | { type: 'STYLE_CHANGE'; styleId: string }
  | { type: 'LAYOUT_CHANGE'; layoutId: string }
  | { type: 'COLOR_SCHEME_CHANGE'; schemeId: string }
  | { type: 'TEXT_BLOCK_ADD'; block: TextBlock }
  | { type: 'TEXT_BLOCK_UPDATE'; blockId: string; updates: Partial<TextBlock> }
  | { type: 'TEXT_BLOCK_REMOVE'; blockId: string }
  | { type: 'GRID_UPDATE'; settings: Partial<CompositionState['gridSettings']> }
  | { type: 'GUIDE_UPDATE'; settings: Partial<CompositionState['guideSettings']> };
