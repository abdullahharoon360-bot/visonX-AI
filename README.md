# VisionX AI — Intelligent Security & Identity Intelligence Platform

**Current Stage:** Phase 1 — Foundation (Firebase Firestore + Google Authentication, Design System, Organization & RBAC Governance)

## Firebase & Authentication Setup

- **Firebase Project ID:** `smart-weaver-qpjks`
- **Cloud Firestore Database ID:** `ai-studio-visionxai-d2ce5f78-219b-4ec2-ab28-c4a067dcc778`
- **Authentication Provider:** Google Sign-In (`signInWithPopup` with `GoogleAuthProvider`)
- **Bootstrapped Platform Admin Email:** `abdullahmohamedharoon8@gmail.com` (verified via `request.auth.token.email_verified == true` in `firestore.rules`)
- **Configuration File:** `firebase-applet-config.json`
- **Data Blueprint:** `firebase-blueprint.json`
- **Hardened Security Rules:** `firestore.rules` (validated with `@firebase/eslint-plugin-security-rules`)

## Architecture Overview

- **Frontend (`/src`)**: React 19, TypeScript, Vite, Tailwind CSS v4, Radix-backed accessible UI components, React Router, TanStack Query, React Hook Form + Zod, Motion, and Firebase Web SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`).
- **Firestore Schema**:
  - `userProfilesPublic/{userId}` & `userProfilesPrivate/{userId}` (PII-isolated split collection)
  - `organizations/{orgId}` with subcollections `members/{userId}`, `invitations/{inviteId}`, `settings/default`, and immutable `auditLogs/{logId}`
- **Backend (`/backend`)**: Modular FastAPI scaffold preserved for Phase 2+ computer vision workers, biometric verification adapters, deterministic risk engine, and server-side Gemini AI Security Analyst.

## Local Execution

```bash
npm install
npx eslint firestore.rules
npm run lint
npm run build
npm run dev
```

Open `http://localhost:3000` and click **Sign in with Google**.
