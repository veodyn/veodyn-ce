import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'editions',
    'getting-started',
    'architecture',
    'configuration',
    'connectors',
    {
      type: 'category',
      label: 'Features',
      collapsed: false,
      items: [
        'features/navigation',
        'features/home',
        'features/queries',
        'features/visualizations',
        'features/dashboards',
        'features/data-catalog',
        'features/captures',
        'features/schedules',
        'features/ai',
        'features/sharing',
        'features/connect',
        'features/published-feeds',
        'features/settings',
      ],
    },
    {
      // Goal-first, where the Features category above is surface-first. One
      // category rather than two: a separate Guides tree put the same kind of
      // page in two places with nothing stating the difference.
      type: 'category',
      label: 'Use cases',
      collapsed: false,
      items: [
        'use-cases/overview',
        'use-cases/publish-gtfs-realtime',
        'use-cases/publish-gbfs',
        'use-cases/static-gtfs-archive',
        'use-cases/take-back-a-vendor-feed',
        'use-cases/ridership-reporting',
        'use-cases/ntd-service-data',
        'use-cases/demand-response',
        'use-cases/service-equity',
        'use-cases/feed-freshness',
        'use-cases/tmc-events-and-signs',
        'use-cases/dms-ntcip',
        'use-cases/incident-and-air-quality',
        'use-cases/history-capture',
        'use-cases/on-time-performance',
        'use-cases/fleet-utilization',
        'use-cases/ask-your-data-mcp',
        'use-cases/open-data-page',
        'use-cases/feed-to-a-partner',
      ],
    },
    {
      // Their own category rather than three badges buried in Features, so the
      // line is readable off the navigation. The EE chips repeat that on each
      // row, because a linked-to page is read without its category in view.
      // Sections of otherwise-community pages are enterprise too (presentation
      // and wall modes, the digest, shared-link governance); docs/editions.md
      // is the complete list, and the nav cannot carry it.
      type: 'category',
      label: 'Enterprise features',
      collapsed: false,
      items: [
        {type: 'doc', id: 'features/reports', className: 'menu-ee'},
        {type: 'doc', id: 'features/kpis', className: 'menu-ee'},
        {type: 'doc', id: 'features/alerts', className: 'menu-ee'},
        {type: 'doc', id: 'features/managed-datasets', className: 'menu-ee'},
      ],
    },
    {
      type: 'category',
      label: 'Administration',
      collapsed: false,
      items: [
        'admin/users',
        'admin/data-sources',
        'admin/system',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      collapsed: false,
      items: [
        'operations/deployment',
        'operations/ai-provider',
        'operations/plugins',
        'operations/development',
      ],
    },
  ],
};

export default sidebars;
