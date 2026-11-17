import Link from 'next/link';

/**
 * Help — mirrors the structure of ByteXL's help centre: a set of guides per
 * product module plus an FAQ, rather than a generic placeholder. Each guide
 * links to the live surface it explains, so "Help" is a real starting point.
 */
interface Guide {
  href: string;
  icon: string;
  title: string;
  blurb: string;
}

const GUIDES: Guide[] = [
  {
    href: '/editor',
    icon: '⌨',
    title: 'Editor',
    blurb:
      'Practise C, C++, Java, Python and web languages, save snippets, supply STDIN, and ask the AI tutor when you are stuck.',
  },
  {
    href: '/labs',
    icon: '⚗',
    title: 'Labs',
    blurb:
      'Ungraded hands-on practice. Each lab spins up a real environment; use hints freely while you work.',
  },
  {
    href: '/assessments',
    icon: '✓',
    title: 'Assessments',
    blurb:
      'Graded tests with proctoring and auto-grading. Keep the exam tab focused — tab switches and copy/paste are recorded.',
  },
  {
    href: '/nimbus',
    icon: '☁',
    title: 'Nimbus',
    blurb:
      'Build and host projects in a cloud VS Code workspace: fork a template, code, publish to GitHub, deploy, then submit for evaluation.',
  },
];

interface Faq {
  q: string;
  a: string;
}

const FAQS: Faq[] = [
  {
    q: 'How do I provide input to my program in the Editor?',
    a: 'Enter your input in the STDIN panel before running. The program reads it as standard input during execution.',
  },
  {
    q: 'Can I install extra libraries?',
    a: 'In the Editor, no — popular libraries are pre-installed and available. In Nimbus you manage your own dependencies, so you can install what your project needs.',
  },
  {
    q: 'Why can’t I submit my project?',
    a: 'Submissions require a stopped workspace. Stop your Nimbus workspace, wait a moment for the session to close, then submit. A project also closes automatically once its deadline passes.',
  },
  {
    q: 'Why is the Run button unavailable?',
    a: 'Code execution needs the tier-1 runner. If it is not enabled in this deployment the Run button reports that execution is unavailable; you can still write and save code.',
  },
];

export default function Page() {
  return (
    <div>
      <h1>Help</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Step-by-step guides with screenshots for every feature, plus answers to
        common questions. Pick your role to start.
      </p>

      <div className="grid" style={{ marginTop: 16 }}>
        <Link className="card" href="/help/student">
          <div className="row">
            <h3 style={{ margin: 0 }}>
              <span aria-hidden="true" style={{ marginRight: 8 }}>
                ◈
              </span>
              Student guides
            </h3>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Dashboard, courses, attendance, the code editor, labs, assessments,
            and Nimbus projects — each with a numbered walkthrough and a
            screenshot.
          </p>
        </Link>
        <Link className="card" href="/help/instructor">
          <div className="row">
            <h3 style={{ margin: 0 }}>
              <span aria-hidden="true" style={{ marginRight: 8 }}>
                ✍
              </span>
              Instructor guides
            </h3>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Batches and rosters, the gradebook, proctoring review, class
            sessions and attendance, authoring courses, and authoring projects.
          </p>
        </Link>
      </div>

      <h2 style={{ marginTop: 24 }}>Guides</h2>
      <div className="grid">
        {GUIDES.map((guide) => (
          <Link key={guide.href} className="card" href={guide.href}>
            <div className="row">
              <h3 style={{ margin: 0 }}>
                <span aria-hidden="true" style={{ marginRight: 8 }}>
                  {guide.icon}
                </span>
                {guide.title}
              </h3>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              {guide.blurb}
            </p>
          </Link>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>Frequently asked questions</h2>
      <div className="grid">
        {FAQS.map((faq) => (
          <div key={faq.q} className="card">
            <h3 style={{ marginTop: 0 }}>{faq.q}</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              {faq.a}
            </p>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Report an issue</h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          Found a bug or have a feature request? Report it to your instructor or
          platform administrator with the page you were on and what you
          expected to happen.
        </p>
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>
    </div>
  );
}
