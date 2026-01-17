const express = require("express");
const cors = require("cors");
const path = require("path");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.use(express.raw({ type: "*/*", limit: "5mb" }));

// Middleware pour gérer la préflight OPTIONS et ajouter les en-têtes CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Autoriser toutes les origines
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"); // Méthodes autorisées
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization"); // En-têtes autorisés
  // Si la méthode est OPTIONS, répondre avec un statut 200
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// Exemple d'endpoint pour servir un fichier .ics
app.get("/ics", (req, res) => {
  const filePath = path.join(__dirname, "ADECal.ics");
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Erreur envoi ICS:", err);
      res.status(500).send("Impossible de lire ADECal.ics");
    } else {
      console.log("Fichier ADECal.ics envoyé");
    }
  });
});

// Configuration proxy zimbra
app.post("/zimbra_proxy", async (req, res) => {
  try {
    const zimbraResponse = await fetch("https://partage.bordeaux-inp.fr/service/soap", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
      },
      body: req.body,        // on relaie EXACTEMENT ce que tu as envoyé
    });

    const text = await zimbraResponse.text();
    res.status(zimbraResponse.status).send(text); // on renvoie tel quel

  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
});

// Lancer le serveur local sur le port 3000
const PORT = 3000;
app.listen(PORT, () =>
  console.log(`Proxy local actif sur http://localhost:${PORT}`)
);
