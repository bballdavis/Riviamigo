import type {Config} from '@docusaurus/types';
import type {Options as ClassicPresetOptions, ThemeConfig} from '@docusaurus/preset-classic';
import {remarkRepositoryLinks, rewriteRepositoryLink} from './lib/repository-links.mjs';

const config: Config = {
  title: 'Riviamigo',
  tagline: "Your Rivian's data companion.",
  favicon: 'logo-lockup-light.png',
  url: 'https://bballdavis.github.io',
  baseUrl: '/Riviamigo/',
  organizationName: 'bballdavis',
  projectName: 'Riviamigo',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onDuplicateRoutes: 'throw',
  markdown: {
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: rewriteRepositoryLink,
      onBrokenMarkdownImages: 'throw',
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  staticDirectories: ['static', '../../docs/assets/readme'],
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../../docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          sidebarCollapsible: true,
          sidebarCollapsed: false,
          remarkPlugins: [remarkRepositoryLinks],
          editUrl: ({docPath}) =>
            `https://github.com/bballdavis/Riviamigo/edit/main/docs/${docPath}`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
          ignorePatterns: ['/tags/**'],
        },
      } satisfies ClassicPresetOptions,
    ],
  ],
  plugins: [
    [
      '@cmfcmf/docusaurus-search-local',
      {
        indexDocs: true,
        indexPages: true,
        indexBlog: false,
        indexDocSidebarParentCategories: 2,
        includeParentCategoriesInPageTitle: true,
        language: 'en',
        maxSearchResults: 8,
      },
    ],
  ],
  themeConfig: {
    image: 'overview-desktop-dark.png',
    metadata: [
      {
        name: 'description',
        content:
          'Install, operate, understand, and contribute to Riviamigo, the private self-hosted Rivian telemetry dashboard.',
      },
    ],
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Riviamigo',
      logo: {
        alt: 'Riviamigo',
        src: 'logo-lockup-light.png',
        srcDark: 'logo-lockup-dark.png',
      },
      items: [
        {to: '/', label: 'Welcome', position: 'left', activeBaseRegex: '^/$'},
        {to: '/docs/', label: 'Overview', position: 'left'},
        {to: '/docs/getting-started/', label: 'Getting Started', position: 'left'},
        {to: '/docs/development/', label: 'Development', position: 'left'},
        {
          href: 'https://github.com/bballdavis/Riviamigo',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Get Started',
          items: [
            {label: 'Prerequisites', to: '/docs/getting-started/prerequisites/'},
            {label: 'Install Riviamigo', to: '/docs/getting-started/install/'},
            {label: 'Secure deployment', to: '/docs/getting-started/secure-deployment/'},
          ],
        },
        {
          title: 'Development',
          items: [
            {label: 'Architecture', to: '/docs/architecture/overview/'},
            {label: 'Dashboard authoring', to: '/docs/frontend/dashboard-authoring/'},
            {label: 'Runbooks', to: '/docs/runbooks/'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: 'https://github.com/bballdavis/Riviamigo'},
            {label: 'Privacy', to: '/docs/privacy/'},
            {label: 'Security', to: '/docs/security/'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Riviamigo. GPL-3.0-only.`,
    },
    prism: {
      additionalLanguages: ['bash', 'docker', 'json', 'powershell', 'rust', 'toml'],
    },
  } satisfies ThemeConfig,
};

export default config;
