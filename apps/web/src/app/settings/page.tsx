import { SurfacePage } from '@/components/SurfacePage';

export default function SettingsPage() {
  return (
    <SurfacePage href="/settings" title="Platform settings">
      <p className="muted">
        Theme, notifications, and account preferences for your TenXLab profile.
      </p>
    </SurfacePage>
  );
}
