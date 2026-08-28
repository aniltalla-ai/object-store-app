const { getDestination } = require('@sap-cloud-sdk/connectivity');

class DestinationAdapter {
  /**
   * Normalize destination property values (decode base64 if armored key/cert format or ASCII printable)
   * @param {string} val 
   * @returns {string}
   */
  /**
   * Normalize destination property values.
   * Base64 decoding is only applied if the decoded payload yields a PEM key/cert block ('-----BEGIN').
   * Plain text values (e.g., passphrases) are preserved as-is.
   * @param {string} val 
   * @returns {string}
   */
  normalizePropertyValue(val) {
    if (!val || typeof val !== 'string') return val;
    const str = val.trim();
    if (str.includes('-----BEGIN')) return str;

    if (str.length >= 4 && str.length % 4 === 0 && /^[A-Za-z0-9+/=\s]+$/.test(str)) {
      try {
        const decoded = Buffer.from(str.replace(/\s+/g, ''), 'base64').toString('utf8').trim();
        if (decoded.includes('-----BEGIN')) {
          return decoded;
        }
      } catch (e) {}
    }
    return str;
  }

  /**
   * Extract and flatten destination properties
   * @param {Object} dest 
   * @returns {Object}
   */
  getDestinationProperties(dest) {
    if (!dest) return {};
    return {
      ...dest,
      ...(dest.originalProperties || {}),
      ...(dest.additionalProperties || {}),
    };
  }

  /**
   * Fetch raw destination object via SAP Cloud SDK
   * @param {string} destinationName 
   * @returns {Promise<Object|null>}
   */
  async getDestination(destinationName) {
    if (!destinationName) return null;
    try {
      return await getDestination({ destinationName });
    } catch (err) {
      console.warn(`[DESTINATION] Failed to resolve '${destinationName}': ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch flattened properties of a destination
   * @param {string} destinationName 
   * @param {boolean} normalizeValues - Auto-decode Base64 values (default: true)
   * @returns {Promise<Object>}
   */
  async getProperties(destinationName, normalizeValues = true) {
    const dest = await this.getDestination(destinationName);
    if (!dest) return {};

    const props = this.getDestinationProperties(dest);
    if (!normalizeValues) return props;

    const processedProps = {};
    for (const [key, value] of Object.entries(props)) {
      processedProps[key] = this.normalizePropertyValue(value);
    }
    return processedProps;
  }
}

const instance = new DestinationAdapter();

module.exports = {
  DestinationAdapter,
  getDestination: (name) => instance.getDestination(name),
  getProperties: (name, normalizeValues) => instance.getProperties(name, normalizeValues),
  getDestinationProperties: (dest) => instance.getDestinationProperties(dest),
  normalizePropertyValue: (val) => instance.normalizePropertyValue(val),
};
