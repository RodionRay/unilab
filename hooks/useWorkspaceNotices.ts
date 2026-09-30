"use client";

import { useEffect, useState } from "react";
import { loadNotices, subscribeNotices, type WorkspaceNotice } from "@/lib/workspace-notifications";

export function useWorkspaceNotices() {
  const [items, setItems] = useState<WorkspaceNotice[]>([]);

  useEffect(() => {
    setItems(loadNotices());
    return subscribeNotices(() => setItems(loadNotices()));
  }, []);

  return items;
}
