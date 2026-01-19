# Firebase Cloud Function Setup for Model Search

## Overview
This guide explains how to set up the `searchModels` Cloud Function for backend search functionality.

## Steps to Deploy

### 1. Initialize Cloud Functions (if not already done)
```bash
firebase init functions
```
Choose your project and select JavaScript (or TypeScript).

### 2. Update `functions/index.js`

Replace the contents of `functions/index.js` with the code below:

```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

exports.searchModels = functions.region("europe-west1").https.onCall(async (data, context) => {
    const query = data.query;
    
    if (!query || query.trim() === "") {
        return { results: [] };
    }
    
    const searchQuery = query.toLowerCase().trim();
    
    try {
        // Get all models from the database
        const snapshot = await db.ref("models").once("value");
        const data = snapshot.val();
        
        if (!data) {
            return { results: [] };
        }
        
        // Convert object to array
        const allModels = Object.values(data);
        
        // Filter models by searching in name and description
        const results = allModels.filter(model => {
            const name = (model.name || "").toLowerCase();
            const desc = (model.desc || "").toLowerCase();
            
            // Search for exact word matches or partial matches
            return name.includes(searchQuery) || desc.includes(searchQuery);
        });
        
        // Sort by relevance (name matches ranked higher)
        results.sort((a, b) => {
            const aNameMatch = a.name.toLowerCase().includes(searchQuery) ? 1 : 0;
            const bNameMatch = b.name.toLowerCase().includes(searchQuery) ? 1 : 0;
            return bNameMatch - aNameMatch;
        });
        
        return { results: results };
    } catch (error) {
        console.error("Search error:", error);
        throw new functions.https.HttpsError("internal", "Search failed");
    }
});
```

### 3. Update `functions/package.json`

Make sure you have the required dependencies:

```json
{
  "name": "functions",
  "description": "Cloud Functions for Firebase",
  "scripts": {
    "serve": "firebase emulators:start --only functions",
    "shell": "firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log"
  },
  "engines": {
    "node": "18"
  },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^11.8.0",
    "firebase-functions": "^4.3.1"
  },
  "devDependencies": {
    "firebase-functions-test": "^3.0.0"
  },
  "private": true
}
```

### 4. Deploy the Function

```bash
firebase deploy --only functions
```

After deployment, you should see output confirming the function was deployed to `europe-west1`.

## Testing

1. Open your web app in the browser
2. Go to the Models page
3. Type in the search bar
4. The search should send queries to Firebase backend and return results

## Troubleshooting

### Function not found error
- Make sure you've deployed: `firebase deploy --only functions`
- Check the region matches your function region (should be `europe-west1`)

### Empty results
- Verify your models are properly stored in the database at `models/` path
- Check Firebase Console > Database to see your data structure

### CORS issues
- Cloud Functions are CORS-enabled by default, should not be an issue
- If you get CORS errors, check your Firebase security rules

## Performance Notes

- The function loads all models into memory, which is fine for moderate datasets (< 10,000 models)
- For larger datasets, consider implementing pagination or more advanced indexing
- Results are sorted by relevance (name matches appear first)
