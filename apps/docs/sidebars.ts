import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  overviewSidebar: ['index', 'guides/features', 'privacy', 'security', 'roadmap'],
  gettingStartedSidebar: [
    'guides/README',
    'guides/prerequisites',
    'guides/getting-started',
    'guides/configuration',
    'guides/rivian-account',
    'guides/verify-installation',
  ],
  usingRiviamigoSidebar: [
    'using-riviamigo',
    'guides/dashboard-customization',
    'guides/external-connections',
  ],
  operationsSidebar: [
    'operations',
    {
      type: 'category',
      label: 'Deployment and recovery',
      collapsed: false,
      items: ['guides/deployment', 'guides/secure-deployment', 'guides/backup-and-restore'],
    },
    {
      type: 'category',
      label: 'Maintainer runbooks',
      collapsed: false,
      items: [
        'runbooks/README',
        'runbooks/secure-deployment',
        'runbooks/backup-restore',
        'runbooks/release-images',
        'runbooks/release-database-cutover',
        'runbooks/vehicle-history-rebuild',
        'runbooks/parallax-capture',
      ],
    },
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
      items: ['architecture/backend-data-flow', 'frontend/dashboard-architecture', 'rivian-auth'],
    },
    {
      type: 'category',
      label: 'Implementation guidance',
      collapsed: false,
      items: [
        'frontend/dashboard-authoring',
        'branding',
        {type: 'link', label: 'Security implementation', href: '/Riviamigo/docs/security/'},
      ],
    },
    {
      type: 'category',
      label: 'Governance and review',
      collapsed: false,
      items: ['runbooks/documentation-maintenance', 'security-audit', 'decision-log'],
    },
  ],
  referenceSidebar: ['reference', 'api-access', 'metrics-reference', 'dashboard-data-map'],
};

export default sidebars;
