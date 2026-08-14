const xsenv = require('@sap/xsenv');
const { getDestination } = require('@sap-cloud-sdk/connectivity');
const AwsProvider = require('./providers/awsProvider');
const AzureProvider = require('./providers/azureProvider');
const GcpProvider = require('./providers/gcpProvider');

class StorageAdapter {
  /**
   * Reads bound services using xsenv with fallback to process.env.VCAP_SERVICES
   */
  static getBoundServices() {
    try {
      return xsenv.readServices();
    } catch (e) {
      try {
        return process.env.VCAP_SERVICES ? JSON.parse(process.env.VCAP_SERVICES) : {};
      } catch (err) {
        return {};
      }
    }
  }

  /**
   * Resolves storage client provider for given instance name / destination
   * @param {string} instanceId Name of the Object Store instance / destination
   */
  static async getClient(instanceId) {
    if (!instanceId) {
      throw new Error("Missing required Object Store instance name.");
    }

    // 1. Look up matching bound Object Store service credentials
    let creds = null;
    const allServices = this.getBoundServices();
    const objectStores = allServices.objectstore || allServices['object-store'] || [];
    const match = objectStores.find(os => os.name === instanceId || os.instance_name === instanceId) || objectStores[0];

    if (match && match.credentials) {
      creds = match.credentials;
    }

    // 2. Instantiate cloud vendor provider based on credentials signature
    if (creds) {
      if (creds.access_key_id || creds.secret_access_key) return new AwsProvider(creds);
      if (creds.private_key || creds.client_email || creds.project_id) return new GcpProvider(creds);
      if (creds.container_name || creds.storage_account_name || creds.sas_token) return new AzureProvider(creds);
      return new AwsProvider(creds);
    }

    // 3. Fallback: SAP BTP Destination Service lookup
    try {
      const dest = await getDestination({ destinationName: instanceId });
      if (!dest) throw new Error(`Destination '${instanceId}' not found.`);

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
      throw new Error(`Failed to resolve storage runtime setup for '${instanceId}': ${err.message}`);
    }
  }
}

module.exports = StorageAdapter;
