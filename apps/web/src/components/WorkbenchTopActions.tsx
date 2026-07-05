"use client";

import { NotificationBell } from "./NotificationBell";
import { UILanguageSelector } from "./UILanguageSelector";
import { WorkbenchUserMenu } from "./WorkbenchUserMenu";

export function WorkbenchTopActions({ onRecharge }: { onRecharge?: () => void }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <NotificationBell />
      <UILanguageSelector compact />
      <WorkbenchUserMenu onRecharge={onRecharge} />
    </div>
  );
}
