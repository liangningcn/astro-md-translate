/**
 * Single source of truth for the package name used in internal strings
 * (CLI program name, logger prefix, temporary file names). Centralizing it
 * here avoids scattering the name across the codebase and simplifies renames.
 */
export const PKG_NAME = 'astro-md-translate';
