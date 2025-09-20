/**
 * Stocker et récupérer des variables par association cle : valeur, en utilisant NativeStorage si disponible, sinon localStorage.
 */
export class StorageManager {
    static setItem(key, value) {
        if (window.NativeStorage) {
            NativeStorage.setItem(key, value,
                () => console.log(`[NativeStorage] ${key} enregistré.`),
                err => console.error(`[NativeStorage] Erreur setItem(${key}) :`, err)
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
                    console.error(`[NativeStorage] Erreur getItem(${key}) :`, err);
                    callback(null);
                }
            );
        } else {
            const val = localStorage.getItem(key);
            callback(val);
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
        } else {
            localStorage.removeItem(key);
            console.log(`[localStorage] ${key} supprimé.`);
        }
    }
}