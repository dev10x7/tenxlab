'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, type CourseEditor, type LessonEditor } from '@/lib/api';

const LESSON_TYPES = [
  { value: 'reading', label: 'Reading' },
  { value: 'interactive_lab', label: 'Lab' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'video', label: 'Video' },
] as const;

/**
 * The course editor: edit course details, add chapters (modules), and add or
 * edit the lessons inside them. Each lesson type exposes only the fields it
 * needs — a reading has a body, a lab has an exercise slug and hint, a quiz
 * links to an assessment. Publish flips the course into the student catalog.
 */
export default function CourseEditorPage({ params }: { params: { courseId: string } }) {
  const [course, setCourse] = useState<CourseEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newModule, setNewModule] = useState('');

  const apply = useCallback((next: CourseEditor) => {
    setCourse(next);
    setTitle(next.title);
    setDescription(next.description);
  }, []);

  const load = useCallback(async () => {
    apply(await api.authoringCourse(params.courseId));
  }, [apply, params.courseId]);

  useEffect(() => {
    load()
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This course could not be found.'
            : 'Could not load this course.',
        );
      })
      .finally(() => setLoading(false));
  }, [load]);

  /** Run a mutation, surface failures, and refresh the editor from the API. */
  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch {
      setError('That change could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading course…</p>;
  if (error && !course) return <p className="error">{error}</p>;
  if (!course) return null;

  const published = course.status === 'published';

  return (
    <div>
      <p className="muted" style={{ marginBottom: 4 }}>
        <Link href="/authoring">← All courses</Link>
      </p>
      <div className="row" style={{ alignItems: 'center' }}>
        <h1 style={{ marginBottom: 4 }}>{course.title}</h1>
        <span className={`pill ${course.status}`}>{course.status}</span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Course details</h3>
        <label htmlFor="edit-title">Title</label>
        <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <label htmlFor="edit-description">Description</label>
          <input
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <button
            className="btn"
            type="button"
            disabled={busy || !title.trim()}
            onClick={() =>
              run(
                () => api.updateCourse(course.id, { title: title.trim(), description }),
                'Course details saved.',
              )
            }
          >
            Save details
          </button>
          {published ? (
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => run(() => api.unpublishCourse(course.id), 'Course moved to draft.')}
            >
              Unpublish
            </button>
          ) : (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => run(() => api.publishCourse(course.id), 'Course published.')}
            >
              Publish
            </button>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>
          Slug: <code>{course.slug}</code>
        </p>
      </div>

      <h2 style={{ marginTop: 32 }}>Chapters</h2>
      <div className="card">
        <form
          className="row"
          style={{ gap: 12, alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            const name = newModule.trim();
            if (!name) return;
            run(() => api.addModule(course.id, name), 'Chapter added.').then(() =>
              setNewModule(''),
            );
          }}
        >
          <div style={{ flex: 1 }}>
            <label htmlFor="new-module">New chapter</label>
            <input
              id="new-module"
              value={newModule}
              onChange={(e) => setNewModule(e.target.value)}
              placeholder="e.g. Foundations"
            />
          </div>
          <button className="btn" type="submit" disabled={busy || !newModule.trim()}>
            Add chapter
          </button>
        </form>
      </div>

      {course.modules.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          No chapters yet. Add one above.
        </p>
      ) : (
        course.modules.map((module) => (
          <div key={module.id} className="card" style={{ marginTop: 16 }}>
            <div className="row">
              <h3 style={{ margin: 0 }}>{module.title}</h3>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() => api.deleteModule(module.id), 'Chapter removed.')
                }
              >
                Delete chapter
              </button>
            </div>
            <p className="muted">{module.lessons.length} lessons</p>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {module.lessons.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  busy={busy}
                  onChange={(patch) => run(() => api.updateLesson(lesson.id, patch))}
                  onDelete={() => run(() => api.deleteLesson(lesson.id), 'Lesson removed.')}
                />
              ))}
            </ul>

            <AddLessonForm
              busy={busy}
              onAdd={(input) => run(() => api.addLesson(module.id, input), 'Lesson added.')}
            />
          </div>
        ))
      )}
    </div>
  );
}

function LessonRow({
  lesson,
  busy,
  onChange,
  onDelete,
}: {
  lesson: LessonEditor;
  busy: boolean;
  onChange: (patch: Partial<LessonEditor>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [body, setBody] = useState(lesson.body ?? '');
  const [hint, setHint] = useState(lesson.hint ?? '');
  const [exerciseSlug, setExerciseSlug] = useState(lesson.exerciseSlug ?? '');
  const [assessmentId, setAssessmentId] = useState(lesson.assessmentId ?? '');

  return (
    <li className="card" style={{ marginTop: 8, padding: 12 }}>
      <div className="row">
        <div>
          <strong>{lesson.title}</strong>{' '}
          <span className="pill" style={{ textTransform: 'capitalize' }}>
            {lesson.kind}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary" type="button" onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'Edit'}
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {open ? (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={`t-${lesson.id}`}>Title</label>
          <input
            id={`t-${lesson.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {lesson.kind === 'reading' || lesson.kind === 'video' ? (
            <div style={{ marginTop: 12 }}>
              <label htmlFor={`b-${lesson.id}`}>Lesson text</label>
              <textarea
                id={`b-${lesson.id}`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
              />
            </div>
          ) : null}

          {lesson.kind === 'lab' ? (
            <div style={{ marginTop: 12 }}>
              <label htmlFor={`e-${lesson.id}`}>Exercise slug</label>
              <input
                id={`e-${lesson.id}`}
                value={exerciseSlug}
                onChange={(e) => setExerciseSlug(e.target.value)}
              />
              <div style={{ marginTop: 12 }}>
                <label htmlFor={`h-${lesson.id}`}>Hint</label>
                <input
                  id={`h-${lesson.id}`}
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {lesson.kind === 'quiz' ? (
            <div style={{ marginTop: 12 }}>
              <label htmlFor={`a-${lesson.id}`}>Assessment id</label>
              <input
                id={`a-${lesson.id}`}
                value={assessmentId}
                onChange={(e) => setAssessmentId(e.target.value)}
              />
            </div>
          ) : null}

          <button
            className="btn"
            type="button"
            style={{ marginTop: 12 }}
            disabled={busy || !title.trim()}
            onClick={() => {
              onChange({
                title: title.trim(),
                body: lesson.kind === 'reading' || lesson.kind === 'video' ? body : null,
                hint: lesson.kind === 'lab' ? hint : null,
                exerciseSlug: lesson.kind === 'lab' ? exerciseSlug : null,
                assessmentId: lesson.kind === 'quiz' ? assessmentId : null,
              });
              setOpen(false);
            }}
          >
            Save lesson
          </button>
        </div>
      ) : null}
    </li>
  );
}

function AddLessonForm({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (input: { title: string; type: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('reading');

  return (
    <form
      className="row"
      style={{ gap: 8, alignItems: 'flex-end', marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd({ title: title.trim(), type });
        setTitle('');
      }}
    >
      <div style={{ flex: 1 }}>
        <label htmlFor="lesson-title">New lesson</label>
        <input
          id="lesson-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
        />
      </div>
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Lesson type">
        {LESSON_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <button className="btn secondary" type="submit" disabled={busy || !title.trim()}>
        Add lesson
      </button>
    </form>
  );
}
