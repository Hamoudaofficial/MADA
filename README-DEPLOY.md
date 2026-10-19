# MADA — GitHub Pages package

This package moves the static MADA front end away from Netlify. It keeps the existing Supabase URL and publishable client key in `index.html`; it does not migrate or modify the Supabase database.

## Publish from an Android phone

1. Sign in to GitHub and create a new repository named `mada` (or another name), preferably public if using GitHub Pages on a free plan.
2. Upload the contents of this folder to the repository root. Make sure `index.html` is at the root and `.github/workflows/pages.yml` is included. If the GitHub mobile website hides dot-folders, use the browser desktop-site mode or upload the files using github.dev.
3. Open Settings → Pages and set the build/deployment source to GitHub Actions.
4. Open Actions, select “Deploy MADA to GitHub Pages”, and run it if it did not start automatically. Wait for the workflow to finish successfully.
5. The URL will be `https://YOUR-GITHUB-USERNAME.github.io/REPOSITORY-NAME/`.

## Compatibility review

- Front end: single HTML file with inline CSS/JavaScript and a Supabase JS v2 CDN dependency; no Netlify-specific runtime code was found in the source inspected.
- Supabase: existing project URL and publishable/anon client key are retained. These keys are intended for browser use only when database Row Level Security (RLS) policies are correctly configured. Never put a Supabase `service_role` or secret key in this file.
- Auth redirects: GitHub Pages uses a different origin from Netlify. In Supabase Dashboard → Authentication → URL Configuration, add the new GitHub Pages URL to Redirect URLs and set the Site URL appropriately if the app uses email confirmation or password-reset links.
- Browser features: GitHub Pages is static hosting. It cannot run server-side code or protect secret business logic. Existing Supabase Edge Functions, database policies, and authentication settings remain on Supabase.
- No destructive changes were made to Netlify or Supabase. Keep Netlify online until you confirm sign-in, sign-up, password recovery, search, posting, and messaging work on the GitHub Pages URL.

## Validation status

Static file/package review only. The GitHub repository and Pages deployment have not yet been created from this package, and live sign-in/search have not been end-to-end tested.
