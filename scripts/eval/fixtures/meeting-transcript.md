# Product sync, 14 March

[0:00–0:22] @Priya Okay, I think everyone is here. Thanks for making time. This is the product sync for 14 March, and the main thing today is the offline mode launch, so let's try to leave with a date, a budget, and owners.
[0:22–0:32] @Omar Yes, I'm here, though I'm dialing in from the car park, so tell me if I cut out.
[0:32–0:39] @Priya You're coming through fine, Omar. Tomas, do you want to start with engineering?
[0:39–1:00] @Tomas Sounds good. Quick status first from my side, if that works. The sync engine is about two thirds done. Reads and writes work offline, and the part still missing is the merge when the phone comes back online.
[1:00–1:08] @Priya Great, thanks. Is that on track for a working prototype soon, or is that optimistic?
[1:08–1:23] @Tomas I think it's realistic. I can have the sync prototype by 28 March, as long as nobody adds scope. That leaves about five weeks before launch for testing.
[1:23–1:48] @Lena From design, I have the offline states mostly drawn. A small banner when you lose connection, a little cloud icon on items that haven't synced yet, and an error screen for when a sync fails. I can send the final screens to engineering by 21 March.
[1:48–2:00] @Priya That works for me. Omar, what are you hearing from customers? I know a few accounts have been asking about offline for months.
[2:00–2:21] @Omar Honestly, it's the top request in almost every renewal call. Field teams lose signal in warehouses and basements, and then they can't open anything. Three of our biggest accounts said they'd expand their seats if offline mode works well.
[2:21–2:36] @Priya That's useful, and it's the kind of detail Lena and Tomas can use. Could you put together a list of those customers and what each one needs?
[2:36–2:53] @Omar Yes, I can send that list, with what each customer needs, by 20 March. Some of them are very specific, like needing it to work for a full shift without any signal.
[2:53–3:08] @Priya Right, and that's why the date matters. The target we floated last week is 2 May. Before we lock it, does anyone see a reason it can't hold?
[3:08–3:32] @Omar Yeah, so, I do. I'm a bit nervous about 2 May. I think June is safer. The usability study Lena wants won't have results until late May, and I'd rather not put something in front of those accounts that we haven't tested with real users.
[3:32–3:55] @Tomas I disagree with that. If we push to June, the code just sits there. We'll have a prototype by 28 March, and five weeks is plenty for testing. And a June date has a way of slipping to July. I don't love that.
[3:55–4:14] @Omar Sure, but a rough launch is worse than a late one. If the offline mode loses someone's work in a basement, that account is gone, and we've burned the exact customers who asked for it.
[4:14–4:31] @Priya Let me ask both of you something. Omar, what would we actually know in June that we don't know on 2 May? And Tomas, what do we lose if we wait?
[4:31–4:51] @Omar Mostly the study results, and sales being properly trained. Those are the two things. I don't have a third reason, I just have a bad feeling about shipping something this new with nothing to back it up.
[4:51–5:14] @Tomas We lose momentum. Two other projects land in June, so offline would get half a team. And a competitor shipped offline last month, so every week we wait costs us something. I'm not saying skip testing, I'm saying testing and launching can overlap.
[5:14–5:37] @Lena Can I jump in? I think there's a middle path. The study doesn't have to finish before launch. We could run it while engineering finishes, and fix whatever it finds in the first update. But I do need the budget to start it.
[5:37–5:44] @Priya Okay, let's talk about the budget, because it connects. Lena, what's the number?
[5:44–6:09] @Lena The agency quoted 40,000 dollars for the usability study. That covers recruiting, two rounds of sessions with people who work in the field, and a written report. I know it's a lot, but cheaper options only test in an office with good Wi-Fi, which defeats the point.
[6:09–6:18] @Priya Is that inside this quarter's research budget, or does it need a separate approval from finance?
[6:18–6:33] @Lena It's mostly inside the research line, but not entirely. I think we'd need finance to sign off on the rest, which is why I wanted to ask today.
[6:33–6:51] @Omar 40,000 dollars is real money. And if it's not done before launch, what are we buying? A report in late May about a product that's already out. That's my whole point for waiting.
[6:51–7:13] @Tomas It buys us the findings for the first update, not for the launch. Look, I'd rather ship 2 May and fix things than wait and fix the same things in June. The bugs don't get fewer just because we waited.
[7:13–7:32] @Omar The bugs don't, no, but our readiness does. We need sales training and a demo environment, and honestly I don't think we can be ready by 2 May. I'm only trying to protect the launch.
[7:32–7:57] @Priya Okay. I've heard both sides, and I'm going to make the call. We ship on 2 May. The usability study runs in parallel, and anything it finds goes into the first update. Omar, I hear you on readiness, and we'll plan sales training around that date.
[7:57–8:15] @Omar Okay. I'll go with it, but I want it on record that I think June was the safer call. If the study finds something big, I'm going to remind everyone I said this.
[8:15–8:32] @Priya Noted, and fair. And to be clear, the study budget is approved in principle at 40,000 dollars. I'll sort out finance, confirm the vendor, and sign it off by 18 March.
[8:32–8:50] @Lena I'm glad the study runs in parallel. Even a few sessions will show us where people get stuck, and I would rather change the screens after launch than not learn anything at all.
[8:50–9:09] @Tomas Since we're on risks, I have one that worries me more than the date. Battery. In our overnight test, with background sync running, battery life dropped 9 percent compared to the same phone without offline mode.
[9:09–9:26] @Lena A 9 percent drop sounds small, but I think people notice it. If the battery drains faster, they blame the app, and the reviews start. I'd call that a launch risk.
[9:26–9:36] @Priya Where is the drain coming from? Is it the sync itself, or something else running in the background?
[9:36–9:59] @Tomas Mostly it's the background photo upload. The app keeps waking the radio to push large photos while the phone is idle. The rest of the sync is cheap by comparison. I haven't isolated it fully, so take that with a grain of salt.
[9:59–10:06] @Priya What can we do about it, other than just hoping it improves?
[10:06–10:29] @Tomas A few things. We can sync only on Wi-Fi or while charging, and slow everything down when the battery is low. I can rerun the same overnight test with throttled sync by 4 April, and then we'd know if 9 percent comes down.
[10:29–10:41] @Lena Would users be able to turn background sync off themselves? I'm thinking about a setting, and where I'd put it in the design.
[10:41–10:58] @Tomas Probably, yes. I'd want a toggle, and I'd turn sync down automatically on low battery. But I'd rather not rely on users finding a setting to fix a problem we caused.
[10:58–11:19] @Lena Honestly, even with that, I'd cut the background photo upload from the launch. It's the biggest source of the drain, and it's also the most complicated screen I've drawn, with the queue, the retries, and the failed states.
[11:19–11:34] @Omar Hmm. That's the one a couple of customers specifically asked for, so I'm a little torn. Can people still add photos at all, or is that gone too?
[11:34–11:56] @Tomas They can still attach photos while the app is open and online. What we'd cut is the part that uploads in the background while the phone is idle. That's the part that eats the battery and that I'm least sure about.
[11:56–12:12] @Priya Okay, decision. Background photo upload is out of the launch. Photos still upload when the app is open. We'll revisit it after launch, once we have battery numbers we trust.
[12:12–12:24] @Omar Fine. I can live with that if we say it clearly in the release materials, so nobody thinks it's coming on day one.
[12:24–12:38] @Lena That helps me, too. It removes the upload queue screen and two error states, so the final screens by 21 March look a lot more realistic.
[12:38–12:50] @Omar When would the first update be, roughly? Customers will ask what happens with the study findings, and I'd like to say something concrete.
[12:50–13:07] @Priya I'd say a few weeks after launch, but I don't want to promise a date until we see the findings. Tell them we plan updates after launch, and leave it there.
[13:07–13:29] @Lena Can I raise something I don't have an answer to? When two people edit the same item offline and then both reconnect, what should the app show? Do we ask them to choose, or does the last edit just win?
[13:29–13:49] @Tomas I honestly don't know yet. Last edit wins is the easy version, but it can silently throw away someone's work, and I'm not comfortable with that. I'd want to think about it more before I say anything.
[13:49–13:59] @Priya Right. Let's put that on the open list, because I don't think we can settle it in this meeting.
[13:59–14:18] @Omar Here's another one. Is offline mode going to be on the free plan, or only on paid plans? Customers are going to ask me that on day one, and I don't want to improvise an answer.
[14:18–14:28] @Tomas I don't know either. That's a pricing question, and I don't think any of us own that decision.
[14:28–14:47] @Priya Okay, that goes on the open list too. So two open questions, what the app shows on a conflict, and which plan gets offline mode. Nobody here has the answer yet, and that's okay for today.
[14:47–15:04] @Omar Totally unrelated, but is anyone going to the Fieldwork Expo next month? We have a booth, and I was hoping to show offline mode there, even if it's only a rough demo.
[15:04–15:24] @Tomas I might go. A friend of mine is giving a talk on sync engines, and the hallway conversations are usually the best part. The prototype should run in airplane mode by then, but it will look rough.
[15:24–15:39] @Lena I went last year. The talks were fine, but the lunch line was endless. If you go, bring snacks. Also the badge printers broke on the first morning.
[15:39–15:51] @Priya Ha, okay. Let's park the Expo and finish the agenda, or we'll run over. We still need to go through the action items.
[15:51–16:09] @Priya So, decisions first. One, we ship offline mode on 2 May. Two, the usability study gets 40,000 dollars and runs in parallel with the build. Three, background photo upload is cut from the launch.
[16:09–16:31] @Priya Now the action items. Tomas will have the sync prototype by 28 March. Lena will send the final offline screens to engineering by 21 March. And I will confirm the vendor and sign off the study budget by 18 March.
[16:31–16:52] @Priya Omar will send the list of customers who asked for offline mode, with what each one needs, by 20 March. And Tomas will rerun the battery test with throttled sync by 4 April. That's five. Did I miss anything?
[16:52–17:06] @Tomas That's right for me. 28 March for the prototype, and 4 April for the battery retest. I'll flag it early if either one looks tight.
[17:06–17:17] @Lena Mine is 21 March for the final screens. I'll send them straight to Tomas so he can start on the states.
[17:17–17:29] @Omar Mine is the customer list by 20 March. And I'm still a little nervous about 2 May, but I'll help make it work.
[17:29–17:47] @Priya Good. Mine is 18 March, for the vendor and the budget. The two open questions stay open for now. Thanks, everyone, I think we're in a much better place than when we started.
[17:47–17:54] @Omar Thanks. Talk to you all soon, and sorry again about the car park.
