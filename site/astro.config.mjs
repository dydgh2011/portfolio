import { defineConfig } from 'astro/config';

// Repo name is `portfolio`, so GitHub Pages serves it at /portfolio/.
// With a custom domain, change base to '/'.
export default defineConfig({
  site: 'https://dydgh2011.github.io',
  base: '/portfolio',
  trailingSlash: 'always',
  vite: {
    server: { fs: { allow: ['..'] } },
  },
});
