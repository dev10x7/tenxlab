import Link from 'next/link';
import { HelpGuideCard, HelpToc } from '@/components/HelpGuide';
import { guidesFor, type HelpRole } from '@/lib/help';

/**
 * A role's help page: every shipped feature as a numbered walkthrough with a
 * screenshot. Shared by `/help/student` and `/help/instructor` so the two stay
 * in lockstep — the only difference is the guide set and the copy.
 */
export function RoleHelpPage({ role }: { role: HelpRole }) {
  const guides = guidesFor(role);
  const other: HelpRole = role === 'student' ? 'instructor' : 'student';

  return (
    <div>
      <div className="row">
        <h1 style={{ marginBottom: 0 }}>
          {role === 'student' ? 'Student' : 'Instructor'} guides
        </h1>
        <Link className="btn secondary" href={`/help/${other}`}>
          {other === 'student' ? 'Student' : 'Instructor'} guides →
        </Link>
      </div>
      <p className="muted" style={{ maxWidth: 680 }}>
        Step-by-step walkthroughs for every {role} feature, each with a
        screenshot of the live screen. Open a guide&rsquo;s feature, follow the
        numbered steps, and you are done.
      </p>

      <div className="help-layout">
        <HelpToc guides={guides} />
        <div className="help-guides">
          {guides.map((guide) => (
            <HelpGuideCard key={guide.id} guide={guide} />
          ))}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link href="/help">← All help</Link>
      </p>
    </div>
  );
}
