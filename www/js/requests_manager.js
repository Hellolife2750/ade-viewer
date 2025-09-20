/**
 * Classe utilitaire pour faire des requêtes HTTP via cordova-plugin-advanced-http.
 */
export class RequestsManager {
    /**
     * Envoie une requête HTTP GET vers l'URL donnée.
     *
     * @param {string} url - L'URL à interroger.
     * @returns {Promise<object>} Une promesse résolue avec la réponse, ou rejetée avec une erreur.
     *
     * @example
     * RequestsManager.httpGet('https://api.exemple.com/data')
     *     .then(response => console.log(response))
     *     .catch(error => console.error(error));
     */
    static httpGet(url) {
        return new Promise((resolve, reject) => {
            cordova.plugin.http.sendRequest(
                url,
                { method: "get" },
                (response) => resolve(response),
                (error) => reject(error)
            );
        });
    }
}