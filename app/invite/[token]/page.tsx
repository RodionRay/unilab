import type { Metadata } from 'next';
import { InviteAcceptClient } from '@/components/product/invite-accept-client';

export const metadata: Metadata = {
  title: 'Приглашение в команду · UniLab',
  robots: { index: false, follow: false },
};

export default function InvitePage() {
  return <InviteAcceptClient />;
}
