/**
 * Stocker et récupérer des variables par association clé : valeur, en utilisant NativeStorage, SecureStorage ou localStorage.
 */
export class SecureStorageManager {
    static secureStorage = null;

    // Initialisation de SecureStorage (uniquement pour les plateformes Android et iOS)
    static initSecureStorage() {
        if (window.SecureStorage) {
            this.secureStorage = new SecureStorage();
            console.log("[SecureStorage] Initialisé.");
        } else {
            console.warn("[SecureStorage] Plugin SecureStorage non disponible.");
        }
    }

    static setItem(key, value) {
        if (window.NativeStorage) {
            NativeStorage.setItem(key, value,
                () => console.log(`[NativeStorage] ${key} enregistré.`),
                err => console.error(`[NativeStorage] Erreur setItem(${key}) :`, err)
            );
        } else if (this.secureStorage) {
            // Utilisation de SecureStorage si disponible
            this.secureStorage.set(key, value, 
                () => console.log(`[SecureStorage] ${key} enregistré.`),
                err => console.error(`[SecureStorage] Erreur setItem(${key}) :`, err)
            );
        } else {
            localStorage.setItem(key, value);
            console.log(`[localStorage] ${key} enregistré.`);
        }
    }

    static getItem(key, callback) {
        if (window.NativeStorage) {
            NativeStorage.getItem(key,
                value => callback(value),
                err => {
                    if (err && err.code === 2) {
                        console.warn(`[NativeStorage] ⚠️ Clé absente pour getItem(${key})`);
                    } else {
                        console.error(`[NativeStorage] ❌ Erreur getItem(${key}) :`, err);
                    }
                    callback(null); // renvoyer null en cas d'erreur
                }
            );
        } else if (this.secureStorage) {
            // Utilisation de SecureStorage si disponible
            this.secureStorage.get(key, 
                value => callback(value),
                err => {
                    if (err && err.code === 2) {
                        console.warn(`[SecureStorage] ⚠️ Clé absente pour getItem(${key})`);
                    } else {
                        console.error(`[SecureStorage] ❌ Erreur getItem(${key}) :`, err);
                    }
                    callback(null); // renvoyer null en cas d'erreur
                }
            );
        } else {
            const val = localStorage.getItem(key);
            if (val === null) {
                // Pas d'erreur ici, juste une absence de clé
                console.warn(`[localStorage] Clé absente pour getItem(${key})`);
            }
            callback(val);  // val peut être null si la clé n'existe pas
        }
    }

    static getItemAsync(key) {
        return new Promise(resolve => {
            this.getItem(key, val => resolve(val));
        });
    }

    static removeItem(key) {
        if (window.NativeStorage) {
            NativeStorage.remove(key,
                () => console.log(`[NativeStorage] ${key} supprimé.`),
                err => console.error(`[NativeStorage] Erreur removeItem(${key}) :`, err)
            );
        } else if (this.secureStorage) {
            // Utilisation de SecureStorage si disponible
            this.secureStorage.remove(key, 
                () => console.log(`[SecureStorage] ${key} supprimé.`),
                err => console.error(`[SecureStorage] Erreur removeItem(${key}) :`, err)
            );
        } else {
            localStorage.removeItem(key);
            console.log(`[localStorage] ${key} supprimé.`);
        }
    }
}
