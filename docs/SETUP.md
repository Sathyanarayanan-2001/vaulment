# Setup

## Publish the site

1. Create an empty public repository named `vaulment` under `Sathyanarayanan-2001`. GitHub Pages on a free account needs a public repository. The code is public; your data is not in it.
2. Push this project to `main`.
3. In the repository, open **Settings, Pages, Source** and choose **GitHub Actions**.
4. Open the **Actions** tab and wait for *Test and deploy* to finish.
5. Open <https://sathyanarayanan-2001.github.io/vaulment/>.

## First laptop

1. Open the address in Chrome or Edge and create your vault.
2. Save the recovery key on paper.
3. Open **Sync**, press **Choose folder**, and pick a folder inside OneDrive such as `OneDrive\Vaulment`.
4. Install the app from the address bar.

## Second laptop

1. Wait until OneDrive has downloaded the folder.
2. Open the address and press **Bring my vault to this device**.
3. Press **Choose sync folder**, pick the same folder and enter the same master password.

## Android phone

1. Open the address in Chrome.
2. Press **Bring my vault to this device**. If **Choose sync folder** shows, try the OneDrive folder. If it does not show, or OneDrive is not offered, use the next step.
3. On a laptop, open **Sync** and press **Make a backup**, and put the file in OneDrive. On the phone, press **Open a backup** and pick it through the OneDrive app.
4. To send phone changes back, use **Make a backup** on the phone, put the file in OneDrive, then **Merge a backup** on a laptop.

## Develop

```text
npm ci
npm run build
npm run serve     (http://127.0.0.1:4173/vaulment/)
npm run verify    (everything)
```
