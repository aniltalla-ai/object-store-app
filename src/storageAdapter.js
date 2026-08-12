const { getDestination } = require('@sap-cloud-sdk/connectivity');
const AwsProvider = require('./providers/awsProvider');
const AzureProvider = require('./providers/azureProvider');
const GcpProvider = require('./providers/gcpProvider');
const LocalMockProvider = require('./providers/localMockProvider');

class StorageAdapter {
  static async getClient(destinationName) {
    if (process.env.NODE_ENV !== 'production' && process.env.MOCK_LOCAL_STORAGE === 'true') {
      return new LocalMockProvider();
    }

    const vcap = process.env.VCAP_SERVICES ? JSON.parse(process.env.VCAP_SERVICES) : {};

    if (vcap.objectstore && vcap.objectstore.length > 0) {
      const creds = vcap.objectstore[0].credentials;
      if (creds.access_key_id) return new AwsProvider(creds);
      if (creds.private_key) return new GcpProvider(creds);
      return new AzureProvider(creds);
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
