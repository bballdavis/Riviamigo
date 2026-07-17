import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  welcomeSidebar: ['index', 'guides/features', 'privacy', 'security', 'roadmap'],
  gettingStartedSidebar: [
    'guides/README',
    'guides/prerequisites',
    'guides/getting-started',
    'guides/configuration',
    'guides/rivian-account',
    'guides/verify-installation',
    'guides/deployment',
    'guides/secure-deployment',
    'guides/external-connections',
    'guides/dashboard-customization',
    'guides/backup-and-restore',
  ],
  developmentSidebar: [
    'development',
    {
      type: 'category',
      label: 'Contributor orientation',
      collapsed: false,
      items: ['contributing', 'architecture/overview'],
    },
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: [
        'architecture/backend-data-flow',
        'frontend/dashboard-architecture',
        'rivian-auth',
      ],
    },
    {
      type: 'category',
      label: 'Implementation references',
      collapsed: false,
      items: [
        'frontend/dashboard-authoring',
        'dashboard-data-map',
        'metrics-reference',
        'api-access',
        'branding',
      ],
    },
    {
      type: 'category',
      label: 'Operations and runbooks',
      collapsed: false,
      items: [
        'runbooks/README',
        'runbooks/documentation-maintenance',
        'runbooks/backup-restore',
        'runbooks/secure-deployment',
        'runbooks/release-images',
        'runbooks/release-database-cutover',
        'runbooks/vehicle-history-rebuild',
        'runbooks/parallax-capture',
      ],
    },
    {
      type: 'category',
      label: 'Governance and review',
      collapsed: false,
      items: ['security-audit', 'decision-log'],
    },
  ],
};

export default sidebars;
