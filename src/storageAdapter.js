const { getDestination } = require('@sap-cloud-sdk/connectivity');
const AwsProvider = require('./providers/awsProvider');
const AzureProvider = require('./providers/azureProvider');
const GcpProvider = require('./providers/gcpProvider');

class StorageAdapter {
  static async getClient(credentials = null, destinationName = null, isUseDestionation = false) {
    // 1. If passed a credentials object directly (from security.js / xsenv)
    if (credentials && !isUseDestionation) {
      if (credentials.access_key_id) return new AwsProvider(credentials);
      if (credentials.private_key) return new GcpProvider(credentials);
      return new AzureProvider(credentials);
    }
    if (!destinationName) {
      throw new Error("Missing storage credentials or instance identifier.");
    }

    try {
      const dest = await getDestination({ destinationName });
      if (!dest) throw new Error(`Destination ${destinationName} not found.`);

      const url = dest.url || '';
      if (url.includes('amazonaws.com')) return new AwsProvider(dest.username ? {
        bucket: dest.originalProperties.bucket,
        region: dest.originalProperties.region,
        access_key_id: dest.username,
        secret_access_key: dest.password,
      } : dest.originalProperties);
      if (url.includes('blob.core.windows.net')) return new AzureProvider(dest.originalProperties);
      if (url.includes('googleapis.com')) return new GcpProvider(dest.originalProperties);

      throw new Error('Unsupported cloud vendor provider mapping.');
    } catch (err) {
      throw new Error(`Failed to resolve storage runtime setup: ${err.message}`);
    }
  }
}

module.exports = StorageAdapter;
