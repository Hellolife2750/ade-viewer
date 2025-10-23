/**
 * Classe utilitaire pour faire des requêtes HTTP via cordova-plugin-advanced-http.
 */
export class RequestsManager {
    /**
     * Envoie une requête HTTP GET vers l'URL donnée avec timeout.
     * @param {string} url
     * @param {number} timeoutMs - délai en millisecondes avant rejet (défaut 15000)
     * @returns {Promise<object>}
     * 
     * @example
     * RequestsManager.httpGet('https://api.exemple.com/data')
     *     .then(response => console.log(response))
     *     .catch(error => console.error(error));
     */
    static httpGet(url, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            let settled = false;               // pour ignorer les callbacks tardifs
            let timer = null;

            const finishResolve = (val) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                resolve(val);
            };
            const finishReject = (err) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                reject(err);
            };

            // démarre le timer de timeout
            timer = setTimeout(() => {
                // si on arrive ici, la promesse n'a pas encore été résolue -> timeout
                // on rejette avec une erreur claire
                finishReject(new Error(`Request timed out after ${timeoutMs} ms`));
            }, timeoutMs);

            // lance la requête via cordova-plugin-advanced-http
            try {
                cordova.plugin.http.sendRequest(
                    url,
                    { method: "get" },
                    (response) => finishResolve(response),
                    (error) => finishReject(error)
                );
            } catch (err) {
                finishReject(err);
            }
        });
    }
}
