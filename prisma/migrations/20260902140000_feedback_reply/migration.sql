-- Replies to feedback (SPEC.md §18). Feedback.userId is the account that filed
-- it (null = no account). A reply is a Notification of kind "feedback" that
-- points back at the feedback through feedbackId; deleting the feedback keeps
-- the notification and clears the pointer.
ALTER TABLE "Feedback" ADD COLUMN "userId" TEXT;

ALTER TABLE "Notification" ADD COLUMN "feedbackId" TEXT;

CREATE INDEX "Notification_feedbackId_idx" ON "Notification"("feedbackId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
