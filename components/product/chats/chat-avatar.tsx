import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarTone, initials } from "@/lib/chat-view";

/** Initials avatar with a stable per-lead colour (no Telegram photos in the data). */
export function ChatAvatar({ id, name, size = "md" }: { id: string; name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <Avatar className="chat-avatar" data-avatar-size={size} data-tone={avatarTone(id)} aria-hidden>
      <AvatarFallback className="chat-avatar-fallback">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
