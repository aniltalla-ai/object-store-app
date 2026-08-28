/**
 * Single Unified Localization Dictionary
 * All supported languages live in this single file.
 * Adding a new language (e.g. 'fr', 'es') only requires adding language keys to this object.
 */
const MESSAGES = {
  // Authentication & Security Errors
  UNAUTHORIZED_NO_XSUAA: {
    en: "Server misconfigured: No XSUAA bindings found.",
    de: "Serverfehlkonfiguration: Keine XSUAA-Bindungen gefunden.",
    fr: "Serveur mal configuré: Aucun liaison XSUAA trouvée.",
    es: "Servidor mal configurado: No se encontraron vinculaciones XSUAA."
  },
  UNAUTHORIZED_INVALID_TOKEN: {
    en: "Unauthorized: Invalid token signature or issuer.",
    de: "Nicht autorisiert: Ungültige Tokensignatur oder Aussteller.",
    fr: "Non autorisé: Signature de jeton non valide ou émetteur.",
    es: "No autorizado: Firma de token no válida o emisor."
  },
  MISSING_OBJECT_STORE: {
    en: "No Object Store Instance attribute found. Ensure you are using a user token (not client credentials) and that the role template assigns this attribute.",
    de: "Kein Object Store Instanz-Attribut gefunden. Stellen Sie sicher, dass Sie ein Benutzertoken verwenden und die Rollenvorlage dieses Attribut zuweist.",
    fr: "Aucun attribut d'instance Object Store trouvé.",
    es: "No se encontró el atributo de instancia de Object Store."
  },
  TOKEN_PARSE_ERROR: {
    en: "Unauthorized: Failed to parse token payload.",
    de: "Nicht autorisiert: Token-Nutzlast konnte nicht analysiert werden.",
    fr: "Non autorisé: Impossible d'analyser le jeton.",
    es: "No autorizado: Error al analizar el token."
  },

  // Storage & Request Errors
  OBJECT_NOT_FOUND: {
    en: "File or object not found.",
    de: "Datei oder Objekt nicht gefunden.",
    fr: "Fichier ou objet introuvable.",
    es: "Archivo u objeto no encontrado."
  },
  ACCESS_DENIED: {
    en: "Access denied to storage container.",
    de: "Zugriff auf Speichercontainer verweigert.",
    fr: "Accès refusé au conteneur de stockage.",
    es: "Acceso denegado al contenedor de almacenamiento."
  },
  MISSING_SOURCE_DEST_PATHS: {
    en: "Missing 'sourcePath' or 'destinationPath' parameters.",
    de: "Fehlende Parameter 'sourcePath' oder 'destinationPath'.",
    fr: "Paramètres 'sourcePath' ou 'destinationPath' manquants.",
    es: "Faltan los parámetros 'sourcePath' o 'destinationPath'."
  },
  MISSING_DESTINATION_PATH: {
    en: "Missing required destination/storagePath parameter.",
    de: "Erforderlicher Parameter 'destination/storagePath' fehlt.",
    fr: "Paramètre destination/storagePath manquant.",
    es: "Falta el parámetro requerido destination/storagePath."
  },
  INVALID_SOURCE_PATH: {
    en: "Invalid 'sourcePath' parameter.",
    de: "Ungültiger Parameter 'sourcePath'.",
    fr: "Paramètre 'sourcePath' non valide.",
    es: "Parámetro 'sourcePath' no válido."
  },
  DIRECTORY_NOT_FOUND: {
    en: "Directory not found.",
    de: "Verzeichnis nicht gefunden.",
    fr: "Répertoire introuvable.",
    es: "Directorio no encontrado."
  },
  MISSING_FILE_NAME: {
    en: "Missing file name or target path.",
    de: "Fehlender Dateiname oder Zielpfad.",
    fr: "Nom de fichier ou chemin cible manquant.",
    es: "Falta el nombre de archivo o la ruta de destino."
  },
  DECRYPTION_FAILED: {
    en: "Decryption failed. Please verify your encryption key or passphrase.",
    de: "Entschlüsselung fehlgeschlagen. Bitte Schlüssel oder Passphrase prüfen.",
    fr: "Échec du déchiffrement. Veuillez vérifier votre clé.",
    es: "Fallo en el descifrado. Verifique su clave o contraseña."
  },
  STORAGE_INIT_ERROR: {
    en: "Storage adapter initialization error.",
    de: "Fehler bei der Initialisierung des Storage-Adapters.",
    fr: "Erreur d'initialisation de l'adaptateur de stockage.",
    es: "Error al inicializar el adaptador de almacenamiento."
  },
  GENERIC_ERROR: {
    en: "An unexpected storage error occurred.",
    de: "Ein unerwarteter Speicherfehler ist aufgetreten.",
    fr: "Une erreur de stockage inattendue s'est produite.",
    es: "Ocurrió un error de almacenamiento inesperado."
  },

  // Swagger Documentation UI Localized Strings
  SWAGGER_INFO_TITLE: {
    en: "Object Store Services",
    de: "Object Store Dienste",
    fr: "Services d'Object Store",
    es: "Servicios de Object Store"
  },
  SWAGGER_INFO_DESC: {
    en: "REST API service for object storage (AWS S3, Azure Blob, GCP Storage) with multi-instance tenant scoping",
    de: "REST-API-Dienst für Objektspeicher (AWS S3, Azure Blob, GCP Storage) mit Mandantentrennung",
    fr: "Service API REST pour le stockage d'objets (AWS S3, Azure Blob, GCP Storage)",
    es: "Servicio API REST para almacenamiento de objetos (AWS S3, Azure Blob, GCP Storage)"
  },
  SWAGGER_GET__STORAGE_LIST_SUMMARY: {
    en: "List files and folders in object store",
    de: "Dateien und Ordner im Objektspeicher auflisten",
    fr: "Lister les fichiers et dossiers",
    es: "Listar archivos y carpetas"
  },
  SWAGGER_POST__STORAGE_CREATEPATH_SUMMARY: {
    en: "Create directory path in object store",
    de: "Verzeichnispfad im Objektspeicher erstellen",
    fr: "Créer un chemin de répertoire",
    es: "Crear ruta de directorio"
  },
  SWAGGER_GET__STORAGE_DOWNLOAD_SUMMARY: {
    en: "Download file from destination",
    de: "Datei vom Zielort herunterladen",
    fr: "Télécharger le fichier",
    es: "Descargar archivo"
  },
  SWAGGER_GET__STORAGE_DOWNLOADCHUNK_SUMMARY: {
    en: "Get file chunk from destination",
    de: "Datei-Block vom Zielort abrufen",
    fr: "Obtenir un fragment de fichier",
    es: "Obtener fragmento de archivo"
  },
  SWAGGER_POST__STORAGE_UPLOAD_SUMMARY: {
    en: "Upload file synchronously to destination",
    de: "Datei synchron zum Zielort hochladen",
    fr: "Téléverser le fichier de manière synchrone",
    es: "Cargar archivo de forma sincrónica"
  },
  SWAGGER_POST__STORAGE_UPLOADASYNC_SUMMARY: {
    en: "Upload file asynchronously to destination",
    de: "Datei asynchron zum Zielort hochladen",
    fr: "Téléverser le fichier de manière asynchrone",
    es: "Cargar archivo de forma asincrónica"
  },
  SWAGGER_POST__STORAGE_COPY_SUMMARY: {
    en: "Copy file from source path to destination path",
    de: "Datei vom Quellpfad zum Zielpfad kopieren",
    fr: "Copier le fichier",
    es: "Copiar archivo"
  },
  SWAGGER_POST__STORAGE_MOVE_SUMMARY: {
    en: "Move file from source path to destination path",
    de: "Datei vom Quellpfad zum Zielpfad verschieben",
    fr: "Déplacer le fichier",
    es: "Mover archivo"
  },
  SWAGGER_DELETE__STORAGE_DELETE_SUMMARY: {
    en: "Delete file from destination",
    de: "Datei vom Zielort löschen",
    fr: "Supprimer le fichier",
    es: "Eliminar archivo"
  },
  SWAGGER_GET__STORAGE_WRITING_LIST_SUMMARY: {
    en: "List pending files available for writing/appending",
    de: "Ausstehende Dateien zum Schreiben/Anfügen auflisten",
    fr: "Lister les fichiers en attente",
    es: "Listar archivos pendientes"
  },
  SWAGGER_GET__STORAGE_WRITING_READ_SUMMARY: {
    en: "Get all or a portion of a writable file",
    de: "Teil oder Gesamtheit einer schreibbaren Datei abrufen",
    fr: "Obtenir tout ou partie d'un fichier modifiable",
    es: "Obtener todo o parte de un archivo modificable"
  },
  SWAGGER_POST__STORAGE_WRITING_CREATE_SUMMARY: {
    en: "Create a file session that can be appended to",
    de: "Dateisitzung zum Anfügen von Daten erstellen",
    fr: "Créer une session de fichier",
    es: "Crear una sesión de archivo"
  },
  SWAGGER_POST__STORAGE_WRITING_APPEND_SUMMARY: {
    en: "Add chunk to existing writable file session",
    de: "Datenblock zu bestehender Dateisitzung hinzufügen",
    fr: "Ajouter un fragment à la session",
    es: "Agregar fragmento a la sesión"
  },
  SWAGGER_POST__STORAGE_WRITING_CLOSE_SUMMARY: {
    en: "Close writable file session and move to destination",
    de: "Schreibbare Dateisitzung schließen und übertragen",
    fr: "Fermer la session de fichier",
    es: "Cerrar sesión de archivo"
  },
  SWAGGER_DELETE__STORAGE_WRITING_CANCEL_SUMMARY: {
    en: "Cancel writing session and remove temporary chunks",
    de: "Schreibsitzung abbrechen und temporäre Blöcke löschen",
    fr: "Annuler la session de fichier",
    es: "Cancelar sesión de archivo"
  },
  SWAGGER_GET__STORAGE_WRITING_STATUS_SUMMARY: {
    en: "View pending upload status",
    de: "Status ausstehender Uploads anzeigen",
    fr: "Afficher le statut du téléchargement",
    es: "Ver estado de carga pendiente"
  }
};

/**
 * Retrieve localized text for a given message code
 * @param {string} code 
 * @param {string} lang 
 * @returns {string}
 */
function getMessage(code, lang = 'en') {
  if (!code) return '';
  const selectedLang = (lang || 'en').toString().toLowerCase().split('-')[0];
  const translations = MESSAGES[code] || {};
  return translations[selectedLang] || translations['en'] || code;
}

module.exports = { MESSAGES, getMessage };
