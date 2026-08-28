const AwsProvider = require('./providers/awsProvider');
const AzureProvider = require('./providers/azureProvider');
const GcpProvider = require('./providers/gcpProvider');

class StorageAdapter {
  /**
   * Instantiates appropriate Storage Provider based on bound credentials
   * @param {Object} credentials - Bound Object Store service credentials
   * @returns {AwsProvider | AzureProvider | GcpProvider}
   */
  static async getClient(credentials = null) {
    if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
      const err = new Error("Missing Object Store service credentials. Ensure your application is bound to a valid Object Store instance.");
      err.statusCode = 400;
      throw err;
    }

    // 1. AWS Credentials Validation
    if (credentials.access_key_id) {
      if (!credentials.secret_access_key) {
        const err = new Error("Invalid AWS Object Store credentials: Missing 'secret_access_key'.");
        err.statusCode = 400;
        throw err;
      }
      if (!credentials.bucket) {
        const err = new Error("Invalid AWS Object Store credentials: Missing target 'bucket'.");
        err.statusCode = 400;
        throw err;
      }
      return new AwsProvider(credentials);
    }

    // 2. GCP Credentials Validation
    if (credentials.private_key || credentials.base64EncodedPrivateKeyData || credentials.gcpKey) {
      if (!credentials.bucket) {
        const err = new Error("Invalid GCP Object Store credentials: Missing target 'bucket'.");
        err.statusCode = 400;
        throw err;
      }
      return new GcpProvider(credentials);
    }

    // 3. Azure Credentials Validation
    if (credentials.account_name || credentials.container_uri || credentials.sas_token || credentials.connection_string || credentials.container_name || credentials.container) {
      return new AzureProvider(credentials);
    }

    const err = new Error("Invalid Object Store credentials: Provider format not recognized or key credentials missing.");
    err.statusCode = 400;
    throw err;
  }
}

module.exports = StorageAdapter;
