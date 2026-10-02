'use client';

import { Smartphone } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TmaLinkPanel } from '@/components/product/tma-link-panel';

/**
 * «Telegram-приложение» for members who cannot open «Настройки» (manager/operator/viewer presets): every member
 * links their OWN Telegram (REQ-L1, owner decision D1 «all staff»). Owner/admin keep the panel in «Настройки».
 * The bot token is hidden from members, so the panel learns about a missing bot from the API (botConfigured=null).
 */
export function TmaLinkDialog() {
  return (
    <Dialog>
      <DialogTrigger
        className="text-link flex min-h-10 items-center gap-2"
        aria-label="Telegram-приложение"
        data-testid="tma-link-open"
      >
        <Smartphone size={15} aria-hidden/>
        <span className="hidden sm:inline">Telegram-приложение</span>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle className="sr-only">Telegram-приложение</DialogTitle>
        <DialogDescription className="sr-only">Подключение вашего Telegram к мини-приложению кабинета</DialogDescription>
        {/* Mounted only while open (Radix), so the status check runs when the member asks for it. */}
        <TmaLinkPanel botConfigured={null} variant="dialog"/>
      </DialogContent>
    </Dialog>
  );
}
