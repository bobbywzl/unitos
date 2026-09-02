-- Click telemetry (SPEC.md §7): one row per click on a reader control. surface
-- is where the control lives (topbar | sidebar | ai-toolbar | article-menu |
-- reader | tray); control is the control's id. The admin clicks page reads it.
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "notebookId" TEXT,
    "surface" TEXT NOT NULL,
    "control" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClickEvent_createdAt_idx" ON "ClickEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ClickEvent_surface_control_createdAt_idx" ON "ClickEvent"("surface", "control", "createdAt");

-- CreateIndex
CREATE INDEX "ClickEvent_userId_createdAt_idx" ON "ClickEvent"("userId", "createdAt");
