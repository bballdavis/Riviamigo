import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import type {ReactElement} from 'react';

export default function NotFoundContent(): ReactElement {
  return (
    <main className="container margin-vert--xl">
      <div className="rm-not-found">
        <p className="rm-not-found__eyebrow">404 · Route unavailable</p>
        <h1>
          <Translate id="theme.NotFound.title">This page could not be found.</Translate>
        </h1>
        <p>
          The documentation may have moved. Use site search or choose one of the primary documentation paths.
        </p>
        <div className="rm-not-found__actions">
          <Link className="button button--secondary" to="/">Welcome</Link>
          <Link className="button button--primary" to="/docs/getting-started/">Getting Started</Link>
          <Link className="button button--secondary" to="/docs/development/">Development</Link>
          <Link className="button button--secondary" href="https://github.com/bballdavis/Riviamigo">GitHub</Link>
        </div>
      </div>
    </main>
  );
}
