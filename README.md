# 🗓️ Routine Gen

**Generate conflict-free academic schedules effortlessly.**

A browser-based tool that automatically builds college timetables across multiple departments, semesters, and shared faculty — without silently double-booking a teacher who's needed in two places at once.

🔗 **Live:** [routinegen.vercel.app](https://routinegen.vercel.app/)

---

## Why I built this

I got the idea for this after seeing our own teachers struggle with making the routine every semester — it's a genuine headache for them. Multiple departments, multiple semesters, and the same teachers shared across different classes, so one small clash means redoing half the timetable by hand.

One of our teachers actually told me to try building something that could help with this — that's what pushed me to sit down and actually build it, instead of it just staying an idea.

So this wasn't built as a random side project or a "let me make a scheduler for fun" thing — it came directly from watching a real problem happen in front of me, and a teacher's push to go build a real fix for it.

**It's currently being used at my college to generate real semester timetables — teachers there have used it for this entire academic year, and they've been genuinely happy with the results.**

---

## What it actually does

Routine Gen walks you through a 4-step wizard:

1. **Settings** — global defaults: total periods per day, period duration, college start time, and where the tiffin break sits.
2. **Departments** — add departments, then manage each one's semesters (Sem 1, 2, 3...), where every semester can have its **own independent timing** — its own period count, duration, and start time, completely separate from every other semester — plus its own subjects and class types (Theory, Theory Extended, Lab, Lab Extended, or Theory + Lab).
3. **Teachers** — register faculty: their working days, an optional available-hours window (for teachers only in college part of the day), and which department/semester/subject combinations they teach.
4. **Routines** — hit Generate, and the engine builds a full conflict-checked weekly schedule across every department and semester at once.

Any slot the algorithm genuinely can't fill gets surfaced individually in a **Resolve Conflict** screen, where you can manually insert a filler class (Library period, or a custom class of your choice) for one or two periods.

---

## Three ways to get your data in

Not everyone wants to click through forms department by department, so there are three input paths:

- **Manual entry** — through the step-by-step wizard UI itself.
- **Excel bulk import** — download the official 3-sheet starter template (`Departments & Timing`, `Subjects & Labs`, `Teachers`), fill it in, and import it directly. Good for setting up a full college's worth of departments in one go instead of one-by-one.
- **JSON import** — a dedicated import page where you paste routine entries as JSON and watch conflicts get caught live, entry by entry, with an Auto-Place option that finds the next free non-clashing slot, or a filler-insert option for slots that can't be auto-resolved.

Session progress auto-saves as you go, so closing the browser mid-setup doesn't lose your work — you get a "Restore Session?" prompt next time you open it.

---

## The actual engine

### The core problem
If two different semesters each have "Period 3," those two Period 3s might not even be at the same clock time — one semester might start at 9:00 AM, another at 9:30 AM, with different period lengths. So you *can't* just check "is this teacher free in Period 3" — Period 3 doesn't mean the same thing twice.

### How I solved it
Every period, in every semester, gets converted into actual **start and end minutes** (literal clock time in minutes since midnight). When the algorithm is deciding whether a teacher can be placed into a slot, it doesn't compare period numbers at all — it checks whether that teacher already has *any* class, in *any* department, whose real time range overlaps this one:

```js
const busyConflict = busyIntervals[t.id].some(iv =>
  intervalsOverlap(startMin, endMin, iv.start, iv.end)
);
```

So a teacher can never be double-booked, even across two semesters that don't share a single matching period number — because the check happens on real time, not on labels.

### Load balancing
When more than one teacher is technically free for a slot, the engine doesn't just grab the first match — it picks whoever currently has the **lightest workload for that day**, so classes don't pile up on one teacher while another sits mostly idle:

```js
candidates.sort((a, b) => teacherWorkload[a.teacher.id] - teacherWorkload[b.teacher.id]);
```

### Handling 2-period classes (labs)
Labs and extended theory blocks need two back-to-back periods, not one. The engine checks that the *next* period is actually free and isn't the tiffin break before it commits to placing an extended class — otherwise it just wouldn't try.

### When it genuinely can't schedule something
Sometimes every eligible teacher really is busy elsewhere at that exact time. Instead of silently leaving the slot blank or guessing, the engine flags it as an honest **conflict** and tells you *which* teachers it tried and why they failed — and you get a manual **Resolve Conflict** screen to fill that slot yourself.

That distinction — "genuinely no one's free" vs. "just an empty gap" — mattered a lot to me. A scheduler that silently produces a broken timetable is worse than one that's honest about where it got stuck.

---

## Design

A deliberately restrained, zero-color dark interface — pure black canvas, zinc borders, high-contrast white typography, no gradients, no accent color. The goal was something that reads like a real dev tool, not a generic "AI SaaS" template — flat, minimal, and functional first.

---

## Features, in short

- Multi-department, multi-semester setup, each with independent timing
- Automatic conflict-free routine generation across every section at once
- Teacher workload balancing
- Extended (2-period) lab/class support with tiffin-break awareness
- Manual conflict resolution with filler-class insertion for slots that genuinely can't be auto-filled
- Three data-entry paths: manual wizard, Excel bulk import/export (with downloadable template), and live JSON import
- Session auto-save and restore
- Built-in Help / User Guide page

---

## Tech stack

Plain HTML, CSS, and vanilla JavaScript (ES6+), styled with Bootstrap 5. No framework, no backend — everything runs and persists in the browser via session storage. I wanted to keep it simple enough that I could reason about every line of the scheduling logic myself, instead of hiding it behind a framework's abstractions.

---

## Real-world use

This tool is currently being used in my college to generate actual semester timetables — teachers there have used it for this entire academic year. It's not a demo sitting unused on GitHub — it came out of a real problem I saw firsthand, a teacher's encouragement to actually build it, and it's solving that same problem for real people right now. The teachers using it have been genuinely happy with the results.

---

## License

MIT
