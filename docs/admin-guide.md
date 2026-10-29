# SAT Sharks admin guide

For the people who run SAT Sharks day to day. Open the admin portal by logging in with an admin
account: you land on **Admin portal → Dashboard**. Everything below is in the sidebar on the left
(a row of tabs on a phone).

Staff accounts see the same portal with less: they can view papers, questions, problem reports,
announcements and SAT dates, but they cannot change anything, and they never see users, payments
or revenue. Make an account staff or admin on its page under *Users* (*Role*).

---

## Dashboard

At a glance: total users, paid vs free, new sign-ups (today and the last 7 days), practice started
today, revenue this month (admins only), transfers waiting for approval, papers published, the
question bank and problem reports. "Today" is the day in Pakistan.

## Payments

**Ways to pay.** Students pay from the pricing page → Checkout. Until a card gateway is connected,
they pay by **bank transfer, JazzCash or Easypaisa** to the accounts you list in
*Settings → Payments*, then type their transaction ID. Their account is not upgraded until you
approve the payment.

**Approving a transfer.**
1. A red number appears on *Payments* in the sidebar, and an email arrives at your payment alert
   address (name, email, plan, amount, method, time, transaction ID).
2. Open *Payments* (this clears the red number). The *To approve* tab lists waiting transfers.
3. Check your bank / JazzCash / Easypaisa account for that amount and transaction ID.
4. **Approve** — the student is upgraded at once and emailed a receipt. Or **Reject** with a short
   note — the student is emailed the note, and nothing changes on their account.

A student can only have one transfer waiting at a time, and a transaction ID is accepted once.

**Receipts and history.** Every paid payment has a receipt (*Receipt* button), which you can print
or save as PDF. *Search* finds payments by student name, email, phone, transaction ID or receipt
number. Revenue for this month and all time, in PKR and USD, is at the top of the page.

**How long a plan lasts.** Monthly = 1 calendar month, 3 Months = 3 calendar months, from the
moment the payment is approved. If the student still has days left, the new period starts when the
current one ends, so renewing early loses nothing. Two days before a plan ends the student gets a
reminder email. Nothing is ever charged automatically.

## Settings → Payments

- **Bank transfer / JazzCash / Easypaisa**: tick the ones you accept, write the account details
  exactly as students should see them, and choose the currencies (JazzCash and Easypaisa are PKR only).
- **Payment alert email**: where the "new payment" emails go (for example your Gmail).
- **Exit offer**: a one-time discount (5–50%) offered once to visitors who are about to leave the
  pricing page without paying. Each account can use it once. Off until you turn it on.
- **Friend invites**: every 2 friends who sign up with a student's invite link and start practising
  give that student a free week of the paid plan (up to 5 weeks). On by default.

Prices themselves are edited in *Settings → Pricing* (plan names, PKR and USD prices, the lines on
the pricing page). What students pay at checkout is the price written there.

## Users

- **Search** by name, email or phone. Tabs: All, Paid, Free (with counts), Disabled, Deleted.
  Filter by region (Pakistan / International) and role.
- **Delete** straight from the list (bin icon) or from the user's page. The account is signed out
  and cannot log in. It can be **restored for 30 days** from the *Deleted* tab; after that it is
  removed for good with all its practice data. *Delete all permanently* empties the Deleted tab now.
- **Open a user** (*Manage*): profile, phone, plan with end date, papers and tests taken, best
  scores, payments, and buttons to make the account paid or free by hand, disable / enable it, or
  change its role (student, staff, admin).
- **Export CSV**: downloads the list with the current tab, filters and search, for Excel or Sheets.

## Papers

Each past exam has a paper per section. A paper is **Draft** (being checked; students cannot see
it), **Published** (students see it) or **Hidden** (taken away from students; every past attempt
and score is kept, and you can publish it again any time).

- *Publish* / *Hide* one paper, or tick several and use *Publish selected* / *Hide selected*.
- **Schedule** (unpublished papers): pick a date and time and the paper publishes itself then —
  for example a new paper every Monday at 9:00.

Uploaded full tests (*Full tests* in the sidebar) are switched on with *Activate*; an inactive
published test can also be **scheduled** to activate itself.

## Mock question pattern (Settings → Adaptive routing)

**Official question pattern** (on by default): every mock module built from the question bank has
the same make-up and order as the official SAT — Reading and Writing from Words in Context to
Rhetorical Synthesis with a fixed number of each type, Math with fixed counts per domain and the
typed-answer questions in fixed places. Turn it off only if an exam is too small to fill the
pattern; modules are then one question per skill in turn. Either way, students get questions they
have not seen before first, and a question the source repeated under two numbers is never given
twice. Uploaded practice tests always keep their own order.

An exam with no Math (11 of the current exams) or too few questions can still be taken as a full
test or mock: its own questions are used first and the rest come from the student's other open
exams. Students are not told: the start dialog looks the same as for any other exam.

Free accounts no longer see how many questions an exam or test holds; premium accounts do.

## Access (what free students can open)

- **Ways of practising**: drills, adaptive section mocks, adaptive full tests and full analytics —
  each *Free* or *Paid only*.
- **Free accounts: drill questions a day**: the daily drill allowance for free accounts (the
  proposal suggests 20). Empty = no limit.
- **Each exam and practice test**: *Free*, *Paid only*, or **Invite code** — only students who type
  that code (on their Home page, under *Have an invite code?*) can open it, whatever their plan.
  Good for a school or a class. Give each invite-only exam its own code.
- **Pin to top** lists an exam first; a **label** (New, Hard, Most attempted) shows on its card.
  Free exams also show a *Free* pill to free students.
- **Exams and tests added later** decides the access of anything published after you last saved.

Nothing is locked until this page has been saved once. Changes apply to tests started from now on;
a student already in a test can always finish it.

## Reports, questions, announcements, SAT dates

- **Reports**: students' "report a problem" queue. Fix the question in the editor beside the report,
  then *Resolve*.
- **Questions**: the whole bank with filters by section, topic, skill and difficulty; edit or delete.
- **Announcements**: banners for all, free or paid students, with an optional end time.
- **SAT dates**: the test dates and deadlines on the public SAT dates page and the dashboard
  countdown. Update them each year from College Board's site.

## Emails students receive

Password reset; receipts; transfer rejected (with your note); plan ends in 2 days; streak at risk
(evening, their time); weekly progress (Monday morning); "your points are still waiting" after
7 days without practice. Students turn the practice emails off on *Goals & streaks*; account and
payment emails always go out.
