import type { Metadata } from 'next';
import { RoleHelpPage } from '@/components/RoleHelpPage';

export const metadata: Metadata = {
  title: 'Student guides — TenXLab Help',
  description: 'Step-by-step guides with screenshots for every student feature.',
};

export default function StudentHelpPage() {
  return <RoleHelpPage role="student" />;
}
