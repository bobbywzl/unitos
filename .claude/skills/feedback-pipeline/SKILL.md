---
name: feedback-pipeline
description: The feedback pipeline. One run reads the production app's feedback inbox, turns the requests that fit into code changes on branches, opens one pull request per change for employees to review, and after a pipeline pull request merges (Vercel deploys main) marks its feedback resolved and replies to the senders. The "Feedback pipeline" Routine runs it daily; run it by hand with /feedback-pipeline.
---

# feedback-pipeline

Customer request → employee review → deployment. The run writes code and opens pull requests. People review and merge. Vercel deploys `main`. Nothing reaches `main` without a person.

## Needs

- `UNITOS_URL`: the production app, no trailing slash.
- `ADMIN_PASSWORD`: the admin gate of that app (SPEC.md §2).
- GitHub access to `bobbywzl/unitos` through the GitHub MCP tools.

Missing any of these: say which one, and stop. Never guess a URL or a password.

## Rules

1. Never push to `main` or `integration`. Never merge. Never close a pull request.
2. At most 5 new pull requests per run. One change per pull request.
3. A change is one feedback item, or one cluster of items that ask for the same thing.
4. Take only feedback that is concrete enough to implement and fits SPEC.md and CLAUDE.md. Everything else stays for a person: leave its status alone and list it in the run report with the reason.
5. Read SPEC.md and CLAUDE.md before writing code. CLAUDE.md's text rules apply to everything the run writes: pull request titles and bodies, replies, commit messages.
6. Never reply to a sender before the change is on `main`.
7. Never write a password, a cookie, or a sender's email into a pull request, a commit, or a reply.

## One run

1. **Sign in.** `curl -sS -c $JAR -H 'Content-Type: application/json' -d '{"password":"'"$ADMIN_PASSWORD"'"}' $UNITOS_URL/api/admin/auth`. A non-200 answer: stop and say so.
2. **Fetch the inbox.** `curl -sS -b $JAR "$UNITOS_URL/api/admin/feedback?status=new,seen&take=2000"`. Each row: `id`, `category` (bug, idea, other), `message`, `page`, `userId`, `status`, `createdAt`.
3. **Find pipeline pull requests.** Search pull requests in `bobbywzl/unitos` whose body carries a `Feedback-Ids:` line (open, merged, and closed). Parse the ids from that line. Three sets:
   - In an open pull request: skip; a person has not decided yet.
   - In a closed, unmerged pull request: skip; a person rejected it. List it in the report.
   - In a merged pull request: go to step 4.
4. **Resolve what shipped.** For each feedback id in a merged pull request whose status is not `resolved`:
   - Reply to the sender: `POST $UNITOS_URL/api/admin/feedback` with `{"id": "<id>", "body": "Shipped: <one sentence on what changed>."}`. A 400 means the feedback has no account; skip the reply.
   - Then `PATCH $UNITOS_URL/api/admin/feedback` with `{"id": "<id>", "status": "resolved"}`.
5. **Cluster the rest.** Group the remaining `new` and `seen` items by what they ask for. Order the clusters: bugs before ideas, more senders before fewer, concrete before vague. Take at most 5.
6. **Make each change.** For each cluster, in order:
   - `git fetch origin main && git checkout -B feedback/<slug> origin/main`. The slug: a few lowercase words on what changes.
   - Implement the change. Keep it to what the feedback asks for. A schema change needs a migration under `prisma/migrations/`.
   - Check: `npx eslint <changed files>` and `npx tsc --noEmit`. Both clean before committing.
   - Commit with a message that says what changed and why, then `git push -u origin feedback/<slug>`.
   - Open the pull request against `main`. Title: `Feedback: <what changes>`. Body, in this order:
     - **What changed**: two or three sentences.
     - **Why**: every feedback item in the cluster, one bullet each: category, date, page, the message quoted. No sender email, no user id.
     - **Review**: the checklist for the reviewer, one line each: the change does what the feedback asks; it fits SPEC.md; the text follows CLAUDE.md; no stored data is lost; a migration, if any, is additive.
     - The line `Feedback-Ids: <id>, <id>` on its own.
     - The Claude Code attribution footer.
   - `PATCH` each id in the cluster to `seen`.
   - A cluster whose change fails the checks or cannot be finished: `git checkout main`, delete the branch, leave the feedback alone, and list the cluster in the report with the reason.
7. **Report.** End with one report: pull requests opened (title, link, feedback count), feedback resolved and replied to, feedback skipped and why. Nothing else.

## What a person does

- Reviews a `Feedback:` pull request with its checklist. Merges it, or closes it.
- A merge deploys `main` through Vercel. The next run resolves the feedback and replies to its senders.
- Pauses or reschedules the Routine from the Routines list; the run never changes its own schedule.
