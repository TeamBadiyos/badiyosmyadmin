<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Generate seal-sticker PDFs entirely in the browser from the existing staff export RPC so no duplicate export backend exists.
- Render operational order money through the shared payment-summary component so every board uses the same snapshot labels and zero-value rules.
- Agreements: templates are versioned rows (never edited in place); each issued agreement freezes its filled-in text, and PDFs are drawn in the browser from that text (src/lib/agreement-pdf.ts) — why: the signed wording must never change after issue.
- Merchant/Expert app endpoints for agreements, expert self-registration and party notifications are SECURITY DEFINER RPCs (app_*), not server routes — why: those apps talk to the database directly with the user's own login.
