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
        const dbData = snapshot.val();
        
        if (!dbData) {
            return { results: [] };
        }
        
        // Convert object to array
        const allModels = Object.values(dbData);
        
        // Filter models by searching in name and description
        const results = allModels.filter(model => {
            const name = (model.name || "").toLowerCase();
            const desc = (model.desc || "").toLowerCase();
            
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
