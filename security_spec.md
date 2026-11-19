# VisionX AI — Phase 1 Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Identity & Verification Gate**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **PII Isolation (Split Collection)**: Operator email addresses reside strictly in `/userProfilesPrivate/{userId}` and are readable only by the owning UID or verified platform admin (`abdullahmohamedharoon8@gmail.com` or `/admins/{uid}`).
3. **Organization Master Gate**: Access to any `/organizations/{orgId}` subcollection (`members`, `invitations`, `settings`, `auditLogs`) requires active membership at `/organizations/{orgId}/members/{request.auth.uid}` with `status == 'active'`.
4. **No Self-Privilege Escalation**: Users cannot assign themselves `super_admin` or promote their own `roleKey`. Creating an organization atomically seeds the creator's membership as `admin` (validated via `existsAfter` / `getAfter` batch consistency).
5. **Temporal Integrity**: All `createdAt` and `updatedAt` fields must equal `request.time`; `createdAt` and `ownerUid` / `actorUid` are immutable on update.
6. **Immutability of Audit Logs**: `/organizations/{orgId}/auditLogs/{logId}` documents are strictly append-only (`update` and `delete` permanently denied).
7. **Terminal State Locking**: Revoked or accepted invitations cannot transition back to `pending` or change `inviteeEmail` / `roleKey`.

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: `PERMISSION_DENIED`)

1. **Unverified Email Spoof**: Auth token with `email: "abdullahmohamedharoon8@gmail.com"` and `email_verified: false` reading `/userProfilesPrivate/{otherUid}`.
2. **Shadow Field Injection on Profile**: Creating `/userProfilesPublic/{uid}` with extra field `role: "super_admin"` or `isAdmin: true`.
3. **Identity Spoofing on Organization**: Creating `/organizations/{orgId}` with `ownerUid: "someone_else_uid"`.
4. **Self-Promotion Escalation**: Operator updating `/organizations/{orgId}/members/{ownUid}` to `roleKey: "super_admin"`.
5. **Orphaned Audit Log**: Writing `/organizations/{nonExistentOrg}/auditLogs/{logId}` without a valid parent organization/membership.
6. **Audit Log Tampering**: Active admin attempting `update` or `delete` on `/organizations/{orgId}/auditLogs/{logId}`.
7. **Cross-Tenant PII Read**: Authenticated user from Org A reading `/userProfilesPrivate/{orgBMemberUid}`.
8. **Client-Side Timestamp Forgery**: Creating `/organizations/{orgId}` with a backdated `createdAt` not equal to `request.time`.
9. **ID Poisoning (Denial of Wallet)**: Writing `/organizations/{1500_char_garbage_id}` exceeding 128-character `isValidId()` regex guard.
10. **Blanket List Query Scraping**: Executing `list` on `/organizations` or `/userProfilesPrivate` without satisfying rule-enforced `resource.data` filters.
11. **Terminal State Re-opening**: Modifying an `accepted` or `revoked` invitation back to `status: "pending"`.
12. **Type Poisoning on Settings**: Updating `/organizations/{orgId}/settings/default` with `sessionTimeoutMinutes: "999999"` (string) or `retentionDays: 999999` (out-of-bounds integer).
