# Fix: Enable Anonymous Authentication

The error `auth/admin-restricted-operation` occurs because the **Anonymous** sign-in provider is disabled in your Firebase project. This prevents the application from assigning secure IDs to guest users.

## Steps to Enable

1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Select your project (**engrar3d**).
3.  In the left sidebar, click **Build** -> **Authentication**.
4.  Click the **Sign-in method** tab.
5.  Click on **Anonymous** (it should say "Disabled").
6.  Toggle the **Enable** switch to **On**.
7.  Click **Save**.

## Verification

Once enabled:
1.  Refresh your application page.
2.  The error in the console should disappear.
3.  You should see "Konuk" (Guest) in the top right profile area or the "Login" button, but the app will now have a silent User ID in the background.
