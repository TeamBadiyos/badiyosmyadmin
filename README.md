# Badiyos Command Center

Create a minimal admin panel web app called "Badiyo Command Center".

DESIGN SYSTEM (strict — reuse exactly):

- Primary Brand Green: #00B97A

- Secondary/Charcoal: #222831

- Background: #F8FAFA

- Card Background: #FFFFFF

- Primary Text: #222831

- Secondary Text: #6B7280

- Border: #E5E7EB

- Success: #16A34A / Warning: #F59E0B / Error: #DC2626 / Info: #2563EB

- Font: Nunito Sans (weights 400/500/600/700)

- Spacing: 8pt grid (4,8,16,24,32,48,64,96)

- Border Radius: Buttons 14px, Cards 18px, Inputs 14px, Modal 24px

- Buttons: Primary height 52px radius 14px bg #00B97A white text weight 700

- Design principles: Less is More, One Primary Action Per Screen, Whitespace matters, Mobile-first but this is primarily a desktop tool

LAYOUT:

Build a simple two-screen shell:

1. LOGIN SCREEN

   - Centered card on #F8FAFA background

   - Badiyo logo placeholder (text "badiyo" in green, Nunito Sans)

   - Email field, Password field, "Log In" button (primary green)

   - No functionality yet — just the UI, static screen

   - Simple error text placeholder below button (hidden by default)

2. EMPTY APP SHELL (post-login layout, just build the frame, no real data)

   - Left sidebar (240px, white bg, right border #E5E7EB): nav items with icons (use Lucide icons) — Dashboard, Bookings, Zones, Experts, Area Partners, Service Catalogue, Homepage Builder, Wallets & Payouts, Referrals, Roles & Permissions, Reports, Audit Logs. Active item has green left border + light green background tint.

   - Top bar: page title on left, profile avatar circle + name + logout icon on right

   - Main content area: just show a placeholder "Coming soon" centered text for whichever nav item is selected

   - Sidebar nav items should be clickable and switch the placeholder content area (client-side only, no routing logic needed yet)

Do NOT add any backend, auth, or database logic yet — this is UI scaffold only. Do NOT add extra screens beyond these two. Keep it minimal and clean, no unnecessary animations or decorations.

Use the attached word mark logo on dark bag use white and on white bg use dark

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://badiyosmyadmin.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/59012e70-7ff3-42b2-9cb5-92ca0f5dbec2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
