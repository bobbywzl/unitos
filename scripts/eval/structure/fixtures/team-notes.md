# Onboarding revamp: team meeting notes

Attendees: Maya (design), Omar (engineering), Lena (product), Theo (support)

## Meeting 1, September 2

Lena: signups are flat for three months while visits grew 20%. The drop is between the signup page and the first project.
Data: 61% of new accounts never open a document. Of those who open one, 70% come back in the first week.
Customer (Northwind school): "I made an account and then did not know what to do. There was an empty page and a button that said New."
Customer (a freelance editor): "Importing my first PDF was great once I found it. It just took me ten minutes to find it."
Decision: the first screen after signup will offer three sample documents and an Import button, not an empty dashboard.
Action (Maya, by September 9): sketch the new first screen with the sample documents.
Action (Omar, by September 9): measure how long the first import takes for a 30-page PDF.
Open question: should the sample documents be in the reader's own field, or the same three for everyone?

## Meeting 2, September 9

Maya showed two sketches: a grid of sample cards, and a single guided "Try it on this article" flow.
Omar: the first import of a 30-page PDF takes 41 seconds on average; 18% of people close the tab before it finishes.
Customer (Bluebird Labs): "The guided tour was the reason I stayed. Seeing my own notes next to the article clicked for me."
Customer (a graduate student): "The tour was too long. I skipped it and then could not find how to make a note."
Theo: support tickets about "where is my document" doubled after the dashboard change in August.
Decision: go with the guided flow, but cut it to three steps and let people leave it at any step.
Decision: show import progress with the page count, so a long import does not look stuck.
Action (Omar, by September 16): show progress during import, with pages done out of pages total.
Action (Theo, by September 12): tag the last month of tickets by where the reader got stuck.
Open question: do we keep the old dashboard for accounts older than a year?

## Meeting 3, September 16

Theo: of 212 tagged tickets, 94 were about finding a document after import, 51 about notes, 38 about sharing, 29 other.
Lena: the guided flow test ran on 10% of signups for five days; first-week return went from 31% to 38%.
Customer (Northwind school): "The new start is much clearer. My students found the sample article right away."
Customer (a law clerk): "The progress bar helps, but 41 seconds is still long when you have a deadline."
Decision: roll the guided flow out to every new account on September 23.
Decision: keep the old dashboard for accounts older than a year until the end of the year, then ask them.
Action (Omar, by September 30): cut the first import time in half by parsing the first ten pages first.
Action (Maya, by September 23): write the copy for the three guided steps.
Action (Lena, by September 20): write the rollout note for the changelog and support.
Open question: what do we measure after rollout, beyond first-week return?
Open question: should sharing get its own step in the guided flow, given 38 tickets about it?
