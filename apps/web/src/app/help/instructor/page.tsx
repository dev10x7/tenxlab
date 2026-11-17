import type { Metadata } from 'next';
import { RoleHelpPage } from '@/components/RoleHelpPage';

export const metadata: Metadata = {
  title: 'Instructor guides — TenXLab Help',
  description:
    'Step-by-step guides with screenshots for every instructor feature.',
};

export default function InstructorHelpPage() {
  return <RoleHelpPage role="instructor" />;
}
