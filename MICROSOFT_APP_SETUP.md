# Microsoft App Registration for Chckmte Local Development

This guide explains how to register the Chckmte application with Microsoft to get the `Client ID` and `Client Secret` required for local development.

---

### Step 1: Go to the Azure Portal

1.  Open your web browser and navigate to the [Azure App registrations page](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2.  Sign in with your Microsoft account.

---

### Step 2: Create a New App Registration

1.  Click the **"+ New registration"** button.
2.  **Name:** Enter a name for your application (e.g., `Chckmte-Dev`).
3.  **Supported account types:** Select **"Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**.
4.  Leave the **Redirect URI** section blank for now.
5.  Click the **"Register"** button.

---

### Step 3: Configure the Redirect URI

1.  From the left-hand menu of your new app registration, select **"Authentication"**.
2.  Click **"+ Add a platform"** and choose **"Web"**.
3.  Under the "Redirect URIs" section, enter the following URL:
    ```
    http://localhost:5173/auth/callback
    ```
4.  Click the **"Configure"** button. This URI must exactly match the `redirect_uri` configured in the application's backend.

---

### Step 4: Create a Client Secret

1.  From the left-hand menu, select **"Certificates & secrets"**.
2.  Click the **"+ New client secret"** button.
3.  Give it a description (e.g., `dev-secret`).
4.  Set "Expires" to your desired duration (e.g., 6 months).
5.  Click **"Add"**.

---

### Step 5: Get Your Credentials

1.  **Copy the Client Secret:** After creating the secret, a **Value** will be displayed. **Copy this value immediately** as it will be hidden after you leave the page. This is your `MS_CLIENT_SECRET`.
2.  **Copy the Client ID:** Go back to the **"Overview"** page for your app registration. Find the **"Application (client) ID"** and copy it. This is your `MS_CLIENT_ID`.

---

### Step 6: Update Your `.dev.vars` File

Open the `.dev.vars` file in the project root and paste in the values you just copied:

```ini
# ...
MS_CLIENT_ID="<PASTE_YOUR_CLIENT_ID_HERE>"
MS_CLIENT_SECRET="<PASTE_YOUR_CLIENT_SECRET_VALUE_HERE>"
# ...
```

After completing these steps, you can run `pnpm dev` to start the application and test the login flow.
