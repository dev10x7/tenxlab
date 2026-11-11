import Link from 'next/link';

export default function HomePage() {
  return (
    <div>
      <section className="card" style={{ padding: 32 }}>
        <h1 style={{ marginTop: 0 }}>Hands-on labs, fully graded.</h1>
        <p className="muted" style={{ maxWidth: 640 }}>
          TenXLab pairs a learning-management system with a real Kubernetes
          execution plane. Students launch disposable environments inside the
          browser, submit work, and get graded automatically — with plagiarism
          and code-quality checks built in.
        </p>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 12 }}>
          <Link className="btn" href="/catalog">
            Browse courses
          </Link>
          <Link className="btn secondary" href="/login">
            Sign in
          </Link>
        </div>
      </section>

      <div className="grid" style={{ marginTop: 24 }}>
        <div className="card">
          <h3>Real environments</h3>
          <p className="muted">
            MicroVM, container, or vcluster tiers — provisioned on demand and
            torn down when idle.
          </p>
        </div>
        <div className="card">
          <h3>Automatic grading</h3>
          <p className="muted">
            Exercise results flow back over signed webhooks and land in the
            gradebook, idempotently.
          </p>
        </div>
        <div className="card">
          <h3>Academic integrity</h3>
          <p className="muted">
            Structural similarity detection and code-quality scoring on every
            submission.
          </p>
        </div>
      </div>
    </div>
  );
}
