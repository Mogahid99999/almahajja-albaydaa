# notify-on-publish — push delivery setup

This is the **only** part of the notifications feature that needs external setup.
Everything else already works once migration `0006_notify_fanout.sql` is applied:

- A student follows a section → an admin publishes a lecture (or adds an
  attachment) in that section's subtree → the database automatically inserts an
  **in-app inbox** row for every follower whose preference for that type is on.
  Open الإشعارات in the app and it's there. No function, no FCM needed.

This function adds the **device push** (the phone buzzes even when the app is
closed). It is a small worker: a Database Webhook calls it with each new
notification row, and it forwards the message to Expo Push → FCM.

## How the pieces fit

```
publish lecture / add attachment
        │  (trigger, migration 0006)
        ▼
insert public.notifications rows  ──►  in-app inbox  ✅ works with no setup
        │  (Database Webhook on INSERT)
        ▼
notify-on-publish  ──►  Expo Push API  ──►  FCM  ──►  Android device
```

## One-time setup

### 1. Deploy the function

```bash
supabase functions deploy notify-on-publish --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — no
secrets to set. (`--no-verify-jwt` lets the database webhook call it; the
function only reads tokens and sends pushes, it never trusts caller input for
the recipient — it uses the row the database wrote.)

### 2. Create the Database Webhook

Supabase Dashboard → **Database → Webhooks → Create**:

- Table: `public.notifications`
- Events: **Insert**
- Type: **Supabase Edge Function** → `notify-on-publish`
- Leave the default `Authorization: Bearer <service_role>` header.

Now every inbox row also fires a push.

### 3. Android push credentials (FCM)

Expo delivers Android pushes through **FCM**, so the project needs FCM
credentials registered with EAS:

1. In the Firebase console, create (or open) a project, add an Android app with
   package `com.riwaqalilm.app`, and download the **FCM v1 service-account JSON**.
2. Upload it to EAS:
   ```bash
   eas credentials       # Android → Push Notifications: FCM V1 → upload the JSON
   ```
   (iOS uses APNs and is configured the same way under the iOS credentials.)

### 4. App config (already in `app.json`)

- The `expo-notifications` plugin is enabled.
- Add your EAS project id so the app can fetch a real Expo push token. Run once:
  ```bash
  eas init
  ```
  then ensure `app.json` has:
  ```json
  "extra": { "eas": { "projectId": "<your-eas-project-id>" } }
  ```
  `src/lib/notifications.ts › getToken()` reads exactly this value; until it's
  set, the app still runs and the in-app inbox still works — only device push is
  skipped.

## Testing without a device

The in-app inbox path needs no device: sign in as the student, follow a section,
sign in as admin (separately), publish a lecture in it, and the student's
الإشعارات list shows the new row. Device push requires a real Android device with
a development/production build (Expo Go cannot receive FCM pushes).
