import type {Config} from '@docusaurus/types';
import type {Options as ClassicPresetOptions, ThemeConfig} from '@docusaurus/preset-classic';
import {remarkRepositoryLinks, rewriteRepositoryLink} from './lib/repository-links.mjs';

const config: Config = {
  title: 'Riviamigo',
  tagline: "Your Rivian's data companion.",
  favicon: 'favicon.svg',
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
      logo: {
        alt: 'Riviamigo',
        src: 'text_black.svg',
        srcDark: 'text_white.svg',
      },
      items: [
        {to: '/docs/', label: 'Overview', position: 'left'},
        {
          type: 'dropdown',
          label: 'Getting Started',
          to: '/docs/getting-started/',
          position: 'left',
          items: [
            {label: 'Prerequisites', to: '/docs/getting-started/prerequisites/'},
            {label: 'Install Riviamigo', to: '/docs/getting-started/install/'},
            {label: 'Configure the environment', to: '/docs/getting-started/configuration/'},
            {label: 'Connect a Rivian account', to: '/docs/getting-started/rivian-account/'},
            {label: 'Verify the installation', to: '/docs/getting-started/verify-installation/'},
          ],
        },
        {
          type: 'dropdown',
          label: 'User Guide',
          to: '/docs/using-riviamigo/',
          position: 'left',
          items: [
            {label: 'Dashboard customization', to: '/docs/using-riviamigo/dashboard-customization/'},
            {label: 'External connections', to: '/docs/using-riviamigo/external-connections/'},
          ],
        },
        {
          type: 'dropdown',
          label: 'Operations',
          to: '/docs/operations/',
          position: 'left',
          items: [
            {label: 'Deployment and updates', to: '/docs/operations/deployment-and-updates/'},
            {label: 'Secure remote access', to: '/docs/operations/secure-remote-access/'},
            {label: 'Backup and restore', to: '/docs/operations/backup-and-restore/'},
            {label: 'Maintainer runbooks', to: '/docs/runbooks/'},
          ],
        },
        {
          type: 'dropdown',
          label: 'Development',
          to: '/docs/development/',
          position: 'left',
          items: [
            {label: 'Contributor orientation', to: '/docs/contributing/'},
            {label: 'Architecture', to: '/docs/architecture/overview/'},
            {label: 'Implementation guidance', to: '/docs/frontend/dashboard-authoring/'},
            {label: 'Governance and review', to: '/docs/runbooks/documentation-maintenance/'},
          ],
        },
        {
          type: 'dropdown',
          label: 'Reference',
          to: '/docs/reference/',
          position: 'left',
          items: [
            {label: 'Integration API', to: '/docs/reference/api-access/'},
            {label: 'Metrics', to: '/docs/reference/metrics/'},
            {label: 'Dashboard data map', to: '/docs/reference/dashboard-data-map/'},
          ],
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
            {label: 'User guide', to: '/docs/using-riviamigo/'},
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
