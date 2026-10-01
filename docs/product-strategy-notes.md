# Citinet Product Strategy Notes

Captured from a strategy discussion (2026-10-01). These are directional thinking, not commitments. Nothing here describes what the code does today unless stated.

---

## 1. Bridging the two early testers (MVP positioning)

**Feedback received**
- A Gen Z tester saw value only in Atlas and maybe the social side, but didn't understand the purpose or why he'd care.
- A tester around 37-38 saw real value in comms and file upload/sharing.

**Reading:** they found two halves of the same product.
- Atlas = discovery. Without a next step it feels empty ("why not Instagram/Discord/Maps?").
- Comms + files = utility. Clear job, but only works if the people he needs are already on it.

**Bridge: the Club.** Atlas gets people in; chat and files give them a reason to stay.

**MVP guidance**
1. Pick one wedge for the first release. The utility side (coordinate a group, share files) has a clearer job and a built-in growth loop (one organizer invites a group).
2. Make Atlas lead somewhere: a pin opens a Club with live chat, files, members.
3. Fix the cold start: seed a few real Clubs/events so the map isn't empty.
4. Write one-sentence pitches per audience and test whether testers can say them back. If they can't, onboarding failed, not the person.
5. Two testers is n=2. Ask each: "What's one thing you'd use this for this week?"

The Gen Z tester's confusion about *why* is the most valuable signal: the app doesn't explain its purpose in the first minute.

---

## 2. Individualist entry, communal destination

**Premise:** the mission (everyday-people-owned everything app, communal projects) isn't contradicted by entering through individual use. Standard sequencing: come for the tool, stay for the network.

**Single-player first.** Valuable to one person alone, with no network or marketing:
- Personal file storage/sharing on the hub (strongest solo value)
- Private comms with people they already know
- A personal Atlas (my places, my people)

**Pitch:** "Own your digital life," not "join your community." Individualist values (ownership, privacy, control) that happen to need this infrastructure.

**Ladder**
1. **Me** - my files, my chat, my map
2. **My circle** - invite 2-5 people I already know (virtual community people are already comfortable with)
3. **My Club** - a circle that opts into being discoverable/shared
4. **My place** - Atlas surfaces nearby Clubs and events; real-world community arrives as the natural next level

Each step should be motivated by self-interest (the app works better with them), not by being asked to build community.

**Marketing (a stated weakness):** narrow audience with a concrete pain; make the invite the growth loop so every circle that invites friends is marketing you didn't do.

---

## 3. The hosting critique and how to answer it

**Common criticisms**
1. Nobody will run a server.
2. Who keeps it up, secure and backed up? (Real operational limits exist: the Tailscale Funnel can silently lapse, and external throughput is relay-capped around 2.2 MB/s.)
3. Why not Signal / Google Drive / Discord / Nextcloud?
4. A single person's machine can't scale and is a single point of failure.

**Key reframe:** "owned by everyday people" is not "hosted by everyday people." Ownership = who controls the data and the rules, not whose hardware.

| Model | Who runs it | Pros | Cons |
|---|---|---|---|
| Individual self-host | Each user | Max control | Almost no one will; support nightmare |
| Community hub | One trusted person/group per community | Fits the local-community goal | Host becomes bottleneck/liability |
| Managed hubs | You or a co-op, for a fee | Reliable, scalable, fundable | Starts to look like a company |
| Federated | Many interoperable hubs | Resilient, no central owner | Hardest to build; not MVP |

**Recommendation:** community hub as the natural fit, managed hosting as the bridge. Make **portability** the headline guarantee: export everything, point the app at a different hub, nothing is trapped.

**In conversation:** concede first ("most people won't host, and I'm not asking them to"), then reframe ("no one can lock you in"). Avoid leading with "self-hosted"; it signals "for nerds."

**Roadmap implication:** reliability is the product. Before onboarding more testers: backups, uptime monitoring, and a fix for the Funnel lapse.

---

## 4. Proposed app restructure (not implemented)

**Observed state (from the code, 2026-10-01)**
- Tab bar: Home, Notifications (bell that pushes a screen), Create (+), Chat, Me.
- Drawer: Atlas, Initiatives, Events, Feed, Files, Clubs.
- Home quick actions are all creation shortcuts for social content.
- Atlas and Files, the features testers valued, are buried in the drawer.

**Suggested changes**
1. **Tab bar: Home, Atlas, Chat, Files, Me.** Notifications move to a header bell; Create becomes a FAB or header "+". Feed/Events/Initiatives/Marketplace/Clubs stay in the drawer as the later-stage community layer.
2. **Home becomes "mine first":** what needs me (unread, invites) -> recent files and my circle -> nearby (Atlas pins, Clubs).
3. **Club page as the bridge:** chat, files, members and Atlas pin in one place.
4. **First-run onboarding:** "What do you want to do first?" routed to the matching tab.

**Leave alone:** flat rows with hairline dividers, floating pill tab bar, scroll-hide behavior. The problem is information architecture, not visuals.

**Order of work:** tab bar swap + notification bell first (cheap, high visibility); Home rebuild second (needs real data for recent files/circle); Club consolidation last (most screens, most risk).

---

## 5. Managed hosting: money and architecture

**Important clarification:** "hub owner pays" applies only to *managed* hosting, where the service operator runs the hub on its infrastructure. Someone who self-hosts on their own machine owes nothing; they cover their own hardware, power and internet.

**Who pays (managed path)**
| Model | Notes |
|---|---|
| Hub owner pays | Best default; one invoice, tiers tied to storage/members |
| Members split cost | Small committed groups only; awkward to collect |
| Donations | Unreliable as sole funding |
| Hub earns money | Marketplace fees/paid memberships offset the owner's bill; don't depend on it early |

Money flow: member joins free -> owner pays operator -> operator pays the cloud provider. Alternative: a co-op or nonprofit as the operator, charging at cost (fits the mission, far more setup; converting later is the common path).

**UI sketch:** admin "Hub plan" screen (tier, storage, members, next bill, upgrade), "Funding" section (donations, contributions), a prominent "Export / move my hub" button; member-side "About this hub" showing who runs it and how it's funded, with an optional "Chip in" and no paywalls on core features.

**Backend sketch**
1. One isolated instance (container/VM) per hub, own DB and file storage.
2. A thin control plane holding only account/billing/hub-directory metadata.
3. Provisioning: owner picks a plan -> instance spun up -> URL returned -> app connects as it does to hub1 today.
4. Payments through a processor (e.g. Stripe); never store card data.
5. Quota enforcement at upload; lapsed bills go read-only, not deleted.
6. Nightly snapshots, uptime checks, alerts.
7. One-click export/import for portability.
8. Managed hubs on proper public HTTPS hosting, not the Funnel.

**Cautions:** don't build billing first; run a few real hubs for free and learn actual per-hub costs. Per-hub containers are fine at 10 hubs and a burden at 1,000. Hosting others' data brings backup, legal and abuse-handling obligations.

---

## 6. What you can charge for when the software is free

If a user (e.g. "John") self-hosts, he pays nothing for the software. Revenue, if any, comes from services he can't easily do himself:

- **Reachability:** a reliable tunnel/relay (stable URL, HTTPS, no port forwarding, decent speed). The Funnel problem is the example.
- **Push notifications:** mobile push goes through Apple/Google credentials tied to the published app, so it has to run through something the operator runs.
- **Offsite encrypted backup.**
- **Hub directory / cross-hub discovery.**
- **Managed hosting** for people who don't want to run a machine.
- **Setup/support help** (real money early, doesn't scale).

Caveats: because it's open, anyone can run their own relay/push/backup; revenue is convenience plus trust, not control. Charging at all is optional; the real question is what it costs to keep the shared pieces running as users grow. For now, with one hub owner, none of this needs to exist.

**Message for critics:** "Free and open, with optional paid services," not "you need to pay me to use it."
