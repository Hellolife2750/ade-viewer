// enregistrer/charger un fichier ICS dans le stockage local
export class FileManager {
    static filename = "planning.ics";

    static isNativeFileSystemAvailable() {
        const isCordova = typeof cordova !== "undefined";
        const hasFile = isCordova && typeof cordova.file !== "undefined";
        const hasFS = typeof window.resolveLocalFileSystemURL !== "undefined";

        // 🔑 Vérifier si on n'est PAS en mode "cordova run browser"
        const isBrowserPlatform = isCordova && cordova.platformId === "browser";

        return hasFile && hasFS && !isBrowserPlatform;
    }

    static async saveIcsFile(text) {
        if (!this.isNativeFileSystemAvailable()) {
            console.warn("💡 Native file system non disponible (browser mode). Sauvegarde ignorée.");
            return;
        }

        return new Promise((resolve, reject) => {
            window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function (dirEntry) {
                dirEntry.getFile(FileManager.filename, { create: true, exclusive: false }, function (fileEntry) {
                    fileEntry.createWriter(function (fileWriter) {
                        fileWriter.onwriteend = function () {
                            console.log("✅ Fichier ICS enregistré localement !");
                            resolve(true);
                        };

                        fileWriter.onerror = function (e) {
                            console.error("❌ Erreur d'écriture :", e);
                            reject(e);
                        };

                        const blob = new Blob([text], { type: "text/calendar" });
                        fileWriter.write(blob);
                    }, reject);
                }, reject);
            }, reject);
        });
    }

    static async loadIcsFile(withLoader, fetchICS) {
        return await withLoader(async () => {
            // Natif uniquement
            if (this.isNativeFileSystemAvailable()) {
                try {
                    const result = await new Promise((resolve, reject) => {
                        window.resolveLocalFileSystemURL(
                            cordova.file.dataDirectory + FileManager.filename,
                            function (fileEntry) {
                                fileEntry.file(function (file) {
                                    const reader = new FileReader();
    
                                    reader.onloadend = function () {
                                        console.log("✅ Fichier ICS lu depuis le stockage natif !");
                                        resolve(this.result);
                                    };
    
                                    reader.onerror = function (e) {
                                        reject(e);
                                    };
    
                                    reader.readAsText(file);
                                }, reject);
                            },
                            reject
                        );
                    });
    
                    return result;
                } catch (err) {
                    console.warn("⚠️ Fichier ICS introuvable ou erreur lecture :", err);
                    // => fallback : fetch depuis l’URL
                }
            } else {
                console.warn("💡 Mode browser ou plugin fichier indisponible. Téléchargement direct.");
            }
    
            return await fetchICS();
        });
    }
    
    static async deleteIcsFile() {
        if (!this.isNativeFileSystemAvailable()) {
            console.warn("💡 Pas de système de fichier (browser). Rien à supprimer.");
            return;
        }

        return new Promise((resolve, reject) => {
            window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function (dirEntry) {
                dirEntry.getFile(FileManager.filename, { create: false }, function (fileEntry) {
                    fileEntry.remove(function () {
                        console.log("🗑️ Fichier supprimé !");
                        resolve();
                    }, reject);
                }, reject);
            }, reject);
        });
    }
}