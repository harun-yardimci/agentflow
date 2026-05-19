# LinkedIn Post #2 — Worktree isolation deep-dive (follow-up)

**Audience:** Same — solo devs / indie hackers who already use multiple AI CLIs.
**Goal:** Reinforce awareness with one concrete, specific differentiator: **git worktree per task**.
**Voice:** Founder, technical, concrete. Show, don't tell.
**Attach:** `assets/crew-directory.png` (9 crew members, mixed models).
**Post at least 5 days after Post #1.**

---

## Primary version (English)

Quick story about why every AI agent task in AgentFlow runs in its own git worktree.

I used to run two Claude Code sessions on the same branch.
The first one refactored `server/auth.ts`.
The second one, unaware, refactored the same file — from the pre-refactor version still in its context.
First agent's work: gone.
Merge conflict: silent, because they were both "done."
Me: an hour into debugging a feature I thought was already built.

The fix isn't better prompting. The fix is isolation.

A git worktree is a second checkout of the same repo, in a different folder, on its own branch — sharing the underlying `.git` directory but not the working tree.

So in AgentFlow:
- Task A runs in `worktree-task-A/` on its own branch.
- Task B runs in `worktree-task-B/` on its own branch.
- They never see each other's files.
- When a task finishes, its diff is yours to merge, reject, or throw away.

Practical consequences:
- You can run 10 tasks in parallel on the same repo, on the same day, without git holding you hostage.
- You get a clean, per-task diff view. No "what did it touch?" archaeology.
- Failed tasks don't contaminate successful ones.
- You can compare the SAME prompt across Claude, Codex, and Gemini — side-by-side, fair fight.

The attached screenshot is the "Crew" view: nine agents, each with a role and a model, ready to be assigned to worktree-isolated tasks. Architect, Developer, QA, Designer, Writer — each one lives in its own sandbox when it runs.

If you're bumping into parallel-agent chaos and haven't reached for worktrees yet — try it. Even without AgentFlow, `git worktree add ../feature-x feature-x` is worth knowing.

---

## Turkish variant

Hızlıca bir hikaye — AgentFlow'daki her AI agent task'ı neden kendi git worktree'sinde çalışıyor?

Eskiden aynı branch üzerinde iki Claude Code session'ı çalıştırıyordum.
İlki `server/auth.ts`'i refactor etti.
İkincisi, ondan habersiz, aynı dosyayı refactor-öncesi haliyle (kendi context'inde hâlâ o vardı) yine refactor etti.
Birincinin işi: yok oldu.
Merge conflict: sessiz, çünkü ikisi de "done"du.
Ben: zaten var olduğunu sandığım bir feature'ı bir saat boyunca debug ettim.

Çözüm daha iyi prompt değil. Çözüm izolasyon.

Git worktree, aynı repo'nun farklı bir klasörde, kendi branch'inde ikinci bir checkout'u — aynı `.git` dizinini paylaşır ama working tree'yi paylaşmaz.

AgentFlow'da:
- Task A → `worktree-task-A/`, kendi branch'inde.
- Task B → `worktree-task-B/`, kendi branch'inde.
- Birbirlerini hiç görmezler.
- Task bittiğinde, diff senin — merge et, reddet, at.

Pratik sonuçlar:
- Aynı repo'da, aynı gün, paralel 10 task çalışır. Git sana engel değildir.
- Temiz, task başına diff. "Bu ne yaptı?" kazısı yok.
- Fail olan task'lar, başarılı olanları kirletmez.
- AYNI prompt'u Claude / Codex / Gemini'de yan yana, adil karşılaştırmayla çalıştırabilirsin.

Ekran görüntüsü "Crew" view: dokuz agent, her biri bir rol ve bir model ile, worktree izolasyonlu task'lara atanmaya hazır. Architect, Developer, QA, Designer, Writer — hepsi çalıştığında kendi sandbox'ında.

Paralel-agent kaosuna çarpıyorsan ve worktree'lere henüz uzanmadıysan — dene. AgentFlow olmasa bile, `git worktree add ../feature-x feature-x` bilmeye değer.
