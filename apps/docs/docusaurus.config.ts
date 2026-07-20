import type {Config} from '@docusaurus/types';
import type {Options as ClassicPresetOptions, ThemeConfig} from '@docusaurus/preset-classic';
import {remarkRepositoryLinks, rewriteRepositoryLink} from './lib/repository-links.mjs';
import {remarkComposeInclude} from './lib/remark-compose-include.mjs';

const config: Config = {
  title: 'Riviamigo',
  tagline: "Your Rivian's data companion.",
  favicon: 'favicon.svg',
  url: 'https://riviamigo.com',
  baseUrl: '/',
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
  staticDirectories: ['static', '../../docs/assets/readme', '../../apps/web/public'],
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
          remarkPlugins: [remarkRepositoryLinks, remarkComposeInclude],
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
      logo: {
        alt: 'Riviamigo',
        src: 'text_black.svg',
        srcDark: 'text_white.svg',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'overviewSidebar', label: 'Overview', position: 'left'},
        {
          type: 'docSidebar',
          sidebarId: 'gettingStartedSidebar',
          label: 'Getting Started',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'usingRiviamigoSidebar',
          label: 'Using Riviamigo',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'operationsSidebar',
          label: 'Operations',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'developmentSidebar',
          label: 'Development',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'referenceSidebar',
          label: 'Reference',
          position: 'left',
        },
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
            {label: 'Verify installation', to: '/docs/getting-started/verify-installation/'},
          ],
        },
        {
          title: 'Use and Operate',
          items: [
            {label: 'Using Riviamigo', to: '/docs/using-riviamigo/'},
            {label: 'Deployment and updates', to: '/docs/operations/deployment-and-updates/'},
            {label: 'Backup and restore', to: '/docs/operations/backup-and-restore/'},
          ],
        },
        {
          title: 'Development',
          items: [
            {label: 'Architecture', to: '/docs/architecture/overview/'},
            {label: 'Dashboard authoring', to: '/docs/frontend/dashboard-authoring/'},
            {label: 'Reference', to: '/docs/reference/'},
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
