/**
 * Composition Module
 * Typography library, layout templates, and composition utilities
 */

// Types
export * from './types';

// Typography Library
export {
  TYPOGRAPHY_STYLES,
  STYLE_CATEGORIES,
  getStyleById,
  getStylesByCategory,
  getAllCategories,
  getGroupedStyles
} from './typography-library';

// Layout Templates
export {
  LAYOUT_TEMPLATES,
  COLOR_SCHEMES,
  getLayoutById,
  getColorSchemeById,
  getColorSchemesByCategory,
  applyLayoutToElement,
  applyColorScheme
} from './layout-templates';
