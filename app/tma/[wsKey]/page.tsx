import { TmaApp } from "@/components/tma/tma-app";

export default async function TmaPage({ params }: { params: Promise<{ wsKey: string }> }) {
  const { wsKey } = await params;
  return <TmaApp wsKey={wsKey} />;
}
