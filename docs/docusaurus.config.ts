import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Veodyn',
  tagline: 'The data substrate for regional transportation hubs and agencies',
  favicon: 'img/favicon.svg',

  // `future.v4` is deliberately NOT set, and turning it on is a breaking change
  // rather than a readiness flag. From Docusaurus 3.10 it implies Docusaurus
  // Faster, which swaps webpack for rspack, and rspack's MDX pipeline cannot
  // parse an explicit heading id: every `{#custom-id}` in docs/ fails with
  // "Could not parse expression with acorn". There are 8 of them across 6
  // files and they are link targets, not decoration, so the failure mode if
  // they silently stopped resolving is dead cross-page anchors, which
  // onBrokenAnchors below turns into a build failure instead of a silent one.
  // Removing the "(enterprise)" parenthetical beside them
  // was tried and does not help; it is the id syntax itself.

  // Origin and path prefix, both overridable, both defaulting to what the
  // tenant deployment has always served.
  //
  // THE DEFAULTS ARE LOAD-BEARING. `helm/envs/docs-prod/values.yaml` publishes
  // this image at a product host under /docs through the frontend chart's
  // pathIngressHosts, sharing that host's certificate rather than taking a
  // domain of its own. `/docs/` is matching a live URL, not waiting for a
  // domain. A build that sets neither variable is byte-identical to before
  // these lines existed, which is the point: the tenant deployment does not
  // change.
  //
  // Within the image the prefix still appears in three places that must agree:
  // baseUrl here, the `COPY ... /usr/share/nginx/html/docs` in ../Dockerfile,
  // and the location blocks in ../nginx.conf. Overriding DOCS_BASE_URL alone
  // serves HTML whose every asset 404s, so the override is for a build that
  // does NOT go through that Dockerfile: a static host that serves the tree at
  // a root of its own, where nginx and the COPY target are not involved.
  url: process.env.DOCS_SITE_URL ?? 'https://veodyn.invalid',
  baseUrl: process.env.DOCS_BASE_URL ?? '/docs/',

  // Every host serving this build (Cloudflare in front of docs.veodyn.com,
  // nginx in the image) resolves a page as a directory index and 308s the
  // slashless URL onto it, so canonicals, sitemap entries and generated links
  // must carry the trailing slash or they all point at a redirect.
  trailingSlash: true,

  onBrokenLinks: 'throw',
  // Anchors too: a renamed heading otherwise turns every cross-page anchor
  // pointing at it into a silent dead link.
  onBrokenAnchors: 'throw',

  // Both halves are needed for the architecture diagram: this enables the
  // ```mermaid fence, and '@docusaurus/theme-mermaid' below draws it. Without
  // them the fence falls through to the syntax highlighter and the reader gets
  // `flowchart LR` source, which is what the site shipped until the 3.10
  // upgrade (the theme fails static generation on 3.9.2).
  markdown: {
    mermaid: true,
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        // Analytics only when a build asks for it, and OFF by default.
        //
        // This image is also a tenant deployment, served under /docs, and
        // a tenant's documentation traffic is theirs, not ours. Hardcoding the
        // property here would quietly report their readers to Veodyn's GA4 as a
        // side effect of a docs edit. The public docs build sets DOCS_GA_ID and
        // gets the tag; every other build renders exactly as it did before this
        // option existed.
        ...(process.env.DOCS_GA_ID
          ? {gtag: {trackingID: process.env.DOCS_GA_ID, anonymizeIP: true}}
          : {}),
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          { from: '/features/monitoring', to: '/features/captures' },
          { from: '/guides/on-time-performance', to: '/use-cases/on-time-performance' },
        ],
      },
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
    '@docusaurus/theme-mermaid',
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    // The og:image. A raster, because the social crawlers that render link
    // previews do not rasterize SVG, so pointing this at the logo shipped
    // links with no preview card at all.
    image: 'img/veodyn-social-card.png',
    navbar: {
      title: 'Veodyn',
      logo: {
        alt: 'Veodyn mark',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/veodyn/veodyn-ce',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting Started', to: '/getting-started' },
            { label: 'Editions', to: '/editions' },
            { label: 'Configuration', to: '/configuration' },
            { label: 'Architecture', to: '/architecture' },
          ],
        },
        {
          title: 'Features',
          items: [
            { label: 'Dashboards', to: '/features/dashboards' },
            { label: 'Queries', to: '/features/queries' },
            { label: 'Visualizations', to: '/features/visualizations' },
            { label: 'Reports', to: '/features/reports' },
          ],
        },
        {
          title: 'Operations',
          items: [
            { label: 'Deployment', to: '/operations/deployment' },
            { label: 'AI Provider', to: '/operations/ai-provider' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'Source (GitHub)', href: 'https://github.com/veodyn/veodyn-ce' },
            { label: 'License (AGPL-3.0)', href: 'https://www.gnu.org/licenses/agpl-3.0.html' },
            { label: 'veodyn.com', href: 'https://veodyn.com/' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Veodyn.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'python', 'sql', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
