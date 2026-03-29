# GasLamar — YC Office Hours Findings

**Date:** 2026-03-29
**Format:** 6-question YC-style forcing function diagnostic

---

## TL;DR

GasLamar has a **real, firsthand pain** and a **clear target user**. The product works.
The bottleneck is not the solution — it's **awareness**. Most Indonesian jobseekers don't
know tailored CVs exist, or don't believe they matter. The **free score** is the wedge:
it creates FOMO and surfaces the gap. But at Rp 29k entry, paid acquisition will bleed
money. You need to either push users up-tier (Single/3-Pack) or find a channel where
CAC is near-zero (organic, campus, community).

---

## The 6 Questions

### 1. Is there real demand?

**Forcing question:** "Would someone pay for this right now, today, before talking to you?"

**Finding:** YES — but only after they see the score.

The dominant behavior is **spray and pray**: jobseekers send the same CV to every listing
without customization. This means:
- They don't yet believe tailoring matters → they won't pay upfront
- After seeing a 42/100 score against a specific job → the gap becomes visceral and real
- The free score is the moment demand becomes legible to the user

**Implication:** The product cannot start at a paywall. The free analyze → paid download
funnel is structurally correct.

---

### 2. What is the status quo?

**Forcing question:** "What are they doing today instead of using GasLamar?"

**Finding:** Sending one generic CV to every job listing — "kirim CV yang sama ke semua
loker."

Most users:
- Have one CV they wrote once and never updated
- Copy-paste the same cover letter (if they write one at all)
- Submit and wait, with no signal on why they get rejected

The status quo is not "using a competitor" — it's **doing nothing different and expecting
a different result.** That's a better market position than competing with another tool.

---

### 3. Who is the exact target user?

**Forcing question:** "Name a real person, not a demographic."

**Finding:** Active jobseeker who has submitted 20+ applications in the last 3 months
and received zero callbacks.

Key characteristics:
- Already in job-seeking mode (not passive)
- Has evidence that something is wrong (no callbacks = the feedback signal)
- Motivated by frustration, not aspiration
- Low-to-mid career (0-5 years experience) — enough to have a CV, not enough to have
  a strong network that bypasses CV screening
- Indonesian, applying to local market — ATS systems are increasingly used by large
  Indonesian corporates and MNCs with local offices

**This user will not pay before they see the score.** The free score is the hook.

---

### 4. What is the wedge?

**Forcing question:** "If you could only do one thing to acquire the first 100 users,
what would it be?"

**Finding:** The **free CV score** shared in WhatsApp groups and campus communities.

The score result is inherently shareable:
- "Skor CV gue cuma 38 buat lowongan Shopee" → FOMO + conversation
- "GasLamar ngasih tau persis kenapa CV gue ditolak" → word of mouth
- A screenshot of a score card with gap analysis → pulls curious friends in

The free score needs a **share button** and a **score card image** to maximize this.
Without it, the organic loop doesn't close.

**Secondary wedge:** Campus placement officers and LinkedIn-active career coaches who
can promote GasLamar to their students/followers in exchange for affiliate revenue or
free access.

---

### 5. Have you seen this pain firsthand?

**Finding:** YES — confirmed personal experience. This is the strongest signal.

Founders who build from their own pain have two advantages:
1. They understand the exact moment of frustration (not a hypothesis)
2. They are the user, so they can evaluate quality without user research

This is a significant credibility signal. It also means the product intuitions (score
first, pay after; bilingual CV for MNC applications; gap analysis not just a score) are
grounded in lived experience, not guesswork.

---

### 6. Are you future-fit?

**Forcing question:** "Will this market be larger or smaller in 3 years?"

**Finding:** LARGER — but the moat needs to be data, not the AI.

Tailwinds:
- Indonesian formal employment market growing; MNCs expanding into Tier 2 cities
- ATS adoption increasing among Indonesian companies of all sizes
- AI literacy among jobseekers rising → normalize AI-assisted job search
- Bilingual CVs becoming standard for MNC applications

Headwind:
- Competitors (Resume.io, Kickresume, local players) will add Indonesian language support
- Claude / ChatGPT can do CV tailoring for free if users know how to prompt

**The defensible moat is not the AI call — it's the job-listing-to-CV match database.**
If GasLamar accumulates data on which CV phrasings score better for which Indonesian
employers and industries, that becomes proprietary signal that generic LLMs can't match.

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Free score → paid download (not fully paid) | Demand not legible until user sees gap |
| 4-tier pricing Rp 29k / 59k / 149k / 299k | Entry price for impulse buy; up-tiers for unit economics |
| Bilingual (ID + EN) from Single tier up | Differentiator for MNC applications; pure-ID market is covered by entry tier |
| Cloudflare Pages + Workers (no server) | Zero ops burden for a solo/small team; costs near-zero at low volume |
| Mayar for payments (not Stripe) | IDR-native, no foreign currency conversion fees, trusted by Indonesian buyers |

---

## Open Questions (unresolved)

1. **Unit economics at Rp 29k:** With paid acquisition (Meta Ads, TikTok), CAC will
   likely exceed Rp 29k. The entry tier may be a loss-leader. Need to measure how many
   Coba users upgrade to Single or 3-Pack within 7 days.

2. **Channel:** Paid acquisition was the stated strategy, but no channel has been tested.
   Hypothesis: TikTok + "CV roast" content style has high organic ceiling before paid
   spend is needed.

3. **Share loop:** The free score has viral potential, but only with a share button +
   score card. Without it, the loop doesn't close. This is currently missing from the app
   (see to-do list item #7).

4. **3-Pack / JobHunt accounting:** A user who buys 3-Pack currently gets one generation
   per payment — there's no per-session counter. Multi-use tiers need usage tracking
   before they can be honestly marketed.

5. **Retention:** After a user gets a job, they're gone. The product is inherently
   transactional. Consider: job alert integrations, "re-tailor for new listing" flow,
   or an annual "CV refresh" subscription to retain the user base.

---

## Recommended Next Actions (in priority order)

1. **Ship the share button** on hasil.html — score card image, shareable link
2. **Add email capture** on hasil.html before tier CTA — builds retargeting list
3. **Add tier recommendation** logic — after scoring, surface "CV kamu butuh banyak perbaikan — 3-Pack lebih hemat untuk proses apply yang panjang" for low-score users
4. **Run 10 manual tests** with real CVs and real job descriptions — validate score quality
5. **First paid traffic test** — Rp 500k Meta Ads budget, measure CPL and conversion to paid
6. **Measure up-tier rate** — what % of Coba buyers upgrade within 7 days?

---

*GasLamar Office Hours — gstack /office-hours diagnostic*
