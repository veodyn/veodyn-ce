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
        'features/monitoring',
        'features/ai',
        'features/sharing',
        'features/connect',
        'features/published-feeds',
        'features/settings',
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
