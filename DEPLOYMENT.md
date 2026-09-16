# Deploying the secured ERP

## 1. Create the production database

Create a MongoDB Atlas project and database user. Copy its connection string into the `MONGODB_URI` setting on the API host. Do not put this string in GitHub Pages or browser JavaScript.

## 2. Deploy the API

Deploy this repository using the included `render.yaml` file. Add the production MongoDB Atlas connection string as `MONGODB_URI`. Render creates `JWT_SECRET` automatically.

## 3. Connect GitHub Pages

In `dist/index.html`, add this script immediately before `api-sync.js` and replace the URL with the deployed API address:

```html
<script>window.ERP_API_URL = 'https://YOUR-ERP-API.onrender.com/api';</script>
```

Set `ALLOWED_ORIGINS` on the API host to `https://ericsdesignsindia.github.io`.

## 4. Create the first production administrator

Open the published CRM in a private browser window. The first visit displays the administrator setup form. Create one strong administrator account. The local account does not transfer to production.
