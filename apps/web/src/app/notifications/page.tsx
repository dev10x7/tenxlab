import { SurfacePage } from '@/components/SurfacePage';

export default function NotificationsPage() {
  return (
    <SurfacePage href="/notifications" title="Notifications">
      <p className="muted">
        Deadlines, graded assessments, and trainer feedback will surface here.
      </p>
    </SurfacePage>
  );
}
