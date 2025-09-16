const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

app.get("/ics", (req, res) => {
    const filePath = path.join(__dirname, "ADECal.ics");
    res.sendFile(filePath, err => {
        if (err) {
            console.error("Erreur envoi ICS:", err);
            res.status(500).send("Impossible de lire ADECal.ics");
        } else {
            console.log("Fichier ADECal.ics envoyé");
        }
    });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Proxy ICS (local) dispo sur http://localhost:${PORT}/ics`));
