import Link from 'next/link';
import type { HelpGuide as Guide } from '@/lib/help';

/**
 * One help guide: a header, a real screenshot of the running surface, and the
 * numbered walkthrough. Rendered as a card with a stable anchor so the role
 * page's table of contents can link straight to it.
 */
export function HelpGuideCard({ guide }: { guide: Guide }) {
  return (
    <section id={guide.id} className="card help-guide">
      <div className="row">
        <h2 style={{ margin: 0 }}>
          <span aria-hidden style={{ marginRight: 8 }}>
            {guide.icon}
          </span>
          {guide.title}
        </h2>
        <Link className="btn secondary" href={guide.route}>
          Open {guide.title} →
        </Link>
      </div>
      <p className="muted" style={{ maxWidth: 640 }}>
        {guide.summary}
      </p>

      <img
        className="help-shot"
        src={`/help/${guide.screenshot}`}
        alt={`${guide.title} screenshot`}
        loading="lazy"
      />

      <ol className="help-steps">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The sticky table of contents shown beside a role's guide list, so a reader
 * can jump to a feature without scrolling the whole page.
 */
export function HelpToc({ guides }: { guides: Guide[] }) {
  return (
    <nav className="card help-toc" aria-label="Guides on this page">
      <h3 style={{ marginTop: 0 }}>On this page</h3>
      <ul>
        {guides.map((g) => (
          <li key={g.id}>
            <a href={`#${g.id}`}>{g.title}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
