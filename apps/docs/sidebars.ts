import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  overviewSidebar: [
    'index',
    {
      type: 'category',
      label: 'Product overview',
      collapsed: false,
      items: ['guides/features', 'roadmap'],
    },
    {
      type: 'category',
      label: 'Trust and privacy',
      collapsed: false,
      items: ['privacy', 'security'],
    },
  ],
  gettingStartedSidebar: [
    'guides/README',
    {
      type: 'category',
      label: 'Prepare and install',
      collapsed: false,
      items: ['guides/prerequisites', 'guides/getting-started', 'guides/configuration'],
    },
    {
      type: 'category',
      label: 'Connect and verify',
      collapsed: false,
      items: ['guides/rivian-account', 'guides/verify-installation'],
    },
  ],
  usingRiviamigoSidebar: [
    'using-riviamigo',
    {
      type: 'category',
      label: 'Personalize your dashboard',
      collapsed: false,
      items: ['guides/dashboard-customization'],
    },
    {
      type: 'category',
      label: 'Integrations',
      collapsed: false,
      items: ['guides/external-connections'],
    },
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
        {type: 'link', label: 'Security implementation', href: '/docs/security/'},
      ],
    },
    {
      type: 'category',
      label: 'Governance and review',
      collapsed: false,
      items: ['runbooks/documentation-maintenance', 'security-audit', 'decision-log'],
    },
  ],
  referenceSidebar: [
    'reference',
    {
      type: 'category',
      label: 'Configuration',
      collapsed: false,
      items: ['environment-variables'],
    },
    {
      type: 'category',
      label: 'API and integrations',
      collapsed: false,
      items: ['api-access'],
    },
    {
      type: 'category',
      label: 'Data and dashboards',
      collapsed: false,
      items: ['metrics-reference', 'dashboard-data-map'],
    },
  ],
};

export default sidebars;
